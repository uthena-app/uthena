# Uthena — Go-Live Finalization: Progress & Resume State

> Live checkpoint. Last updated **2026-07-03** by the finalization run. Read this first to resume. Companion docs: `AUDIT-2026-07-03.md`, `TODO-HARDENING.md`, `DECISIONS-NEEDED.md` (all owner decisions D1–D15 are answered in that file).

## Where we are

Finalizing the repo for production. Decisions are all made. Work is partitioned into file-disjoint workstreams run by Sonnet agents; migration numbers are pre-assigned so parallel agents can't collide.

### ✅ DONE

**Phase 0 — direct audit fixes** (verified green earlier): fonts via next/font, search injection strip, `/stream` header class, RLS checker scans supabase/migrations, `.justify-end` bug, `.gitignore`, package.json dup key, 2 test fixes. See `TODO-HARDENING.md §0`.

**Phase 1 — housekeeping** (done, verified):
- Renamed migration `0005b_payout_ledger_lock_indexes.sql` → `0026_...` (0006 was taken; numbering already has gaps; content is perf-only `create index if not exists`, safe to run later). Updated its header + the reference in `0005_...`. The last red test (`db-bootstrap.test.ts`) now passes.
- D11 deletions applied: removed `STUBS.md.bak.*`, `uthena-demo.zip`, `tsconfig.tsbuildinfo`, `single_mig.ts`, `output/`, `07-archive/`, `.harness/`, `.mavis/`, `.opencode/`, all `*.bak*`, all `.DS_Store`, `03-app` symlink. **Kept** `mockups/` and `demo/` (demo not explicitly approved for deletion).

**✅ VERIFICATION (Workstreams A + B): GREEN.** After central checks + follow-up fixes: `tsc --noEmit` 0 errors, `eslint . --quiet` exit 0, full `vitest run` = **235 files, 4704 passed / 1 todo / 0 failed**. Follow-up fixes applied during verification: 8 `exactOptionalPropertyTypes` errors in B's two new test files (logCalls type); maintenance test `AUTH_SECRET` was 31 chars (needed ≥32); B's 4 payment-test mock-capture bugs (eqArgs/inArgs snapshotted before the fluent `.eq()/.in()` ran — fixed to capture by reference; production handlers were correct); one flaky `encryption.test.ts` "tampered auth tag" test (base64url last-char flip could alias to same bytes → now tampers at byte level). Launch-critical work is landed and green.

**Workstream A — Security** (DONE + verified):
- SEC-1: `04-platform/migrations/0066_lock_profile_role.sql` — BEFORE UPDATE trigger blocking self role/status change unless `is_admin()`. RLS test added to `06-quality/tests/rls/policies.ts`.
- SEC-3/D3: `0067_rate_limit_events.sql` (durable table, RLS service-role only) + new `00-foundations/files/rate-limit-shared.ts` + interim guards on `app/api/errors/report/route.ts` (30/min, 204) and `app/api/search/route.ts` (60/min, 429). Did NOT remove the 8 existing Map limiters (deferred).
- SEC-2: maintenance cookie now HMAC-signed via **Web Crypto** (`crypto.subtle`, because middleware is Edge runtime — NOT node:crypto), `__Host-` prefixed; `middleware.ts` `middleware()` is now **async**. Files: `maintenance.ts`, `updateMaintenanceAction.ts`, `middleware.ts` + tests.
- SEC-5: Bunny webhook picks secret by which header is present. `handleBunnyWebhook.ts` + test.
- SEC-6: `import 'server-only'` added to `00-foundations/data/supabase.ts`.
- D14: `app/api/health/route.ts` no longer leaks integration booleans (returns `{ok,app,env,version,time}`). Test added.

**Workstream B — Payments** (agent done; NOT yet centrally verified):
- STUB-062: `0070_atomic_order_paid_rpc.sql` — `mark_order_paid_and_grant(...)` SECURITY DEFINER RPC does paid-flip + library_grants + payout_ledger atomically. `02-features/checkout/actions/onPaymentSucceeded.ts` calls it; on failure returns `{ok:false}` so Stripe retries. (Also fixed ledger `available_at`.)
- STUB-063: `onPaymentFailed.ts` (new) handles `payment_intent.payment_failed` / `checkout.session.expired` / `async_payment_failed`; `0071_orders_canceled_at.sql`; wired into `handleStripeWebhook.ts`.
- STUB-061: `onDispute.ts` (new) handles `charge.dispute.created/closed`; `0072_payout_ledger_dispute_enums.sql` (new enum values `pending_dispute`, `dispute`); uses royalty_cents snapshot (ADR-0009).
- STUB-006: `createCheckoutSession.ts` sets `automatic_tax.enabled` + `billing_address_collection:'required'`; tax persisted on `checkout.session.completed` via the RPC. **Dashboard prereq**: Settings→Tax must be enabled.
- STUB-052: `04-platform/ci/scripts/cron/reencrypt-legacy-payout-methods.ts` (new) re-encrypts legacy plaintext PayPal emails using existing `00-foundations/security/encryption.ts` (AES-256-GCM). **Cron prereq**: schedule `0 5 * * *`.
- B also edited (out of its lane, justified): `00-foundations/data/enums.ts` (new enum members — required by check-enum-coverage), `STUBS.md` (marked 062/063/061/006/052 RESOLVED), `TODO-HARDENING.md` (QLT-4 resolved), `02-features/checkout/README.md`.

### ⏳ REMAINING (not started)

**Workstream C — Design/UI** (Sonnet agent). File ownership (edit ONLY these; sibling D must not be run on overlapping files): all `*.module.css`, `00-foundations/design/*.css` (tokens/primitives/design-system-*), `00-foundations/ui/primitives/Button.tsx` + `primitives.module.css`, NEW `00-foundations/ui/icons.tsx`, `app/SiteHeader.tsx`+`SiteHeaderActive.tsx`+`SiteHeader.module.css`, `02-features/home/Hero.tsx`+`Hero.module.css`, `02-features/catalog/ProductCard.tsx`+`.module.css`, `02-features/product/ProductGallery.tsx`, admin CSS, auth CSS, `02-features/library/components/VideoPlayer.tsx` (glyph icons only), `app/browse/browse.module.css`. Tasks: DSN-1 token codemod (`--radius-*→--r-*`, `--fg→--text-1`, `--fg-muted→--text-2`, `--gap-*→--space-*`, `--bg-1/2→--bg-elev-1/2`, delete per-usage fallbacks) + NEW `04-platform/ci/scripts/check-design-tokens.sh` (do NOT wire into package.json — orchestrator does that); D7 admin dark (strip `#fff`/`#fafafa`/`#111`); D5 teal active nav; DSN-3/D6 real hero covers from `thumbnail_url`; DSN-4 consolidate 5 button systems onto Button.tsx (+`pill` variant, ghost=teal); DSN-5 inline-style sweep (~30 files, `grep -rl 'style={{' app 02-features`); DSN-6 mono prices in cart/checkout CSS; DSN-7 tri-color conic pip on hero eyebrow + `tint-raised` on NewsletterBand; DSN-8 auth card `--r-lg`+`--shadow-md`, h1 24px, add wordmark; DSN-9 Button loading spinner + input fill `--bg-elev-3`; D15/DSN-10 create icons.tsx, replace glyphs. Also PRF-2 (next/image on ProductCard+ProductGallery) and PRF-6 (fetchpriority) since they live in C's component files. **Do NOT touch** layout.tsx, catalog/queries.ts, sitemaps, posthog, next.config, package.json.

**Workstream D — Performance/data** (Sonnet agent). File ownership: `app/layout.tsx`, `02-features/catalog/queries.ts`, `app/sitemap*.xml*` routes, `00-foundations/analytics/posthog.ts` + consent bridge, `next.config.mjs`, NEW `00-foundations/data/supabase-anon.ts` (cookie-less client — do NOT edit `data/supabase.ts`, A added server-only there), NEW `04-platform/migrations/0085_min_price_cents.sql` (RESERVED number), `app/browse/page.tsx` (pagination), `00-foundations/data/types.ts` + `00-foundations/structured-data/buildProductSchema.ts` (QLT-8 type move). Tasks: PRF-1 (cookie-less anon client for public catalog reads + move personalization behind Suspense so ISR re-activates), PRF-3 (wrap getProductBySlug/getMiniShop/getCollectionBySlug in `cache()`), PRF-4 (sitemaps use anon client), PRF-5 (getActiveCategories uses product_count_cache), PRF-7 (posthog dynamic `await import`), PRF-9 (search textSearch on gin index — but the search *route* rate-limit is A's; queries.ts is D's), D8 (min_price_cents column + SQL price filter/sort + `/browse` pagination), D6 hero *data* stays in C. QLT-8 type move. **Do NOT touch** any `*.module.css`, Hero.tsx, ProductCard.tsx, ProductGallery.tsx, Button, icons, SiteHeader.tsx.

**Me (orchestrator), after C+D:**
- package.json: D9 (`next@≥15.2.3`, `react`+`react-dom@19` stable, `@types/react`+`@types/react-dom@19`), QLT-9 (`supabase` CLI v2 devDep, `fflate@0.8`). ⚠️ Cannot verify in Linux sandbox (node_modules is macOS-arm64; changing versions needs `pnpm install` + smoke on the Mac). Do the edits, flag clearly. Wire `check:design-tokens` into `check:all`.
- QLT-3: restructure STUBS.md (split / add severity / unique IDs / auto-archive resolved). Do LAST.
- Final verification (see below).

**Deferred / post-launch (owner-approved):** SEC-4 CSP nonces (D12 post-launch), light theme toggle (D4), QLT-7 full limiter consolidation (removing the 8 Maps), QLT-3 nice-to-have.

**Owner's own tasks (not code):** D1 `git init` + private remote; D2 verify `.env.local` never committed, rotate service-role + AUTH_SECRET if it was.

## Reserved migration numbers
Used: 0026 (renamed), 0066, 0067 (A), 0070, 0071, 0072 (B). Reserved: **0085** for D (min_price_cents). Next free for any new work: 0086+.

## Verify next (central, orchestrator-owned — agents were told NOT to run tsc/vitest to avoid incremental-cache races)
1. **Recreate the vitest native shim** (node_modules is macOS-arm64; the Linux sandbox needs Linux binaries; `/tmp` shims are ephemeral per session):
   ```bash
   cd /tmp && mkdir -p vshim && cd vshim && npm init -y >/dev/null
   npm i @rollup/rollup-linux-arm64-gnu@4.62.0 --no-audit --no-fund
   npm i @esbuild/linux-arm64@0.21.5 --prefix /tmp/eb21 --no-audit --no-fund
   npm i @esbuild/linux-arm64@0.28.1 --prefix /tmp/eb28 --no-audit --no-fund
   cd /sessions/epic-friendly-wozniak/mnt/Uthena
   ln -sfn /tmp/vshim/node_modules/@rollup/rollup-linux-arm64-gnu node_modules/.pnpm/rollup@4.62.0/node_modules/@rollup/rollup-linux-arm64-gnu
   ln -sfn /tmp/eb21/node_modules/@esbuild/linux-arm64 node_modules/.pnpm/esbuild@0.21.5/node_modules/@esbuild/linux-arm64
   ln -sfn /tmp/eb28/node_modules/@esbuild/linux-arm64 node_modules/.pnpm/esbuild@0.28.1/node_modules/@esbuild/linux-arm64
   ```
2. `npx tsc --noEmit` (takes ~40s; note SEC-2 made `middleware()` async — confirm callers/tests updated).
3. `npx vitest run` (full suite). Also `npx eslint . --quiet`.
4. `next build` is NOT runnable here (native SWC is macOS) — run on the Mac before launch.

## Known caveats
- Verification here is typecheck + lint + vitest only; no `next build`, no dev-server/e2e (sandbox is Linux, deps are macOS). Real build + smoke of auth/checkout/player must run on the Mac.
- A used Web Crypto (async) for the maintenance HMAC — deliberate (Edge runtime). This rippled `middleware()` to async; watch for any middleware test asserting a sync return.
- Stripe live needs Dashboard event subscriptions (dispute/*, payment_failed, session.expired) + Tax enabled; cron for STUB-052 needs scheduling. See B's notes above.
