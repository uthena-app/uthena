# Uthena — Architecture, Scale, & Privacy

> Working doc. Drafted 2026-06-12 by Mavis. **Designed for the v1 you actually need to ship — not over-engineered, not under-built.**
> Target scale at launch: **600+ products · 10K users · 100+ partners · ~5TB files · ~50K MAU**.

---

## TL;DR

- **Stack:** Next.js 15 (App Router) on Hetzner/Coolify · Supabase (Postgres + Auth + Storage) · Bunny.net Stream + Storage · Stripe (in) · PayPal Mass Payout (out) · Resend (email)
- **Database shape:** every "thing" (user, product, order, payout, file) is a row. Joins are cheap. RLS keeps partners from seeing each other's data.
- **Files:** never served from Supabase Storage in production. Originals live in Bunny.net Storage. Streamed videos go through Bunny.net Stream with signed URLs. Downloads use 24h signed URLs.
- **Privacy:** PII separated into its own table with a tighter RLS policy. Course progress, files accessed, payout history are all auditable.
- **Performance target:** p95 < 200ms for catalog/product pages, < 400ms for the player initial frame, < 1.5s for library.

---

## 1. The numbers we're designing for

| Metric | v1 target | Headroom to next bottleneck |
|---|---|---|
| Products | 612 | 5,000 (no schema change) |
| Active users (monthly) | 50,000 | 250,000 (one DB read replica) |
| Total users (all-time) | 100,000+ | 1M+ (partition `users` by created_at quarter) |
| Partners | 100 | 1,000 |
| File storage | 5 TB | 50 TB (move originals to S3 Glacier if needed) |
| Concurrent video streams | ~500 peak | 5,000 (Bunny scales for us) |
| Order rate | ~200/day, 10/min peak | 100/min (Stripe + webhooks) |
| Monthly payouts (partners) | 100 txns/month | 10,000/month (PayPal Mass Payout API batches) |
| Catalog page p95 | < 200ms | < 100ms (edge-cached HTML + ISR) |
| Player first frame | < 1.5s | < 800ms (Bunny HLS, CDN edge) |

These are not unreasonable numbers for a Postgres + Supabase + Bunny stack. The ones that *will* bite us if we don't design for them: **signed URL generation rate** (cheap to fix with caching), **catalog search at scale** (FTS is fine to 50K rows, swap to Meilisearch past that), and **payout ledger consistency** (use Postgres serializable transactions, not Stripe/PapPal as the source of truth).

---

## 2. Database schema (the parts that matter)

Supabase Postgres. Row Level Security **on** for every user-facing table. Partners, admins, customers are all `auth.users` with a role in `profiles`.

### Core tables

```
auth.users                          -- managed by Supabase Auth
profiles                            -- 1:1 with auth.users; role, name, avatar, locale
partners                            -- extends profiles; payout_method, tax_info, status
products                            -- 612 rows; title, slug, description, category, instructor_id
product_files                       -- many:1 products; kind (video|source|asset), storage_path, size, duration
product_modules                     -- modules within a product
product_lessons                     -- lessons within a module
product_pricing                     -- license_tier (whitelabel|plr|plr_mrr), price_cents, currency
categories                          -- 15 rows
categories_products                 -- join
product_assets                      -- landing_page_html, email_swipes, graphics_zip
```

### Commerce

```
orders                              -- one row per Stripe checkout; status, total_cents, currency
order_items                         -- (order_id, product_id, license_tier, unit_price_cents, instructor_share_cents, platform_share_cents)
payout_ledger                       -- immutable; the source of truth for partner money (see §6)
refunds                             -- (order_id, reason, status, requested_at, resolved_at)
```

### Engagement

```
library_grants                      -- (user_id, product_id, license_tier, granted_at, source) — what each user owns
progress                            -- (user_id, product_id, lesson_id, position_seconds, completed_at)
bookmarks                           -- (user_id, lesson_id, created_at)
reviews                             -- (user_id, product_id, rating, body, verified_buyer)
file_downloads                      -- (user_id, product_file_id, ip, user_agent, signed_at, expires_at) — audit log
```

### Partner + admin

```
partner_uploads                     -- (partner_id, status, draft_payload jsonb, submitted_at, reviewed_at, reviewer_id, decision, decision_notes)
partner_payout_methods              -- PayPal email, tax form status, KYC status
admin_audit_log                     -- (admin_id, action, target_table, target_id, before jsonb, after jsonb, at) — append-only
```

### Affiliate

```
affiliates                          -- (user_id, handle, bio, status, payout_method)
affiliate_links                     -- (affiliate_id, product_id?, code, target_url) — supports per-product links + default
affiliate_clicks                    -- (link_id, ip_hash, ua_hash, referer_hash, at) — for analytics
affiliate_commissions               -- (affiliate_id, order_id, commission_cents, status, locked_until) — locked = within refund window
affiliate_payouts                   -- monthly batch
```

### Indexes that matter (from day one)

```sql
create index on products (status, published_at desc) where status = 'published';
create index on products using gin (to_tsvector('english', title || ' ' || description));
create index on product_files (product_id, kind);
create index on orders (customer_id, created_at desc);
create index on order_items (product_id, created_at desc);
create index on library_grants (user_id);
create index on progress (user_id, product_id);
create index on file_downloads (user_id, created_at desc);
create index on payout_ledger (partner_id, created_at desc);
create index on affiliate_clicks (link_id, at desc);
```

### What we deliberately *don't* do in v1

- No event sourcing. We have `payout_ledger` (immutable) and `admin_audit_log` (append-only) for the two things that legally need it. Everything else is mutable rows.
- No microservices. One Next.js app, one Postgres. We split only when a profiler tells us to.
- No Kafka / Redis Streams. We use Supabase Realtime for in-app live updates and a Postgres-backed job queue (or `pg_cron` for scheduled) for everything else. Re-evaluate at 250K MAU.

---

## 3. Row Level Security (the part that makes multi-tenancy safe)

Default posture: **deny everything; allow by policy**. Every user-facing table has RLS on. The role lives in `profiles.role` (`customer` | `partner` | `admin`).

```sql
-- Example: products are public-readable when published; only the owning partner or admin can edit
alter table products enable row level security;

create policy "products_public_read" on products
  for select using (status = 'published');

create policy "products_partner_write" on products
  for all using (
    instructor_id = (select id from profiles where user_id = auth.uid())
  ) with check (
    instructor_id = (select id from profiles where user_id = auth.uid())
  );

create policy "products_admin_all" on products
  for all using (
    exists (select 1 from profiles where user_id = auth.uid() and role = 'admin')
  );

-- Library grants: users only see their own
alter table library_grants enable row level security;
create policy "library_self" on library_grants
  for select using (user_id = auth.uid());

-- Payout ledger: partners only see their own
alter table payout_ledger enable row level security;
create policy "payout_own" on payout_ledger
  for select using (partner_id in (select id from partners where user_id = auth.uid()));
```

The pattern for every table: **who can see it (read), who can change it (write), and is it ever cross-tenant (admin only).**

---

## 4. Files: the 5TB problem

We have 5TB of source video + course assets today. Strategy:

### Three storage tiers, one mental model

| Tier | Where | What lives here | Access |
|---|---|---|---|
| **Origin (cold)** | Bunny.net Storage (or Backblaze B2, cheaper) | Original uploaded source files (MP4, PPTX, ZIP, PDF) | Never served directly. Read by transcoding pipeline only. |
| **Stream (hot)** | Bunny.net Stream | HLS-encoded video variants (240p/480p/720p/1080p) | Served to players via signed URLs, 4h TTL. |
| **Edge cache** | Bunny CDN | Cached HLS segments and thumbnails | Free with Bunny. |

### Signed URL flow

```ts
// Server-side: a buyer requests a video. We check library_grants, then mint a signed URL.
const streamUrl = await bunny.getSignedUrl(videoId, {
  expiresIn: 4 * 60 * 60,             // 4h
  userIp: req.ip,                     // bind to IP for paranoia
  userId: user.id,                    // for revoke
  watermark: { text: user.email }     // visible watermark
});
```

```ts
// Server-side: a buyer requests a downloadable file (PDF, ZIP, etc.)
const downloadUrl = await storage.getSignedUrl(fileKey, {
  expiresIn: 24 * 60 * 60,            // 24h
  maxDownloads: 5,                    // optional abuse control
  filename: file.originalName
});
```

Every download is logged to `file_downloads` for audit + abuse detection. Hot-path is to log async, not block the response.

### Why not Supabase Storage for hot delivery?

Supabase Storage is fine for low-volume, signed-URL-friendly use, but it has **per-GB egress fees** and a smaller edge footprint than Bunny. At 5TB and growing, with a 50K MAU audience mostly streaming video, we'd be paying 3–5x more. Bunny's $0.005/GB egress with the free CDN tier wins this comfortably.

### Why not Supabase Storage for the originals either?

Because we want the originals behind a single, well-known API (Bunny Storage or B2) and we want the option to move them to a colder tier without rewriting call sites. Supabase Storage is good, but coupling our entire file pipeline to one vendor's primitives is a future-migration tax.

**Migration cost if we change later:** zero, because the file key + storage path are just strings in `product_files.storage_path`. We rewrite the URL generator and we're done.

### Cost reality check

| Item | Volume/month | Cost |
|---|---|---|
| Streaming egress (Bunny) | ~3 TB | ~$15 |
| Storage (Bunny) | 5 TB | ~$25 |
| Source storage (B2, cold) | 5 TB | ~$25 |
| Transcoding (Bunny) | ~50 new videos/month | ~$25 |
| **Total file infra** | | **~$90/month** |

Versus hosting the same on Supabase alone: ~$300+/month at this volume. So we save ~$2.5K/year on infra by going to Bunny + B2, and we get a better CDN.

---

## 5. Performance (the p95s we promised)

### Catalog & product pages (public, anonymous OK)

- **RSC + ISR.** App Router pages with `revalidate = 60` for the catalog index and product detail. Cache hit serves in <50ms.
- **Postgres FTS** for search. Trigram index on `title` for typo tolerance. We'll swap to Meilisearch when FTS gets slow (~50K products, we have 612 — we're nowhere near).
- **Image optimization** via `next/image` + Bunny CDN.
- **Edge cache** via Hetzner/Coolify → Cloudflare in front (already standard for Coolify setups).

### Course player

- HLS video, 4 variants (240/480/720/1080), auto-selected by bandwidth.
- Player initial frame: video element preloads only the manifest. First segment is the long pole.
- Watermark burned into the segment is a v2 feature (for now, client-side overlay).
- Progress: write to `progress` table every 10s of playback. Debounced.

### Library (authenticated)

- RSC, no ISR (it's personalized). One Postgres query for library_grants, one for in-progress metadata, one for file_downloads. Total < 50ms.
- File vault: lazy-load signed URLs only when user clicks "Generate link" (this is the abuse vector — we don't pre-mint signed URLs in bulk).

### Database connection pool

- Supabase's pooler (PgBouncer) is fine up to ~500 concurrent. Past that, switch to direct connections with our own pooler, or upgrade to Supabase Pro with the dedicated pooler.

---

## 6. Money: the payout ledger

This is the part that's hardest to retrofit, so we get it right from day one.

### Single source of truth: `payout_ledger`

```sql
create table payout_ledger (
  id bigserial primary key,
  partner_id bigint not null references partners,
  kind text not null check (kind in ('order_credit', 'refund_debit', 'payout_paid', 'adjustment')),
  order_id bigint references orders,
  amount_cents bigint not null,             -- positive = credit to partner, negative = debit
  currency text not null default 'USD',
  locked_until timestamptz,                -- within refund window = locked
  available_at timestamptz,                -- when this can be paid out
  status text not null check (status in ('pending', 'locked', 'available', 'paid', 'reversed')),
  external_id text,                        -- PayPal payout batch ID, once paid
  created_at timestamptz not null default now()
);
```

### Flow

1. **Order placed.** Webhook from Stripe. Inside a serializable transaction:
   - Insert `orders` row.
   - Insert `order_items` row.
   - Insert `payout_ledger` row with `kind='order_credit'`, `amount_cents = unit_price * 0.6`, `locked_until = now() + 14 days` (refund window), `status='locked'`.
   - Insert `library_grants` row.
2. **14 days pass** (cron job, daily). Move all locked entries with `locked_until < now()` to `status='available'`.
3. **1st of month** (cron job). For each partner with `available` balance >= $50:
   - Create a PayPal Mass Payout batch via the PayPal Payouts API.
   - On PayPal webhook (`PAYMENT.PAYOUTSBATCH.SUCCESS`): flip all included entries to `status='paid'`, store `external_id`.
4. **Refund.** Reverse the credit: insert `payout_ledger` row with `kind='refund_debit'`, negative amount. This keeps the running balance correct.

### Why this matters

If we ever have a partner dispute — "you underpaid me in February" — we have an immutable, queryable ledger. We don't have to reconcile against Stripe and PayPal separately. We don't lose data when one of them has an outage. We can show the partner *exactly* what they earned, what was reversed, and when it was paid.

### Idempotency

Every Stripe webhook and PayPal webhook is processed inside a "have I seen this event_id?" check. We store the event_id in a `processed_webhooks` table with a unique constraint. This means we can replay a webhook safely.

---

## 7. Privacy & data handling

We're a US-based company selling globally. We have EU customers → GDPR applies. We have a 14-day refund/return-right policy and we hold financial records for 7 years. We process payments through Stripe and PayPal, which are PCI-DSS compliant — we **never see a card number**.

### Data inventory (where PII lives)

| Data | Where | Who can see it | Retention |
|---|---|---|---|
| Email, name, password hash | `auth.users` (Supabase) | User themselves, admins | Until account deletion + 30 days |
| Billing address, tax ID (partners) | `partners` | Partner themselves, admins | 7 years (tax law) |
| Order history | `orders`, `order_items` | User themselves, admins | 7 years (financial record) |
| Course progress | `progress` | User themselves | Until account deletion |
| IP / user-agent on downloads | `file_downloads` | Admins (abuse review only) | 90 days |
| Payout history | `payout_ledger` | Partner themselves, admins | 7 years (financial record) |
| Watermarked video segments | Bunny Stream | Anyone with a valid signed URL (i.e. legitimate buyer) | Until product is unpublished |

### What we do

- **Encryption at rest:** Supabase default. Bunny default.
- **Encryption in transit:** TLS everywhere, HSTS preloaded, Hetzner/Coolify handles certs via Let's Encrypt.
- **Right to deletion:** Account deletion flow drops `auth.users` + cascades to `profiles`, `library_grants`, `progress`, `bookmarks`. We **anonymize** `orders` and `payout_ledger` (replace user_id with a hash) instead of deleting, because we have a 7-year financial record obligation.
- **Right to export:** "Download my data" button → JSON dump of everything we have on the user.
- **Cookies:** Supabase auth cookie is HttpOnly + Secure + SameSite=Lax. No third-party trackers in v1. Plausible for analytics (cookieless) when we add it.
- **Admin access:** every admin read of PII is logged to `admin_audit_log` (who, what, when). Yes, this includes admins reading their own data — we eat our own dog food.
- **Watermarking:** every video segment served to a buyer has their email burned in (v2). For now, a client-side overlay. The point: leaks are traceable.

### What we don't do in v1 (but document as a v2 promise)

- **DPA (Data Processing Agreement)** for enterprise partners. Standard contract, signed in dashboard.
- **SOC 2.** Not before year 2 of operation. We will need it eventually if we sell to mid-market.
- **Cookie consent banner.** Not needed because we don't use non-essential cookies. If/when we add Plausible or other analytics, we add one.

---

## 8. The 100-partners problem

Partners can upload courses, see sales, request payouts. The interesting failure modes are:

### Failure mode 1: Partner uploads a course they don't own the rights to

**Defense:** the review queue (already designed — see `admin.html`). Every new submission goes through it. Rights check is the first checkbox. Plagiarism check (vs. existing catalog) runs automatically on file hash + transcript similarity.

### Failure mode 2: Partner publishes, then we have to unpublish (DMCA, fraud)

**Defense:** soft-delete is the default. `products.status = 'unpublished'`. Buyer-side `library_grants` and `progress` survive. Buyer can still access the course (we don't yank it from under them — that's a class-action magnet). New orders blocked. Payouts to the partner for that product paused. Reversed in `payout_ledger`.

### Failure mode 3: Partner is also a customer (buys from us, sells to us)

**Defense:** single `auth.users` row, separate `profiles` row can have role `partner` AND `customer` simultaneously. They get one login, one billing relationship with us, but separate RLS policies. We can audit all their activity in one place.

### Failure mode 4: 100 partners upload 100 courses on launch day

**Defense:** async upload pipeline. Partner uploads → file goes to Bunny → transcoding queue → callback updates `product_files.status`. Partner can keep editing metadata while files transcode. We show them progress in the upload UI (we mocked this in `upload.html`).

---

## 9. Observability (we ship with this or we ship blind)

Three layers, all standard, all cheap:

1. **Logs.** Pino → stdout → Coolify → Loki. We don't run a heavy log pipeline.
2. **Metrics.** Prometheus on Hetzner scraping the Next.js process, the Postgres exporter, and Bunny's API. Grafana dashboards for the things we want to watch:
   - p50/p95/p99 page latency by route
   - DB connection pool utilization
   - Queue depths (uploads, payouts, emails)
   - Stripe / PayPal webhook lag
   - Error rate by route (5xx per minute)
3. **Errors.** Sentry on server + client. Source maps uploaded on build. PII scrubbed at the SDK level (no emails, no card data, no auth tokens).

### What we alert on

- 5xx rate > 1% for 5 min
- Payout cron hasn't run in 25h
- Bunny transcoding queue > 100 items
- Stripe webhook failure rate > 5% in 10 min
- DB CPU > 80% for 10 min

### What we don't alert on (avoid pager fatigue)

- 4xx rate (user error, normal)
- Single failed webhook (we retry)
- Disk filling slowly (we monitor trend, not point)

---

## 10. Disaster recovery

- **Database:** Supabase managed Postgres with PITR (point-in-time recovery) for 7 days. Nightly logical backups to B2 (off-site) for 30 days. We can lose up to 24h of writes and recover in <2h.
- **Files:** Bunny + B2 replicate within their own infra. We're not running our own storage.
- **Code:** Git is the source of truth. Coolify deploys are atomic; rollbacks are one click.
- **Secrets:** Doppler (or Vault, or AWS SSM — pick one and document it). No secrets in .env, ever.
- **RTO / RPO targets for v1:** RTO 4h, RPO 24h. We revisit these once we have real revenue.

---

## 11. Build order (the v1 slice that doesn't paint us into a corner)

1. **Catalog + product page + checkout (Stripe).** RSC, ISR, FTS, RLS. This is the part that makes money.
2. **Auth + library + course player + file vault.** Bunny signed URLs, file_downloads audit. This is the part that delivers what people paid for.
3. **Migration from Shopify.** Read-only Shopify API, match users by email, port orders, preserve digital access. The boring-and-critical step.
4. **Partner portal + upload + admin review queue.** The partner funnel. With rights checks baked into the review queue, not bolted on later.
5. **Affiliate dashboard + mini-shop + PayPal Mass Payout.** The second growth loop. Once 1–4 are stable.

If we hit a wall at any of these, we re-evaluate. But the schema and the security model are designed to support all five before we start, so we don't have to migrate data later.

---

## 12. Open questions for you (Klaas)

1. **Supabase region.** Where is your data most likely to live? EU (Frankfurt) for GDPR comfort, or US (Virginia) for lower latency to most customers?
2. **Coolify self-host vs. managed.** Coolify on Hetzner is what we use for GrabLTD and it's working. Stay consistent?
3. **PII / DPA scope.** Do any of your partners (or their buyers) require a signed DPA before they can transact? Worth knowing for v1 vs v2.
4. **Watermarking in v1 or v2?** I lean v2 (post-MVP, before scale). The infra to do it cleanly (per-user CDN edge function) is non-trivial.
5. **Refund window for partner credits.** 14 days is the product policy and the partner-credit lock window. We can tune this later, but v1 uses the same 14-day window everywhere to avoid mismatched buyer and payout behavior.

I can answer all five with reasonable defaults and we can move. Just say "go with defaults" if you want me to.
