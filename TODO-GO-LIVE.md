# TODO-GO-LIVE.md — the live finalization task list

> Created **2026-07-06**, the day the repo moved to GitHub
> (`uthena-app/uthena`). This file is **the single live to-do list** for
> finishing Uthena v2. It supersedes the "⏳ REMAINING" section of
> [`FINALIZATION-PROGRESS.md`](./FINALIZATION-PROGRESS.md) (2026-07-03
> snapshot) and pulls in every still-open item from
> [`TODO-HARDENING.md`](./TODO-HARDENING.md). Original task IDs
> (`DSN-*`, `PRF-*`, `QLT-*`, `SEC-*`, `D1`–`D15`) are kept for
> cross-reference. All owner decisions D1–D15 are **answered** in
> [`DECISIONS-NEEDED.md`](./DECISIONS-NEEDED.md) — nothing below is
> blocked on a decision.
>
> **Who does what.** Workstreams **W1–W3** are coding tasks for **Qwen**
> (read [`QWEN.md`](./QWEN.md) every task — it is your operating manual;
> [`AGENTS.md`](./AGENTS.md) is the constitution). **W4** is deferred
> post-launch work — do not start it before launch. **W5** is the
> owner's (human) checklist — not code.
>
> **How to work this file (Qwen):**
> - Work top-down inside a workstream. One task per session. Tick the
>   box (`[ ]` → `[x]`) in the same change, with a one-line note only
>   if something surprising happened.
> - Definition of done for every task: the task's own **Verify** step
>   passes, plus `pnpm typecheck` clean, `pnpm lint` exit 0, and the
>   relevant `pnpm test` slice green. No `TODO`/`FIXME` in code — real
>   deferrals go to `STUBS.md`.
> - **Migration numbers:** `0085` is RESERVED for W2.7; `0086` is taken
>   (refund_status 'approved'). Anything new starts at **0087+**. Never
>   renumber or edit an applied migration.
> - **Git:** work on a feature branch, commit per task with a clear
>   message, PR into `main`. Never commit `.env*`, `node_modules`,
>   build output. CI must be green before merge.
>
> **Verified state when this list was written** (2026-07-03 run, Linux
> sandbox): `tsc --noEmit` 0 errors · `eslint . --quiet` exit 0 ·
> vitest **235 files, 4704 passed / 1 todo / 0 failed**. Workstreams
> A (security) and B (payments) from the finalization plan are landed
> and verified — do not redo them (see `FINALIZATION-PROGRESS.md §DONE`).

---

## W1 — Design / UI (was "Workstream C")

> **Goal:** kill the remaining "AI-built" tells. The design *system* is
> good; these tasks make the implementation obey it.
>
> **File lane (edit ONLY these; W2 must not touch them):** all
> `*.module.css`, `00-foundations/design/*.css`,
> `00-foundations/ui/primitives/Button.tsx` + `primitives.module.css`,
> NEW `00-foundations/ui/icons.tsx`, `app/SiteHeader.tsx` +
> `SiteHeaderActive.tsx` + `SiteHeader.module.css`,
> `02-features/home/Hero.tsx` + `Hero.module.css`,
> `02-features/catalog/ProductCard.tsx` + `.module.css`,
> `02-features/product/ProductGallery.tsx`, admin CSS, auth CSS,
> `02-features/library/components/VideoPlayer.tsx` (glyph icons only),
> `app/browse/browse.module.css`.
> **Do NOT touch:** `app/layout.tsx`, `02-features/catalog/queries.ts`,
> sitemap routes, `00-foundations/analytics/posthog.ts`,
> `next.config.mjs`, `package.json` (W2/W3 own those).

- [ ] **W1.1 (DSN-1) Token codemod — kill the ~40 phantom tokens.**
  Hundreds of usages reference tokens that don't exist in
  `00-foundations/design/tokens.css`; 43 have no fallback and compute
  to nothing (e.g. `border-radius: var(--radius-md)` → 0). Mechanical
  rename, dir-by-dir (`app/`, then `02-features/`):
  | wrong | canonical |
  |---|---|
  | `--radius-*` | `--r-*` |
  | `--fg` | `--text-1` |
  | `--fg-muted` | `--text-2` |
  | `--gap-*` | `--space-*` |
  | `--bg-1` / `--bg-2` | `--bg-elev-1` / `--bg-elev-2` |
  | `--font-size-*`, `--weight-*` | the literal value from the type scale in `tokens.css` |
  **Also delete every per-usage fallback** (`var(--x, #111)`) — they
  defeat theming and hid this drift.
  *Verify:* `grep -rn 'var(--radius-\|var(--fg\|var(--gap-\|var(--bg-1\|var(--bg-2\|var(--font-size-\|var(--weight-' app 02-features` returns zero hits.

- [ ] **W1.2 (DSN-1 gate) New CI script `04-platform/ci/scripts/check-design-tokens.sh`.**
  Greps `app/ 02-features/` for `var(--…)` names not defined in
  `tokens.css` and exits non-zero on any hit. Model it on the sibling
  `check-*.sh` scripts. Do **NOT** wire it into `package.json` —
  that happens in W3.3 (different file lane).
  *Verify:* script exits 0 on the clean tree; introduce a fake
  `var(--nope)` locally and confirm it exits 1; revert.

- [ ] **W1.3 (DSN-2, D7: admin stays dark) Admin dark-theme cleanup.**
  Strip the light-canvas `#fff` / `#fafafa` fills and `#111` text from
  admin CSS: `app/admin/customers/customers.module.css`,
  `app/admin/partners/partners.module.css`,
  `app/admin/customers/[id]/page.module.css`,
  `02-features/admin/customers/components/CustomerTable.module.css`.
  Replace with canonical dark tokens (`--bg-elev-*`, `--text-*`).
  *Verify:* no raw hex fills remain in admin CSS; pages legible on the
  dark canvas.

- [ ] **W1.4 (D5) Active nav goes teal.** The design README says the
  active nav item is teal (the "where you are" signal); code renders
  white. Switch the active state in `SiteHeader`/`SiteHeaderActive`
  (and portal sidebars if they share the pattern) to the teal token.
  *Verify:* active nav item renders teal on every shell.

- [ ] **W1.5 (DSN-3, D6: real covers) Hero art = real course covers.**
  `02-features/home/Hero.tsx` already receives real products via
  `getHomeHeroCells()`; the four cells render gray gradient
  placeholders from `Hero.module.css:165-184`. Render the product
  `thumbnail_url` images, keep the gradient only as a loading/error
  fallback.
  *Verify:* home hero shows 4 real covers with seeded data; graceful
  fallback when `thumbnail_url` is null.

- [ ] **W1.6 (DSN-4) One button system.** Five competing
  implementations exist (`primitives.css .btn-primary`, React
  `Button`, header pills, hero pills, inline-styled buttons). Keep
  `00-foundations/ui/primitives/Button.tsx` as THE implementation:
  add a `pill` variant prop for header/hero use, align the ghost
  variant to **teal** per the design README, then delete the local
  re-implementations and migrate call sites.
  *Verify:* grep shows no `.btn-primary` class usages left; buttons
  share one radius/weight/hover across pages.

- [ ] **W1.7 (DSN-5) Inline-style sweep.** ~30 files are styled
  entirely with `style={{}}` (99 occurrences) — no hover/focus states,
  bypasses tokens. List them with `grep -rl 'style={{' app 02-features`.
  Worst offenders: `app/[handle]/not-found.tsx`,
  `app/[handle]/loading.tsx`, `app/admin/payouts/page.tsx`,
  `app/403/page.tsx`, `app/update-password/page.tsx`. Move to
  `.module.css` using the existing primitives (`EmptyState`,
  `RouteError`, `Skeleton` already exist and are good).
  *Verify:* the grep count drops to ~0 (justified exceptions get a
  one-line comment naming why).

- [ ] **W1.8 (DSN-6) Prices in mono, everywhere.** Brand rule: every
  price is mono. Add `font-family: var(--font-mono)` to the amount
  cells in `02-features/checkout/components/OrderSummary.module.css`
  and `02-features/cart/components/CartSummary.module.css`
  (`ProductCard` already does it right).
  *Verify:* cart + checkout totals render in JetBrains Mono.

- [ ] **W1.9 (DSN-7) Ship the two sanctioned flourishes.** Add the 8px
  tri-color conic pip (see `mockups/index.html:42`) to the home hero
  eyebrow — one per page only — and apply the `tint-raised` section
  tint to the NewsletterBand. Nothing else gets a flourish.
  *Verify:* pip renders on home hero eyebrow; NewsletterBand has the
  tint; no other page gained either.

- [ ] **W1.10 (DSN-8) Auth card back on-system.**
  `app/login/auth.module.css`: `border-radius: 16px` → `--r-lg`, raw
  `box-shadow` → `var(--shadow-md)`. `02-features/auth/AuthForms.module.css`:
  h1 28px → 24px (scale value). Add the full-color wordmark to the
  login/signup card (the brand doc says this is where it earns its keep).
  *Verify:* no off-scale radius/shadow/font-size in auth CSS; wordmark
  visible on /login and /signup.

- [ ] **W1.11 (DSN-9) Interaction states.** `Button` loading state gets
  a visible spinner (currently only `cursor: wait`; `aria-busy` is
  already wired). Input fill moves to `--bg-elev-3` per the design
  README (currently `--bg-elev-1`).
  *Verify:* a `loading` Button visibly spins; inputs use `--bg-elev-3`.

- [ ] **W1.12 (DSN-10, D15: build it) Create `00-foundations/ui/icons.tsx`.**
  Inline SVG icon set, no new dependency. Replace the text glyphs:
  `app/SiteHeader.tsx` (`⌕`), `02-features/library/components/VideoPlayer.tsx`
  (`❚❚` etc.), and any other glyph the grep finds.
  *Verify:* no bare unicode glyph icons remain in TSX; icons render at
  both 16px and 20px cleanly.

- [ ] **W1.13 (PRF-2 + PRF-6) Images: `next/image` + LCP priority.**
  Adopt `next/image` on `02-features/catalog/ProductCard.tsx` and
  `02-features/product/ProductGallery.tsx` (`images.remotePatterns` in
  `next.config.mjs` is already configured — do not edit that file, it
  is W2's lane; if a pattern is missing, hand the one-liner to W2/W3).
  Add `fetchpriority="high"` on the PDP main gallery image and an
  `eager` prop so the first 3–4 above-fold cards on home/browse are
  not `loading="lazy"`.
  *Verify:* cards/gallery serve resized WebP via the image optimizer;
  Lighthouse LCP on home improves vs. before.

---

## W2 — Performance / data (was "Workstream D")

> **Goal:** resurrect ISR (the whole site currently renders dynamic —
> 3–6 Supabase queries per request), cut double-fetches, and fix the
> browse correctness bug (D8).
>
> **File lane (edit ONLY these; W1 must not touch them):**
> `app/layout.tsx`, `02-features/catalog/queries.ts`,
> `app/sitemap*.xml*` routes, `00-foundations/analytics/posthog.ts` +
> consent bridge, `next.config.mjs`, NEW
> `00-foundations/data/supabase-anon.ts`, NEW migration
> `04-platform/migrations/0085_min_price_cents.sql` (reserved number),
> `app/browse/page.tsx`, `00-foundations/data/types.ts`,
> `00-foundations/structured-data/buildProductSchema.ts`.
> **Do NOT edit `00-foundations/data/supabase.ts`** (Workstream A added
> `import 'server-only'` there — the new anon client is a separate file).
> **Do NOT touch** any `*.module.css`, `Hero.tsx`, `ProductCard.tsx`,
> `ProductGallery.tsx`, `Button`, icons, `SiteHeader.tsx` (W1's lane).

- [ ] **W2.1 (PRF-4 first — cheapest proof) Sitemaps go static.**
  Create `00-foundations/data/supabase-anon.ts`: a cookie-less anon
  client (`createClient(url, anonKey)` from `@supabase/supabase-js`,
  already a dependency). Swap the four sitemap routes
  (`app/sitemap.xml`, `sitemap-products.xml`, `-collections`, `-pages`)
  from `getServerSupabase()` (which reads `cookies()` and kills
  caching) to the anon client. They read only published rows.
  *Verify:* `next build` output marks the sitemap routes static/ISR
  (`○`/`●`), not dynamic (`ƒ`).

- [ ] **W2.2 (PRF-1) Resurrect ISR on the catalog surface.** The root
  layout reads cookies/headers (`SiteHeader` → `getServerSupabase` →
  `await cookies()`; `getConsentBannerState` → `headers()`), which
  opts EVERY route out of static rendering, so all the `revalidate`
  declarations are dead. Use the anon client from W2.1 for public
  catalog reads, and move session-dependent personalization (header
  cart badge, subscriber pricing) behind `<Suspense>` / a small client
  island so it no longer taints the static render.
  *Verify:* `next build` shows home/browse/PDP as static or ISR, not
  `ƒ`; cart badge still live for a signed-in user.

- [ ] **W2.3 (PRF-3) Kill the metadata double-fetch.** Wrap in React
  `cache()`: `getProductBySlug` (`02-features/catalog/queries.ts`),
  `getMiniShop` (`02-features/affiliate-portal/queries/getMiniShop.ts`),
  `getCollectionBySlug` (`catalog/queries.ts`). The files already use
  `cache()` for siblings — mirror that
  (`export const foo = cache(async (...) => { … })`).
  *Verify:* one query per render (request-count assertion or log), not
  two; getMiniShop drops from ~16 to ~8 queries per render.

- [ ] **W2.4 (PRF-5) `getActiveCategories` uses the cache column.**
  `02-features/catalog/queries.ts:335-357` currently selects the
  `category_id` of every published product and counts in a JS Map on
  every browse/home render, while fetching and discarding
  `product_count_cache`. Use `product_count_cache`, drop the live count.
  *Verify:* no unbounded product select in the function; counts still
  correct with seeded data.

- [ ] **W2.5 (PRF-7) posthog-js loads lazily, post-consent.**
  `00-foundations/analytics/posthog.ts` statically imports posthog-js
  (~50–60KB gz) into every visitor's bundle, pre-consent. Make
  `initPostHog` async and `await import('posthog-js')` inside it,
  guarded by the existing `initialized` flag + key check.
  *Verify:* posthog-js absent from the initial bundle
  (`next build` + bundle inspect); analytics still fire after consent.

- [ ] **W2.6 (PRF-9) Search uses the GIN index that exists for it.**
  `02-features/search/queries.ts` does per-token `ilike '%x%'` (seq
  scan) while `products_search_idx gin(search_vector)` already exists.
  Switch to `.textSearch('search_vector', …)`. Keep the existing token
  sanitizer (it closes a filter-injection vector — do not weaken it).
  *Verify:* search tests green; results still rank sensibly for
  multi-word queries.

- [ ] **W2.7 (D8/PRF-8 — approved) Browse: real price filter/sort +
  pagination.** Today the price filter/sort run in JS *after*
  `.limit(60)`, so "Free" under-fills and products past row 60 are
  unreachable. Ship migration **`0085_min_price_cents.sql`** (reserved
  number): denormalized `min_price_cents` column on `products` (+
  backfill + trigger or update path on price-tier change + RLS
  re-assertion per the CI checker), then move the filter/sort into SQL
  in `catalog/queries.ts` and add `?page=` pagination to
  `app/browse/page.tsx` (URL-driven, matches the existing filter
  pattern).
  *Verify:* `pnpm check:rls` green; a seeded catalog >60 products is
  fully reachable; "Free" bucket returns every free product; tests for
  the query change.

- [ ] **W2.8 (QLT-8) Fix the one layer inversion.**
  `00-foundations/structured-data/buildProductSchema.ts` imports types
  from `@features/catalog/queries` (foundations → features, wrong
  direction). Move the shared types into
  `00-foundations/data/types.ts`; import from there in both places.
  *Verify:* `pnpm typecheck` clean; no `@features/` import remains
  under `00-foundations/`.

---

## W3 — Repo chores (after W1 + W2 land)

> Sequenced last because they touch `package.json` / shared config —
> the one file lane W1 and W2 must both stay out of.

- [ ] **W3.1 (D9/QLT-5 — approved "before going live") Dependency
  upgrade in one move:** `next@≥15.2.3` (closes CVE-2025-29927
  middleware bypass + CVE-2024-56332), `react@19.x` **stable**,
  `react-dom@19.x` stable, `@types/react@19`, `@types/react-dom@19`,
  and `eslint-config-next` to match the Next version. Then
  `pnpm install`, full `pnpm test`, `pnpm build`, and a manual smoke
  of auth, checkout, and the video player.
  *Note:* the old "can't verify on Linux" caveat is gone — the repo now
  fresh-installs on Linux in CI (`.github/workflows/ci.yml`).
  *Verify:* CI fully green on the upgrade PR; smoke test passes.

- [ ] **W3.2 (QLT-9) Dependency freshening:** `supabase` CLI devDep
  `^1.215.0` → v2; `fflate@^0.4.8` → `0.8.x` (used in
  `02-features/library/buildBulkZip.ts` — run the library tests after).
  *Verify:* `pnpm db:types` still works against a local Postgres;
  library/zip tests green.

- [ ] **W3.3 Wire `check:design-tokens` into `check:all`** (the script
  lands in W1.2). Add the `"check:design-tokens"` script entry and
  append it to the `check:all` chain in `package.json`.
  *Verify:* `pnpm check:all` runs it and passes.

- [ ] **W3.4 Reconcile the port story.** `pnpm dev`/`start` bind 3100;
  `infra/Dockerfile`, compose, `README.md`, and `.env.example` say
  3000. Pick one story — recommended: keep **3000 in the container /
  production** (Coolify maps it) and **3100 for local dev**, then say
  so explicitly in `README.md` and `.env.example` comments so nobody
  "fixes" it back.
  *Verify:* README quick start works as written, container healthcheck
  still passes.

- [ ] **W3.5 Make the cron scripts runnable in production.** The five
  `cron:*` scripts + `reencrypt-legacy-payout-methods.ts` run via
  `tsx`, a devDependency — but the production image
  (`infra/Dockerfile` runner stage) contains only the standalone Next
  server, no `tsx`, no script sources. Options (pick smallest that
  works, ponytail rule): (a) a second lightweight "jobs" image built
  from the `builder` stage that has full `node_modules` + sources, run
  by Coolify scheduled tasks; (b) precompile the cron scripts to plain
  JS in `pnpm build` and copy them + prod deps into the runner. Document
  the choice in `docs/DEPLOYMENT.md §Cron`.
  *Verify:* each cron script runs to completion inside the chosen
  production container against a staging DB.

- [ ] **W3.6 (QLT-3) Restructure STUBS.md — do this LAST.** 3,200+
  lines, ~100 stubs, duplicate ID STUB-122, no severity field. Convert
  to `stubs.json` (id, phase, severity, owner, status, summary) + a
  generated `STUBS.md` view, or split into `STUBS/PH<NN>.md`. Add a
  unique-ID check to `check:all` and an auto-archive step for resolved
  entries (that's what `STUBS-archive.md` is for).
  *Verify:* unique-ID check green; resolved entries auto-archived;
  file(s) under 50KB each.

---

## W4 — Deferred / post-launch (owner-approved deferrals — do NOT start before launch)

- [ ] **(SEC-4, D12) CSP nonces** — drop `'unsafe-inline'` from
  `script-src` via per-request nonces in `middleware.ts` + `next/script`.
  Real work in the App Router; budget a focused session.
- [ ] **(D4) Light theme toggle** — `design-system-light.css` is
  complete but never imported; ship the toggle (island + localStorage +
  no-flash guard) as a fast follow.
- [ ] **(QLT-7) Full rate-limiter consolidation** — replace the 8
  in-process `Map` limiters + 2 interim guards with the durable
  `rate_limit_events`-backed limiter (infra landed in migration `0067`,
  helper in `00-foundations/files/rate-limit-shared.ts`).
- [ ] **Open feature stubs** — 18 open entries in `STUBS.md`, several
  blocked on missing specs (STUB-116 affiliate emails, STUB-128 admin
  2FA, STUB-129 admin role granularity). Write the spec first
  (`01-specs/pages/`), then build. Longer-horizon feature work beyond
  go-live lives in `PHASES.md` / `docs/PROGRESS.md`.

---

## W5 — Owner checklist (human tasks, not code)

> Full step-by-step in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

**Repo / GitHub**
- [ ] **Make the repository PRIVATE** (Settings → General → Danger
  Zone → Change visibility). As of 2026-07-06 `uthena-app/uthena` is
  **public** — the entire product source, specs, and business docs are
  world-readable. D1's intent was a private remote.
- [ ] Set `main` as the default branch (Settings → General → Default
  branch) — the first-pushed branch is currently the default.
- [ ] Protect `main`: require the `ci` checks before merge.
- [x] ~~D1: put the project under git + private remote~~ — done
  2026-07-06 (`uthena-app/uthena`, private).
- [x] ~~D2: check `.env.local` was never committed~~ — verified: the
  GitHub history starts from a clean initial commit with no `.env*`
  files. Rotation only needed if the file was ever shared by other
  means.

**Server / Coolify**
- [ ] Provision the server (Ubuntu LTS, ≥4GB RAM), install Coolify,
  connect the GitHub App, create the app from `infra/Dockerfile`
  (port 3000), set the dev domain + HTTPS.
- [ ] Enter environment variables in Coolify (list + which are
  required: `docs/DEPLOYMENT.md §Environment variables`).
- [ ] Schedule the cron jobs once W3.5 lands
  (`docs/DEPLOYMENT.md §Cron`) — includes
  `reencrypt-legacy-payout-methods` daily at `0 5 * * *`.

**Supabase**
- [ ] Create the hosted Supabase project; run migrations
  (`pnpm db:bootstrap` with `DATABASE_URL` pointing at it), then
  `pnpm db:verify`.
- [ ] Configure Auth (site URL, redirect URLs; OAuth providers when
  ready — see STUB-042 / `.env.example §OAuth`).

**Stripe (before flipping live — D13 confirmed launch-blocking)**
- [ ] Enable **Stripe Tax** + add a tax registration (Settings → Tax) —
  otherwise tax computes $0 (STUB-006 code side is done).
- [ ] Subscribe the webhook endpoint `/api/webhooks/stripe` to:
  `checkout.session.completed`, `checkout.session.expired`,
  `checkout.session.async_payment_failed`,
  `payment_intent.payment_failed`, `charge.dispute.created`,
  `charge.dispute.closed` (+ existing subscription events). Put the
  signing secret in `STRIPE_WEBHOOK_SECRET`.
- [ ] Live keys into Coolify env; test-mode end-to-end purchase first.

**Bunny / SES / analytics (as they come online)**
- [ ] Bunny: storage + stream zones; **separate** webhook secrets
  (`BUNNY_WEBHOOK_SECRET` vs `BUNNY_VIDEO_WEBHOOK_SECRET` — the handler
  enforces per-surface secrets since SEC-5); webhook URL
  `/api/webhooks/bunny`.
- [ ] SES: verify the sending domain, set `AWS_*` + `AWS_SES_FROM_EMAIL`.
- [ ] PostHog / Gorse / Sentry keys — all optional; every seam is
  env-gated and no-ops without a key.

---

## Launch gate (what "ready to go live" means)

1. W1 + W2 + W3.1–W3.5 all `[x]`, CI green on `main`.
2. `next build` + container boot verified on the Coolify server;
   `/api/health` returns ok behind the dev URL.
3. Stripe test-mode purchase → order paid → library grant → partner
   ledger row, end-to-end on staging.
4. W5 Stripe checklist done before live keys.
5. Manual smoke: signup → verify → browse → buy → watch → refund
   request; partner: onboard → upload → publish.
