// db-seed.ts — Seed the local Supabase DB with realistic test data
// for Klaas to poke around. Run via `pnpm db:seed`.
// Idempotent: re-runs are safe (delete-then-insert for the fixed IDs).
//
// Auth users are created via the Supabase admin API (service-role key)
// so that the bcrypt hashing + the `identities` row + the `aud`/`role`
// triplet all land in the exact shape GoTrue expects for `/auth/v1/token`
// logins. Direct `INSERT INTO auth.users` with `crypt(...)` produces rows
// that pass `crypt(pwd, hash) = hash` at the DB level but fail the
// GoTrue login check (it requires the `identities` row + `aud/role`).

import pg from 'pg'
import { createHash } from 'node:crypto'

const DEFAULT_LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres'
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54421'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// Stable IDs so we can ship fixed URLs in the test walkthrough.
const IDS = {
  // Auth users
  superAdmin: '00000000-0000-0000-0000-000000000001',
  adminUser: '00000000-0000-0000-0000-000000000002',
  klaasUser: '00000000-0000-0000-0000-000000000003', // partner
  buyerUser: '00000000-0000-0000-0000-000000000004',
  buyerTwo: '00000000-0000-0000-0000-000000000005',
  // Partners
  partnerKlaas: 1,
  partnerJane: 2,
  // Products
  prodAI: 1,
  prodColdEmail: 2,
  prodBizFund: 3,
  // Categories
  catMarketing: 1,
  catAI: 2,
  catBusiness: 3,
  // Library grants
  grantAI: 1,
  grantBizFund: 2,
}

const SAMPLE_LESSONS_BY_PRODUCT = {
  // 5 modules × 2 lessons = 10 lessons per product, ~30s each.
  // file_id stays null → the watch page falls back to the demo HLS
  // (Mux Big Buck Bunny) so you can click Play without a real upload.
  [IDS.prodAI]: [
    { title: 'What is AI for entrepreneurs?', duration: 480 },
    { title: 'The 5 tool categories', duration: 660 },
    { title: 'Building your first prompt stack', duration: 540 },
    { title: 'Measuring ROI of AI tools', duration: 720 },
    { title: 'Common pitfalls + how to avoid them', duration: 600 },
  ],
  [IDS.prodColdEmail]: [
    { title: 'Why cold email still works in 2026', duration: 540 },
    { title: 'Buying a domain for sending', duration: 480 },
    { title: 'Writing your first 3 sequences', duration: 900 },
    { title: 'Deliverability checklist', duration: 420 },
    { title: 'Scaling to 1,000 sends/day', duration: 600 },
  ],
  [IDS.prodBizFund]: [
    { title: 'The 3 financial statements', duration: 720 },
    { title: 'Reading a P&L in 5 minutes', duration: 480 },
    { title: 'Cash flow forecasting', duration: 660 },
    { title: 'When to raise vs when to bootstrap', duration: 540 },
    { title: 'Hiring your first accountant', duration: 420 },
  ],
}

function sha256_10(input: string): string {
  // Truncated hex, 10 chars — matches the audit-log hash shape.
  return createHash('sha256').update(input).digest('hex').slice(0, 10)
}

async function nuke(c: pg.Client) {
  // Order matters: leaf tables first.
  for (const t of [
    'certificates','bookmarks','progress',
    'reviews',
    'library_grants','order_items','orders','refunds',
    'cart_items',
    'payout_requests','payout_ledger',
    'coupons',
    'product_lessons','product_modules','product_pricing','product_files','product_images','product_assets',
    'collection_products','collections',
    'products',
    'categories',
    'partners',
    'affiliate_clicks','affiliate_commissions','affiliate_links','affiliates',
    'api_tokens','notification_preferences',
    'processed_webhooks','admin_audit_log',
    'file_downloads','app_settings','platform_settings',
    'profiles',
  ]) {
    await c.query(`DELETE FROM ${t}`)
  }
  // Wipe auth.users — disable FK checks via SET session_replication_role
  // is overkill; just delete by id.
  await c.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [[
    IDS.superAdmin, IDS.adminUser, IDS.klaasUser, IDS.buyerUser, IDS.buyerTwo,
    '00000000-0000-0000-0000-0000aabbccdd',
  ]])
}

async function seed() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? DEFAULT_LOCAL_URL })
  await c.connect()

  console.log('🧹 clearing previous fixture data…')
  await nuke(c)

  console.log('👤 creating auth.users + profiles (via Supabase admin API)…')

  // Delete fixed-UUID users we previously wrote directly into auth.users.
  await c.query(
    `DELETE FROM auth.users WHERE id = ANY($1::uuid[])`,
    [[
      IDS.superAdmin, IDS.adminUser, IDS.klaasUser, IDS.buyerUser, IDS.buyerTwo,
      '00000000-0000-0000-0000-0000aabbccdd',
    ]],
  )

  // Create real auth users via the admin API. Each is a credential
  // Klaas can sign in with at /login.
  type UserSpec = { key: 'superAdmin' | 'adminUser' | 'klaasUser' | 'buyerUser' | 'buyerTwo'; email: string; displayName: string; role: 'super_admin' | 'admin' | 'partner' | 'customer' }
  const USERS: UserSpec[] = [
    { key: 'superAdmin', email: 'klaas+admin@uthena.com',   displayName: 'Klaas (Admin)',   role: 'super_admin' },
    { key: 'adminUser',   email: 'admin@uthena.com',         displayName: 'Admin User',      role: 'admin' },
    { key: 'klaasUser',   email: 'klaas+partner@uthena.com', displayName: 'Klaas (Partner)', role: 'partner' },
    { key: 'buyerUser',   email: 'buyer@uthena.com',         displayName: 'Sam Buyer',       role: 'customer' },
    { key: 'buyerTwo',    email: 'buyer2@uthena.com',        displayName: 'Pat Buyer',       role: 'customer' },
  ]

  const userIdByKey: Record<string, string> = {}
  for (const u of USERS) {
    const res = await fetch(`${LOCAL_SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
        'apikey': LOCAL_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: u.email,
        password: u.email,
        email_confirm: true,
        user_metadata: { full_name: u.displayName },
        app_metadata: {},
      }),
    })
    let userId: string
    if (res.ok) {
      const body = (await res.json()) as { id: string }
      userId = body.id
    } else {
      // Already exists (or admin API unavailable) — look up the existing
      // id directly from auth.users in our DB. This is the same DB the
      // GoTrue container writes to, so it sees the same ids.
      const lookup = await c.query(
        `SELECT id::text FROM auth.users WHERE email = $1::text LIMIT 1`,
        [u.email],
      )
      if (lookup.rows.length === 0) {
        const body = await res.text()
        throw new Error(`admin create ${u.email}: ${res.status} ${body} (not in auth.users either)`)
      }
      userId = lookup.rows[0]!.id
    }
    // Mirror the row into our local auth.users so the FK from
    // public.profiles (user_id → auth.users.id) resolves. The real
    // login + identity rows live in GoTrue's internal DB — that's
    // where /auth/v1/token validates. This row is purely for FK
    // integrity in our uthena DB.
    await c.query(
      `INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, role, aud) VALUES ($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid, $2::text, '', now(), now(), now(), 'authenticated', 'authenticated') ON CONFLICT (id) DO NOTHING`,
      [userId, u.email],
    )
    userIdByKey[u.key] = userId
  }

  // Patch the profiles rows now that we know the auth ids (replace fixed UUIDs).
  for (const u of USERS) {
    const id = userIdByKey[u.key]!
    await c.query(
      `INSERT INTO public.profiles (user_id, role, display_name, status) VALUES ($1::uuid, $2::user_role, $3, 'active') ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, display_name = excluded.display_name`,
      [id, u.role, u.displayName],
    )
  }

  // Override the fixed-uuid references in IDS so downstream inserts use
  // the freshly-created auth ids.
  Object.assign(IDS, {
    superAdmin: userIdByKey.superAdmin!,
    adminUser: userIdByKey.adminUser!,
    klaasUser: userIdByKey.klaasUser!,
    buyerUser: userIdByKey.buyerUser!,
    buyerTwo: userIdByKey.buyerTwo!,
  })

  console.log('🏷️  creating categories…')
  for (const [id, slug, name, description] of [
    [IDS.catMarketing, 'marketing', 'Marketing', 'Email, funnels, and growth playbooks.'],
    [IDS.catAI, 'ai-business', 'AI for Business', 'LLMs, agents, and AI tools in practice.'],
    [IDS.catBusiness, 'business-fundamentals', 'Business Fundamentals', 'Operations, finance, hiring.'],
  ] as Array<[number, string, string, string]>) {
    await c.query(
      `INSERT INTO public.categories (id, slug, name, description, parent_id) VALUES ($1, $2, $3, $4, null)`,
      [id, slug, name, description],
    )
  }

  console.log('🤝 creating partners…')
  for (const [id, publicSlug, status, userId, payoutEmail] of [
    [IDS.partnerKlaas, 'klaas', 'approved', IDS.klaasUser, 'klaas+partner@uthena.com'],
  ] as Array<[number, string, string, string | null, string]>) {
    await c.query(
      `INSERT INTO public.partners (id, public_slug, status, approved_at, user_id, payout_method, royalty_pct_bps) VALUES ($1::bigint, $2::text, $3::partner_status, now(), $4::uuid, jsonb_build_object('paypal_email_masked', $5::text, 'payout_method_kind', 'paypal'), 6000)`,
      [id, publicSlug, status, userId, payoutEmail],
    )
  }
  // Jane Doe is referenced by the Cold Email product — register her as a
  // partner with a dummy user_id link so the FK holds.
  const janeId = '00000000-0000-0000-0000-0000aabbccdd'
  await c.query(
    `INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, role, aud) VALUES ($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid, $2::text, crypt($2::text, gen_salt('bf', 10)), now(), now(), now(), 'authenticated', 'authenticated')`,
    [janeId, 'jane@uthena.com'],
  )
  await c.query(
    `INSERT INTO public.profiles (user_id, role, display_name, status) VALUES ($1::uuid, 'partner', 'Jane Doe', 'active') ON CONFLICT (user_id) DO NOTHING`,
    ['00000000-0000-0000-0000-0000aabbccdd'],
  )
  await c.query(
    `INSERT INTO public.partners (id, public_slug, status, approved_at, user_id, payout_method, royalty_pct_bps) VALUES ($1::bigint, $2::text, 'approved'::partner_status, now(), $3::uuid, jsonb_build_object('paypal_email_masked', $4::text, 'payout_method_kind', 'paypal'), 6000)`,
    [IDS.partnerJane, 'jane-doe', '00000000-0000-0000-0000-0000aabbccdd', 'jane@uthena.com'],
  )

  console.log('📚 creating products + curricula…')
  const PRODUCTS = [
    {
      id: IDS.prodAI,
      slug: 'ai-for-entrepreneurs',
      title: 'AI for Entrepreneurs',
      kind: 'video_course',
      partner: IDS.partnerKlaas,
      category: IDS.catAI,
      short: 'The hands-on playbook for using AI to grow a one-person business.',
      long: 'A practical, tool-by-tool playbook for entrepreneurs who want to use AI without losing their voice or their customer relationships. 5 modules of video lessons plus a downloadable prompt-pack.',
      bullets: ['5 modules of focused video lessons', 'Ready-to-use prompt pack', 'Tool comparison matrix', 'Common mistakes + fixes'],
      pricePLR: 9700,
      msrp: 19700,
      royaltyPct: 60,
    },
    {
      id: IDS.prodColdEmail,
      slug: 'cold-email-playbook',
      title: 'Cold Email Playbook',
      kind: 'video_course',
      partner: IDS.partnerJane,
      category: IDS.catMarketing,
      short: 'From domain setup to 1,000 sends/day. The complete cold email stack.',
      long: 'A step-by-step playbook for sending cold email that lands in the inbox and gets replies. Covers domains, copy, deliverability, and scaling.',
      bullets: ['Domain strategy + warming', 'Sequence templates', 'Copy frameworks', 'Deliverability checklist'],
      pricePLR: 12700,
      msrp: 24700,
      royaltyPct: 60,
    },
    {
      id: IDS.prodBizFund,
      slug: 'business-fundamentals',
      title: 'Business Fundamentals',
      kind: 'video_course',
      partner: IDS.partnerKlaas,
      category: IDS.catBusiness,
      short: 'The 5 financial fundamentals every founder should know.',
      long: 'A no-jargon walkthrough of the financial fundamentals: P&L, cash flow, runway, raising vs bootstrapping, and the first hire. Made for first-time founders.',
      bullets: ['P&L in plain English', 'Cash flow forecasting', 'Runway + burn', 'Raise vs bootstrap', 'Hiring your first accountant'],
      pricePLR: 6700,
      msrp: 12700,
      royaltyPct: 60,
    },
  ]
  for (const p of PRODUCTS) {
    await c.query(
      `INSERT INTO public.products (id, slug, title, kind, status, partner_id, category_id, short_description, long_description, published_at, avg_rating, review_count) VALUES ($1::bigint, $2::text, $3::text, $4::product_kind, 'published'::product_status, $5::bigint, $6::bigint, $7::text, $8::jsonb, now(), 4.6, 42)`,
      [p.id, p.slug, p.title, p.kind, p.partner, p.category, p.short, JSON.stringify({ body: p.long })],
    )
    // Bullets via the migration 0013 shape (JSONB array of strings).
    await c.query(`UPDATE public.products SET bullets = $1::jsonb WHERE id = $2::bigint`, [JSON.stringify(p.bullets), p.id])
    // Pricing (per-license tier; the schema is product_pricing.(product_id, license))
    // License types per the data model: 'plr', 'mrr', 'rr', 'personal'
    for (const [tier, priceCents, msrpCents] of [
      ['plr', p.pricePLR, p.msrp],
      ['mrr', p.pricePLR, p.msrp],
      ['rr', p.pricePLR, p.msrp],
    ] as const) {
      await c.query(
        `INSERT INTO public.product_pricing (product_id, license, price_cents, compare_at_cents, is_default) VALUES ($1::bigint, $2::license_type, $3::bigint, $4::bigint, $5::boolean)`,
        [p.id, tier, priceCents, msrpCents, tier === 'plr'],
      )
    }
    // 1 module containing all lessons
    const lessons = SAMPLE_LESSONS_BY_PRODUCT[p.id as 1 | 2 | 3] ?? []
    const moduleId = p.id * 10 // 10, 20, 30 — unique across products
    await c.query(
      `INSERT INTO public.product_modules (id, product_id, title, display_order, summary) VALUES ($1::bigint, $2::bigint, 'Course Curriculum', 1::int, 'All course lessons.')`,
      [moduleId, p.id],
    )
    for (let i = 0; i < lessons.length; i++) {
      const l = lessons[i]!
      await c.query(
        `INSERT INTO public.product_lessons (id, module_id, product_id, title, summary, duration_seconds, is_preview, display_order) VALUES ($1::bigint, $2::bigint, $3::bigint, $4::text, $5::text, $6::int, $7::boolean, $8::int)`,
        [p.id * 100 + i + 1, moduleId, p.id, l.title, `Lesson ${i+1}: ${l.title}`, l.duration, i === 0, i + 1],
      )
    }
  }

  console.log('🎁 giving the buyer two products in their library…')
  for (const [grantId, buyerId, productId, source] of [
    [IDS.grantAI, IDS.buyerUser, IDS.prodAI, 'purchase'],
    [IDS.grantBizFund, IDS.buyerUser, IDS.prodBizFund, 'admin_grant'],
  ] as Array<[number, string, number, string]>) {
    await c.query(
      `INSERT INTO public.library_grants (id, user_id, product_id, source, license) VALUES ($1::bigint, $2::uuid, $3::bigint, $4::text, 'plr'::license_type)`,
      [grantId, buyerId, productId, source],
    )
  }

  console.log('⭐ one sample review + one sample progress row…')
  await c.query(
    `INSERT INTO public.reviews (user_id, product_id, rating, title, body, status) VALUES ($1::uuid, $2::bigint, 5, 'Best $27 I ever spent', 'This course paid for itself in the first lesson. The prompt stack alone saved me 6 hours/week.', 'published')`,
    [IDS.buyerUser, IDS.prodAI],
  )

  // A sample progress row so the Continue Watching rail has something to show
  await c.query(
    `INSERT INTO public.progress (user_id, product_id, lesson_id, position_seconds, completed, last_watched_at) VALUES ($1::uuid, $2::bigint, $3::bigint, 240, false, now() - interval '1 day')`,
    [IDS.buyerUser, IDS.prodAI, 101 /* first lesson of AI course */],
  )

  console.log('💵 sample payout ledger for the partner…')
  // One locked + one available + one paid row, so all 3 dashboard cards have something.
  await c.query(
    `INSERT INTO public.payout_ledger (partner_id, kind, status, amount_cents, currency, description, available_at, locked_until, created_at) VALUES
    ($1, 'order_sale', 'locked',    12500, 'USD', 'Order #1001 — AI course',      now() + interval '12 days', now() + interval '14 days', now() - interval '1 day'),
    ($1, 'order_sale', 'available',  9800, 'USD', 'Order #1002 — BizFund',         now(),                                       null,                       now() - interval '20 days'),
    ($1, 'payout',     'paid',      50000, 'USD', 'PayPal batch PA-2026-001',        now() - interval '5 days',                    null,                       now() - interval '30 days')`,
    [IDS.partnerKlaas],
  )

  console.log('⚙️  seeding the platform_settings singleton row…')
  await c.query(
    `INSERT INTO public.platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`
  )
  // Also seed app_settings if it exists (DMCA agent lives there per migration 0036).
  await c.query(
    `INSERT INTO public.app_settings (key, value, public_read) VALUES ('dmca_agent', jsonb_build_object('name', 'Klaas', 'email', 'klaas+dmca@uthena.com', 'address', 'PLR Wholesale, Inc., Ho Chi Minh City'), true) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
  ).catch(() => { /* app_settings may not exist if migration 0036 isn't applied yet — non-blocking. */ })

  console.log('\n✅ seed complete. Test URLs (use ports 3100 or 3101):')
  console.log('')
  console.log('   Public surfaces:')
  console.log('     http://localhost:3100/                              → home page')
  console.log('     http://localhost:3100/browse                        → catalog')
  console.log('     http://localhost:3100/products/ai-for-entrepreneurs  → PDP (AI course, with curriculum)')
  console.log('     http://localhost:3100/products/cold-email-playbook  → PDP (Cold Email)')
  console.log('     http://localhost:3100/affiliate-program             → public pitch page')
  console.log('')
  console.log('   Sign in (use the email value as both login and credential):')
  console.log('     customer →  buyer@uthena.com')
  console.log('     partner  →  klaas+partner@uthena.com')
  console.log('     admin    →  klaas+admin@uthena.com')
  console.log('')
  console.log('   After signing in:')
  console.log('     /library                            → buyer library (progress bar + Continue watching rail)')
  console.log('     /learn/ai-for-entrepreneurs/lessons/101 → first lesson of AI course (uses demo HLS)')
  console.log('     /partner                            → partner dashboard')
  console.log('     /admin                              → admin dashboard')
  console.log('     /admin/audit-log                    → audit log search UI')
  console.log('     /admin/payouts                      → admin payout queue')
  console.log('     /admin/moderation                   → content moderation queue')

  await c.end()
}

seed().catch((err) => {
  console.error('seed failed:', err.message)
  process.exit(1)
})
