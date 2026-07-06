# Uthena — Production Hardening Backlog

> Audit date: **2026-07-03**. Companion docs: [`AUDIT-2026-07-03.md`](./AUDIT-2026-07-03.md) (full findings) and [`DECISIONS-NEEDED.md`](./DECISIONS-NEEDED.md) (owner input).
>
> **This file is written for a Sonnet 4.6 agent to execute.** Each task is self-contained: it names the files, the change, and how to verify it. Work top-down within each section (they are ordered by severity). Follow `AGENTS.md` and the **ponytail** rule — the smallest change that works, deletion over addition, no new dependency if an installed one or a platform feature covers it. Every non-trivial change leaves one runnable check behind.
>
> **Definition of done for any task:** `pnpm typecheck` clean, `pnpm lint` exit 0, relevant `pnpm test` green, and the task's own acceptance check passes. Do not mark a task done with a red suite.
>
> ⚠️ Tasks tagged **[DECISION]** are blocked on owner input — see `DECISIONS-NEEDED.md`. Do not guess; leave them until the decision is recorded here.

---

## 0. Already fixed in this pass (do NOT redo)

These were applied directly during the audit and are verified green. Listed so you don't duplicate them.

- **SEC** — Search PostgREST filter injection: `02-features/search/queries.ts` token sanitizer now strips `, ( ) . :` in addition to LIKE wildcards.
- **SEC** — `/api/files/[id]/stream` security-header class: it returns JSON, not a 302, so `00-foundations/security/headers.ts` `classifyPath` now returns `json` for `/stream` (keeps HSTS + X-Frame-Options); `/download` alone stays `binary`. Tests updated in `headers.test.ts`.
- **SEC** — RLS coverage guard: `04-platform/ci/scripts/check-rls-coverage.sh` now also scans `supabase/migrations/` (the core schema lived outside its glob — this is why SEC-1 below slipped through).
- **DESIGN** — Fonts: Inter, Inter Tight, JetBrains Mono now load via `next/font/google` in `app/layout.tsx`; `tokens.css` `--font-*` point at the injected CSS variables. This was the single biggest "AI-built" tell — the whole app was rendering in system fonts.
- **DESIGN** — `00-foundations/design/primitives.css` `.justify-end` had `justify-content: justify-end` (invalid) → `flex-end`.
- **QUALITY** — `package.json` had a duplicate `db:bootstrap:full` key; the seeding variant was silently dead (JSON keeps the last). Removed the non-seeding duplicate; `db:bootstrap:full` now seeds again.
- **QUALITY** — `.gitignore` hardened (`*.tsbuildinfo`, `*.bak*`, `*.zip`, `output/`, `.harness/`, `.mavis/`, `.opencode/`, `next-env.d.ts`, de-duped `.DS_Store`).
- **QUALITY** — 2 of 3 pre-existing test failures fixed: `getLegalMarkdown.test.ts` hardcoded absolute path → `path.join(process.cwd(), …)`; `headers.ts` dev-CSP relaxation now triggers only on `NODE_ENV==='development'` (was `!== 'production'`, which wrongly relaxed the policy under `test` and turned CI red).

---

## 1. Security

### SEC-1 — [CRITICAL] Privilege escalation: any user can make themselves admin
- **Where:** `supabase/migrations/0001_initial.sql` — policy `profiles_self_update` (~line 239). Duplicated in `04-platform/migrations/0001_initial.sql`.
- **Problem:** The policy gates *which row* a user may update (`user_id = auth.uid()`) but not *which columns*. Supabase grants the `authenticated` role table-level UPDATE, gated only by RLS. A logged-in customer can run, from the browser with the anon client, `supabase.from('profiles').update({ role: 'admin' }).eq('user_id', myId)` and become admin. `is_admin()` then unlocks every `*_admin_all` policy (orders, refunds, payouts, library_grants, platform_settings). App-layer `requireRole` guards are irrelevant — this bypasses them at the DB tier. **This is directly exploitable and must close before launch.**
- **Fix (ponytail — trigger is the robust minimal option):** add a new migration `04-platform/migrations/00NN_lock_profile_role.sql` with a `BEFORE UPDATE` trigger on `profiles` that raises unless the role/status is unchanged or the caller `is_admin()`:
  ```sql
  create or replace function forbid_self_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
  begin
    if (new.role is distinct from old.role or new.status is distinct from old.status)
       and not is_admin() then
      raise exception 'not authorized to change role/status';
    end if;
    return new;
  end $$;
  create trigger profiles_lock_role before update on profiles
    for each row execute function forbid_self_role_change();
  ```
- **Verify:** add `06-quality/tests/rls/` case (or a SQL test) asserting a non-admin `update … set role='admin'` is rejected and a normal `display_name` update still succeeds. Confirm `pnpm check:rls` passes (it now scans `supabase/migrations`).

### SEC-2 — [HIGH] Maintenance-mode cookie is unsigned and client-forgeable
- **Where:** `middleware.ts` (~line 170), `02-features/admin/platform-settings/lib/maintenance.ts` (`parseMaintenanceEnabledCookie`, and the setter `updateMaintenanceAction`).
- **Problem:** The middleware trusts any inbound `uthena_maintenance_enabled=1` cookie. A visitor can only 503 *themselves* (cookies are per-client, so no global outage — hence HIGH not CRITICAL), but a subdomain-injected cookie can persistently 503 a victim, and DB "off" doesn't clear a stale victim cookie for 60s.
- **Fix (ponytail — reuse `AUTH_SECRET`, no new dep):** in the setter, store an HMAC-SHA256 of the value (`crypto` is available at the edge via Web Crypto / in the action via `node:crypto`); in `parseMaintenanceEnabledCookie` verify the MAC and reject unsigned/forged values. Add the `__Host-` cookie name prefix (forces Secure + `path=/` + host-only, blocks subdomain injection).
- **Verify:** unit test in the platform-settings suite: a hand-crafted `=1` cookie without a valid MAC does NOT trigger maintenance; the setter's own cookie does.

### SEC-3 — [HIGH + DECISION] No durable rate limiting on public write endpoints
- **Where:** `app/api/errors/report/route.ts` (no limiter despite a comment claiming one), `app/api/search/route.ts` (none). Plus 8 in-process `Map` limiters that are per-instance and reset on deploy / don't hold across multiple Node instances.
- **Blocked on:** [DECISION D3] — durable rate-limit infra (Supabase `rate_limit_events` table, already planned as P18.8, vs edge KV like Upstash).
- **Interim (do now, QUICK):** add the existing in-process sliding-window limiter (see `00-foundations/files/rate-limit.ts`) to `/api/errors/report` (e.g. 30/min/hashed-IP, still return 204) and `/api/search` (e.g. 60/min). Mark with a `ponytail:` comment naming the per-instance ceiling and the D3 upgrade path.
- **After D3:** extract one shared limiter (see QLT-7) backed by the chosen store; replace all 8 Maps + the two interim guards.
- **Verify:** test that the N+1th request in a window returns 429 (or 204 for errors/report) from a single instance.

### SEC-4 — [MEDIUM] CSP allows `'unsafe-inline'` for scripts (no nonces)
- **Where:** `00-foundations/security/headers.ts` `CSP_DIRECTIVES` (`script-src 'self' 'unsafe-inline' …`).
- **Problem:** `'unsafe-inline'` defeats CSP's core XSS mitigation. No active injection sink today (React escapes; the only `dangerouslySetInnerHTML` is JSON-LD, `</`-escaped), so this is defense-in-depth loss, not an open hole. Already tracked in `_followups.md`.
- **Blocked on:** [DECISION D12] — confirm this is a post-launch follow-up.
- **Fix (PLAN, when scheduled):** generate a per-request nonce in `middleware.ts`, thread it to `next/script` and inline scripts, inject `'nonce-…'` into `script-src`, drop `'unsafe-inline'`. Non-trivial in App Router — budget a focused session.

### SEC-5 — [MEDIUM] Bunny webhook accepts either secret on either surface
- **Where:** `04-platform/webhooks/bunny/handleBunnyWebhook.ts` (~line 66), `bunny-webhook-signature.ts`.
- **Problem:** Signature verify tries both `BUNNY_WEBHOOK_SECRET` and `BUNNY_VIDEO_WEBHOOK_SECRET` against every request, so a leaked storage secret also validates video events and vice-versa — the intended secret separation is nominal. HMAC verify itself is correct/timing-safe.
- **Fix (QUICK, ~8 lines):** pick the surface-appropriate secret from which header is present (`X-Bunny-Signature` → video, `Signature` → storage) instead of the combined list.
- **Verify:** test that a video-secret signature is rejected on the storage path.

### SEC-6 — [LOW] Harden server-only boundary on the service client
- **Where:** `00-foundations/data/supabase.ts` (`getServiceSupabase`).
- **Fix (QUICK):** add `import 'server-only'` at the top of the module that exports the service-role client so a future accidental client import fails the build. (Verified today: no `'use client'` file imports it — keep it that way.)
- **Verify:** `pnpm build` still passes; no client bundle references it.

### SEC-7 — [LOW + DECISION] `/api/health` exposes which integrations are configured
- **Where:** `app/api/health/route.ts` — returns booleans for stripe/bunny/ses/sentry.
- **Blocked on:** [DECISION D14] — accept (it's a probe) or gate behind an infra allowlist / strip the booleans for anon callers.

---

## 2. Design / UI / UX

> The design *system* is genuinely good; the "AI-built" feel came almost entirely from (1) fonts never loading [FIXED], (2) placeholder hero art, and (3) ~⅓ of surfaces written against invented token names that silently fall back to nothing. Fixing DSN-1..DSN-3 will move perceived quality more than any redesign.

### DSN-1 — [HIGH] Token-vocabulary drift: ~40 phantom tokens, hundreds of usages
- **Problem:** Large parts of the app reference tokens defined nowhere: `--radius-md` (89×), `--radius-sm` (74×), `--fg-muted` (61×), `--fg` (56×), `--font-size-sm` (46×), `--gap-3`, `--weight-medium`, `--bg-1/--bg-2`, `--warn-fg`, etc. 43 usages have no fallback, so e.g. `border-radius: var(--radius-md)` computes to **0**.
- **Fix (one codemod pass, ponytail = mechanical rename + deletion):** map to the canonical names in `00-foundations/design/tokens.css`: `--radius-* → --r-*`, `--fg → --text-1`, `--fg-muted → --text-2`, `--gap-* → --space-*`, `--bg-1/--bg-2 → --bg-elev-1/--bg-elev-2`, `--font-size-*`/`--weight-*` → the literal scale value. **Delete the per-usage fallbacks** (`var(--x, #111)`) — they defeat theming and hide the drift. Do it dir-by-dir (`app/`, `02-features/`) with `grep -rn 'var(--radius-\|var(--fg\|var(--gap-\|var(--bg-1\|var(--font-size-\|var(--weight-'` and verify counts drop to zero.
- **Then add a CI gate:** a small script (`04-platform/ci/scripts/check-design-tokens.sh`) that greps `app/ 02-features/` for `var(--…)` names not defined in `tokens.css` and fails. Wire into `check:all`.
- **Verify:** the grep finds zero undefined tokens; pages that were black-on-black now render.

### DSN-2 — [HIGH] Admin pages render near-invisible text (subset of DSN-1, call out for speed)
- **Where:** `app/admin/customers/customers.module.css:10` (`color: var(--fg, #111)` → `#111` on the `#0E1012` page), `app/admin/partners/partners.module.css:10`, `app/admin/customers/[id]/page.module.css:14,31,47`, `02-features/admin/customers/components/CustomerTable.module.css:6` (`#fff`/`#fafafa` card fills against a dark canvas).
- **Fix:** rename `--fg`→`--text-1`, `--fg-muted`→`--text-2`, delete the light-canvas `#fff`/`#fafafa` fills. Confirm admin is dark like the rest ([DECISION D7]).

### DSN-3 — [HIGH] Home hero is four gray gradient placeholder cells
- **Where:** `02-features/home/Hero.module.css:165-184` (gradient placeholders), `02-features/home/Hero.tsx`.
- **Fix:** `Hero.tsx` already receives real products via `getHomeHeroCells()`. Render `<img>` (or `next/image` per PRF-2) from `thumbnail_url`, keep the gradient only as a load fallback. Direction confirmed by [DECISION D6].

### DSN-4 — [MEDIUM] Five competing button systems
- **Where:** global `.btn-primary` (`primitives.css:77`), React `Button` (`00-foundations/ui/primitives/primitives.module.css`), header pills (`app/SiteHeader.module.css:169`), hero pills (`Hero.module.css:63`), fully inline-styled buttons (`app/[handle]/not-found.tsx:73`).
- **Fix (net deletion):** keep `00-foundations/ui/primitives/Button.tsx` as the one implementation; add a `pill` variant prop for header/hero; align its ghost variant to **teal** per the design README; delete the local re-implementations.
- **Verify:** visually diff a couple of pages; buttons share one radius/weight/hover.

### DSN-5 — [MEDIUM] ~30 files styled entirely with inline `style={{}}` (99 occurrences)
- **Where:** list them: `grep -rl 'style={{' app 02-features`. Worst: `app/[handle]/not-found.tsx`, `app/[handle]/loading.tsx`, `app/admin/payouts/page.tsx`, `app/403/page.tsx`, `app/update-password/page.tsx`.
- **Fix:** move to `.module.css` using existing primitives (`EmptyState`, `RouteError`, `Skeleton` already exist and are good). Inline styles have no hover/focus states and bypass tokens.

### DSN-6 — [MEDIUM] Cart & checkout prices are not in mono (brand: *every* price is mono)
- **Where:** `02-features/checkout/components/OrderSummary.module.css:61-81`, `02-features/cart/components/CartSummary.module.css:33-62` (only `tabular-nums`). `ProductCard` does it right.
- **Fix:** add `font-family: var(--font-mono)` to the amount cells. (Meaningful now that fonts load.)

### DSN-7 — [MEDIUM] The two designed "temperature" mechanisms are dead code
- **Where:** the tri-color conic pip (mockup `mockups/index.html:42`) appears nowhere; the section-tint utilities (`tokens.css:211-216`, `.sec.tint-*`) are never used.
- **Fix:** add the 8px conic pip to the home hero eyebrow (`Hero.tsx`, one per page only per brand), and apply `tint-raised` to the NewsletterBand. Nothing else — these are the brand's one sanctioned flourish.

### DSN-8 — [MEDIUM] Auth card is off-system; no logo where the brand says it belongs
- **Where:** `app/login/auth.module.css:15` (`border-radius: 16px`, off the 6/8/10/14/18 scale), `:17` raw `box-shadow` bypassing `--shadow-md`; `02-features/auth/AuthForms.module.css:12` (h1 28px, off scale).
- **Fix:** `--r-lg` + `var(--shadow-md)`, h1 → 24px, add the full-color wordmark (brand doc says login/signup is where it "earns its keep").

### DSN-9 — [LOW] Missing interaction states
- `Button` loading state has no visual (`00-foundations/ui/primitives/primitives.module.css:79` — only `cursor: wait`; `aria-busy` is already wired) → add a spinner.
- Input fill should be `--bg-elev-3` per README (currently `--bg-elev-1`).

### DSN-10 — [LOW + DECISION] Text-glyph icons vs the promised `icons.tsx`
- **Where:** `app/SiteHeader.tsx:112` (`⌕`), `02-features/library/components/VideoPlayer.tsx:563` (`❚❚` etc.). The design README promises `icons.tsx`, which does not exist.
- **Fix:** [DECISION — small] either create `00-foundations/ui/icons.tsx` (inline SVGs, no dependency) and replace glyphs, or amend the README. Right now doc and code contradict each other.

---

## 3. Structure & Code Quality

### QLT-1 — [CRITICAL + DECISION] No git repository
- **Problem:** The repo is not under version control. Consequence is visible: 13 timestamped `.bak` files acting as manual version control (one inside `04-platform/migrations/`). One `rm -rf` from losing the product.
- **Blocked on:** [DECISION D1]. Strongly recommended: `git init`, commit, add a remote. `.gitignore` is now ready. Costs nothing even if never pushed.

### QLT-2 — [HIGH] Delete build/junk clutter (~103MB, plus 909MB `.next` cache)
- **Safe to delete now** (all regenerable or dead): `STUBS.md.bak.*` (6 files, ~1.6MB), `uthena-demo.zip` (5.7MB), `tsconfig.tsbuildinfo` (3.1MB, build artifact), `output/` (408KB, old Playwright run), 23× `.DS_Store`, `single_mig.ts` (dead one-off, hardcoded local DB port, applies only migrations 1–25), `07-archive/` (empty), `00-foundations/data/enums.ts.bak.*`, `docs/PROGRESS.md.bak.*`, `04-platform/migrations/0044_*.sql.bak.*`, `04-platform/emails/legal/**/*.md.bak.*`, `.harness/` (only a `.DS_Store`), stale one-off docs `deliverable.md`, `deliverable-ph15s1.md`, `REVIEW-2026-06-12.md`. The `03-app -> app` symlink is a legacy alias nothing imports — delete.
- **Blocked on [DECISION D11]:** `mockups/` (6.9MB — live design source, referenced by "mockup-faithful" comments; probably keep or move under `01-specs/`), `demo/` (5.9MB static prototype), `.mavis/`/`.opencode/` (agent state — keep while those workflows are active).
- **Verify:** `pnpm typecheck && pnpm test` still green after deletions.

### QLT-3 — [HIGH] STUBS.md is 393KB / 3,125 lines — unmanageable
- **Problem:** ~100 stubs, only 5 marked resolved inline, resolved items rarely moved to `STUBS-archive.md`; no severity field; **duplicate ID STUB-122** (used for both P14.8 order-detail actions and P14.9 refunds). It grew 136KB→393KB in 4 days.
- **Fix (PLAN):** convert to `stubs.json` (id, phase, severity, owner, status, summary) + a generated `STUBS.md` view, or split into `STUBS/PH<NN>.md`. Add a unique-ID check and an auto-archive step for `status: resolved` to `check:all`. Delete the 6 root `.bak` snapshots (that's what the archive file is for).

### QLT-4 — [HIGH] RESOLVED 2026-07-03 — Production-blocking payment/payout stubs (must close before Stripe live)
Closed in the Stripe-live hardening pass — see each STUB entry in `STUBS.md` for the full mechanism + tests:
- **STUB-062** — RESOLVED. Atomic `mark_order_paid_and_grant` RPC (`04-platform/migrations/0070_atomic_order_paid_rpc.sql`) does the paid-flip + grants + ledger writes in one Postgres transaction; a ledger-insert failure now rolls back the paid-flip too, so the webhook retry safely reprocesses. `onPaymentSucceeded.test.ts` "STUB-062: RPC failure is NOT silently swallowed".
- **STUB-063** — RESOLVED. New `onPaymentFailed.ts` handles `payment_intent.payment_failed` / `checkout.session.expired` / `checkout.session.async_payment_failed`; cancels the order (`orders.canceled_at`, migration `0071`) and releases cart lines. `onPaymentFailed.test.ts`.
- **STUB-061** — RESOLVED. New `onDispute.ts` handles `charge.dispute.created` / `charge.dispute.closed`; freezes payout_ledger rows on open, claws back with a negative `kind='dispute'` row on a lost dispute (migration `0072` adds the `pending_dispute` status + `dispute` kind enum values). `onDispute.test.ts`.
- **STUB-006** — RESOLVED. `automatic_tax` + `billing_address_collection: 'required'` on the Stripe session; the authoritative `session.total_details.amount_tax` is persisted onto `orders.tax_cents`/`total_cents` via the same atomic RPC. `createCheckoutSession.test.ts` + `onPaymentSucceeded.test.ts`. `ponytail:` still needs Stripe Tax enabled + a tax registration in the Stripe Dashboard (Settings → Tax) to compute non-zero tax.
- **STUB-052** — RESOLVED. New cron `04-platform/ci/scripts/cron/reencrypt-legacy-payout-methods.ts` sweeps legacy plaintext `partners.payout_method` rows and re-encrypts them with the existing `encryptString()` helper. `reencrypt-legacy-payout-methods.test.ts`.
- Migrations 0070-0072 all include `enable row level security` re-assertions per the CI RLS-coverage checker.

### QLT-5 — [MEDIUM + DECISION] Upgrade Next + React off the RC/vulnerable pins
- **Problem:** `next@15.0.3` is affected by **CVE-2025-29927** (middleware bypass, fixed 15.2.3) and CVE-2024-56332. Mitigating: middleware here does NOT gate auth, so the bypass only skips maintenance-mode + security headers, not auth — but upgrade regardless. `react@19.0.0-rc-*` + `@types/react@^18` is a latent mismatch (no React-19-only APIs used today, so typecheck passes; it will bite the first `useActionState`/`use()`).
- **Blocked on [DECISION D15]** (upgrade window). **Fix:** single move — `next@≥15.2.3`, `react@19.x` stable, `react-dom@19.x` stable, `@types/react@19`, `@types/react-dom@19`. Then full `pnpm test` + a manual smoke of auth, checkout, player.

### QLT-6 — [MEDIUM + DECISION] Migration `0005b` breaks the naming contract (the 1 remaining red test)
- **Where:** `04-platform/migrations/0005b_payout_ledger_lock_indexes.sql` vs the `/^\d{4}_.*\.sql$/` contract in `04-platform/ci/scripts/db-bootstrap.test.ts:83`. Also `single_mig.ts`'s `0005_*` glob silently skips `0005b`.
- **Blocked on [DECISION D10]:** rename `0005b_… → 0006_…` (and renumber the current `0006_cart_count_aggregate.sql` onward) vs. widen the regex to allow a letter suffix. Renaming a migration that may already be applied has ordering risk — hence a decision, not a blind fix.

### QLT-7 — [MEDIUM] `rateLimitVerdict` re-implemented 8 times
- **Where:** e.g. `02-features/partner-onboarding/actions/saveStep.rate-limit.ts:33`, `02-features/admin/platform-settings/lib/maintenance.ts:330`, `00-foundations/files/rate-limit.ts`, +5 more. Also 3× `formatDuration`, 2× `writeAuditLog`, money formatters re-implemented despite `00-foundations/money/cents.ts` `formatMoney`.
- **Fix (net deletion):** extract one `@foundations/rate-limit` sliding-window helper and one audit-log writer; replace the copies. Do this together with SEC-3's durable store so there's a single limiter.

### QLT-8 — [MEDIUM] Layer inversion: foundations imports from features
- **Where:** `00-foundations/structured-data/buildProductSchema.ts:26` imports types from `@features/catalog/queries` (type-only, but inverts layering).
- **Fix (QUICK):** move those shared types into `00-foundations/data/types.ts` and import from there in both places.

### QLT-9 — [LOW] Dependency freshening
- `supabase` CLI `^1.215.0` → v2 (devDep). `fflate@^0.4.8` → `0.8.x` (used in `02-features/library/buildBulkZip.ts`; run the library tests after). No known CVEs, just drift.

---

## 4. Speed & Smartness

### PRF-1 — [HIGH] ISR is dead: the whole site is dynamic (DB hit per request)
- **Problem:** Catalog pages declare `revalidate`, but the root layout reads cookies/headers (`SiteHeader` → `getServerSupabase` → `await cookies()`, and `getConsentBannerState` → `headers()`), which opts every route out of static rendering. The "ISR-cached 60s" comments never take effect. Home/browse/PDP re-run 3–6 Supabase queries per request.
- **Fix (PLAN, no new dep):** add a **cookie-less anon Supabase client** (plain `createClient(url, anonKey)` — `supabase-js` is already imported) for public catalog reads, and move session-dependent personalization (header cart badge, subscriber pricing) behind `<Suspense>` / a small client island so it doesn't taint the static render. Prove the pattern on sitemaps first (PRF-4).
- **Verify:** `next build` output shows catalog routes as static/ISR (`○`/`●`) not dynamic (`ƒ`).

### PRF-2 — [HIGH] `next/image` used in zero files — all raw `<img>`, full-size Bunny originals
- **Where:** `02-features/catalog/ProductCard.tsx:53`, `02-features/product/ProductGallery.tsx:116`, cart/checkout thumbs. `images.remotePatterns` in `next.config.mjs` is already configured but unused.
- **Fix (PLAN):** adopt `next/image` on `ProductCard` + `ProductGallery` first (config is ready), OR — smallest option, zero deps — append Bunny optimizer query params (`?width=&format=webp`) to the URLs. On a 60-card grid this dominates LCP/bandwidth.

### PRF-3 — [MEDIUM · QUICK] Double-fetch on detail pages (uncached `generateMetadata` + page)
- **Where:** `getProductBySlug` (`02-features/catalog/queries.ts:159`), `getMiniShop` (`02-features/affiliate-portal/queries/getMiniShop.ts:266`), `getCollectionBySlug` (`catalog/queries.ts:488`) are plain async fns called in both `generateMetadata` and the page → double the queries (getMiniShop ~8/render).
- **Fix (QUICK):** wrap each in React `cache()` — the files already import and use it for siblings. Convert `export async function foo(...)` → `export const foo = cache(async (...) => { … })`.
- **Verify:** add a tiny test or a request-count log confirming one call per render.

### PRF-4 — [MEDIUM · QUICK] Sitemaps are dynamic despite `revalidate=3600`
- **Where:** `app/sitemap-products.xml/route.ts` (+ collections, pages, `sitemap.xml`) use `getServerSupabase()` → `cookies()` → opts out of caching.
- **Fix (QUICK):** they read only published rows — swap to the cookie-less anon client from PRF-1 (do this route first; it's the cheapest proof of the pattern).

### PRF-5 — [MEDIUM · QUICK] `getActiveCategories` counts every product in JS
- **Where:** `02-features/catalog/queries.ts:335-357` — selects `category_id` of every published product (unbounded) and counts in a Map on every browse/home render, while fetching and discarding `product_count_cache`.
- **Fix (QUICK):** use `product_count_cache`, drop the live count. (PLAN follow-up: add the counting trigger the comment says is missing.)

### PRF-6 — [MEDIUM · QUICK] No LCP prioritization on images
- **Fix:** `fetchpriority="high"` on the PDP main gallery image (`ProductGallery.tsx:116`); pass an `eager` prop so the first 3–4 above-fold cards on home/browse aren't `loading="lazy"` (`ProductCard.tsx:57`).

### PRF-7 — [MEDIUM · QUICK] posthog-js eagerly in every page bundle, pre-consent
- **Where:** `00-foundations/analytics/posthog.ts:24` static `import posthog from 'posthog-js'`, reached from the root layout → ~50–60KB gz shipped to all visitors incl. non-consenters.
- **Fix (QUICK):** make `initPostHog` async and `await import('posthog-js')` inside it, guarded by the existing `initialized` flag + key check. No new dep.

### PRF-8 — [DECISION] Browse: price filter/sort run after `.limit(60)`; no pagination
- **Where:** `catalog/queries.ts:139-153` — `filterByPriceBucket`/`sortByPrice` applied post-fetch (so "Free" under-fills, matches beyond row 60 are missed); `/browse` has no `?page=`.
- **Blocked on [DECISION D8]:** the code comment already names the fix — denormalized `min_price_cents` column + SQL-side filter + real pagination. Decide before catalog grows.

### PRF-9 — [LOW→MED · PLAN] Search ignores the GIN index that exists for it
- **Where:** `02-features/search/queries.ts` uses per-token `ilike '%x%'` (seq scan) while `products_search_idx gin(search_vector)` exists (`supabase/migrations/0001_initial.sql:461`).
- **Fix:** switch to `.textSearch('search_vector', …)` — index already there, no migration. Fine at ~465 products; matters at thousands.

### PRF-10 — [LOW · optional] `hls.js` not lazy on Safari
- **Where:** `02-features/library/components/VideoPlayer.tsx:65` static import. Route-scoped, so contained. Safari plays HLS natively.
- **Fix:** dynamic-import `hls.js` only when `canPlayType('application/vnd.apple.mpegurl')` is falsy.

---

## Suggested execution order

1. **SEC-1** (blocks launch), then the security QUICK items (SEC-5, SEC-6, interim SEC-3).
2. **DSN-1 → DSN-3** (biggest perceived-quality jump), then the design QUICK items (DSN-6, DSN-9).
3. **QLT-2** (delete clutter) once **D1/D11** are answered; **QLT-4** payment stubs before Stripe live.
4. **PRF-3 → PRF-7** (all QUICK, high ROI), then **PRF-1/PRF-2** as a planned session.
5. Decision-gated items as their decisions land in `DECISIONS-NEEDED.md`.
