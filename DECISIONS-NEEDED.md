# Decisions Needed From You — Uthena

> Audit date **2026-07-03**. Everything below is blocked on a call only you can make. Each item: the question, why it matters, my recommendation, and what unblocks once you answer. Once you decide, jot the answer under the item — the Sonnet agent reads this file and will act on it (tasks in `TODO-HARDENING.md` are cross-referenced by ID).

## The one thing that blocks launch

Not a decision — just do it: **SEC-1**, any logged-in user can make themselves an admin (a Supabase RLS policy gates the row but not the `role` column). It's directly exploitable from the browser. The fix is a ~15-line migration (trigger). It's already written up in `TODO-HARDENING.md → SEC-1`. Flagging it here so it doesn't get lost among the decisions.

---

## Decisions

### D1 — Put the project under git? (→ QLT-1)
There is no git repo. The tell: 13 timestamped `.bak` files are doing version control by hand, including one inside the migrations folder. One bad `rm` loses the product.
**Recommendation: yes — `git init` + a private remote now.** `.gitignore` is already prepared. Costs nothing even if you never push, and lets us delete the `.bak` habit (D11).
**Your call:**

### D2 — Was `.env.local` ever committed anywhere? (security hygiene)
Your working tree has live-looking `SUPABASE_SERVICE_ROLE_KEY`, anon key, and `AUTH_SECRET`. That's fine *if the file was never shared/committed*. I can't check history (no git yet).
**Recommendation:** run `git log --all -- .env.local` after D1; if it ever appears, **rotate the service-role key + AUTH_SECRET** immediately. If it was never committed, no action.
**Your call:**

### D3 — Rate-limiting infrastructure (→ SEC-3)
Two public write endpoints (`/api/errors/report`, `/api/search`) have no rate limit, and eight existing limiters are in-process `Map`s that don't hold across multiple server instances. To do this properly we need a shared store.
**Options:** (a) **Supabase `rate_limit_events` table** — already planned as P18.8, durable, no new vendor [recommended]; (b) edge KV (Upstash / Vercel KV) — faster, another vendor + cost.
**Recommendation: (a).** I'll add interim in-process guards now regardless.
**Your call:** Use A, the supabase rate_limit_events table. 

### D4 — Light theme in v1: ship the toggle, or dark-only? (→ DSN, theme)
The brand doc says both themes ship in v1 with a user toggle. Reality: `design-system-light.css` is complete but never imported, no toggle exists, no `data-theme` is ever set. So today it's effectively dark-only-by-accident.
**Options:** (a) **Ship dark-only for v1**, park the light CSS [recommended — less work, the dark theme is the stronger look]; (b) fund the toggle now (island + localStorage + no-flash guard, ~half a day).
**Recommendation: (a) for launch, (b) as a fast follow.**
**Your call:** A, we can wait with the light theme.

### D5 — Active-nav color: teal or white? (→ DSN, brand consistency)
Your design README says the active nav item is **teal** (identity signal); the mockups and current code use **white**. They contradict.
**Recommendation:** pick one; I lean teal (it's the whole point of the two-signal system — teal = "where you are"). Whichever you pick, we update the other to match.
**Your call:** Use teal. Switch where needed.

### D6 — Home hero art direction (→ DSN-3)
The first screen is currently four gray gradient placeholders — the worst of both worlds. Options: (a) **real course covers** (mockup-faithful, needs decent thumbnails in the catalog) [recommended]; (b) deliberate abstract/branded cells.
**Recommendation: (a).**
**Your call:** A, use real course covers. 

### D7 — Confirm the admin console is dark like the rest of the app (→ DSN-2)
Several admin CSS files have `#fff`/`#fafafa` fills and `#111` text — written as if admin were a light surface. On the dark page this renders black-on-black.
**Recommendation:** confirm admin is dark (consistent with the product); I'll strip the light fallbacks. If you actually want a light admin, that's a separate, larger task.
**Your call:** Yes, stay dark. 

### D8 — Browse pagination & price filtering (→ PRF-8)
Right now the price filter and price sort run *after* the query is capped at 60 rows, and `/browse` has no pagination — so products past #60 are unreachable and "Free" can show too few. Fine at ~465 products, wrong as the catalog grows.
**Recommendation:** approve the code's own suggested fix — a denormalized `min_price_cents` column + SQL-side filtering + real pagination. Small migration + query change. Decide before you scale the catalog.
**Your call:** Yes, add that part directly. 

### D9 — Dependency upgrade window: Next 15.0.3 → ≥15.2.3, React 19-RC → 19 stable (→ QLT-5)
`next@15.0.3` carries CVE-2025-29927 (a middleware bypass — low impact here because your middleware doesn't gate auth, but still). React is pinned to a Nov-2024 release candidate. This is one coordinated upgrade + a smoke test of auth/checkout/player.
**Recommendation:** schedule it before launch (it's low-risk — no React-19-only APIs are in use yet). Just tell me when.
**Your call:** Sure, we can do it before going live. 

### D10 — Migration `0005b` naming (→ QLT-6, the 1 remaining failing test)
`0005b_payout_ledger_lock_indexes.sql` breaks the `NNNN_name.sql` contract and makes one test fail. Two fixes: (a) **rename `0005b`→`0006`** and renumber later migrations [clean, but risky if it's already applied to any DB]; (b) widen the naming rule to allow a letter suffix [safe, keeps history].
**Recommendation: (b)** if `0005b` may already be applied anywhere; **(a)** if it's still only local.
**Your call:**A, its only local. 

### D11 — What clutter can I delete? (→ QLT-2)
Safe-to-delete now (I'll do it once you say go): `STUBS.md.bak.*`, `uthena-demo.zip`, `tsconfig.tsbuildinfo`, `output/`, `.DS_Store` files, `single_mig.ts`, empty `07-archive/`, assorted `.bak` files, stale `deliverable*.md`/`REVIEW-*.md`. ~103MB.
**Need your call on these three:** `mockups/` (6.9MB — live design reference; keep or move under `01-specs/`?), `demo/` (5.9MB static prototype — still needed?), `.mavis/` + `.opencode/` (agent state — keep while you're running that workflow?).
**Your call:** Yes, you can remove the safe-to-delete files. Keep mockups, remove .mavis, .opencode. We've stopped using it for now. 

### D12 — CSP nonces now or post-launch? (→ SEC-4)
The Content-Security-Policy allows `'unsafe-inline'` for scripts, which weakens XSS protection. There's no active hole today (React escapes everything), so it's defense-in-depth. Moving to per-request nonces is real work in the App Router.
**Recommendation:** post-launch follow-up (it's already in your `_followups.md`). Confirm and I'll leave it out of the launch scope.
**Your call:**Can be post launch.

### D13 — Confirm the "must close before Stripe goes live" list (→ QLT-4)
These payment/payout stubs are money-losing or compliance blockers, not cosmetic: **STUB-062** (partner silently not paid on a ledger-write failure), **STUB-063** (no failed/expired-payment handler → stuck orders), **STUB-061** (no dispute handler → over-paying partners), **STUB-006** (tax always $0), **STUB-052** (partner PayPal emails stored in plaintext). All are code-only fixes.
**Recommendation:** treat all five as launch-blockers for live payments. Confirm so the agent sequences them before you flip Stripe to live.
**Your call:**Yes, this should be fixed before going live with stripe.

### D14 — `/api/health` exposes which integrations are configured (→ SEC-7)
The public health endpoint returns booleans for stripe/bunny/ses/sentry. Not secret, but it's free recon for an attacker.
**Recommendation:** low priority — either accept it (it's a load-balancer probe) or strip the booleans for anonymous callers. Your call, no rush.
**Your call:**Strip the booleans, solve it right away. 

### D15 — Icons: build `icons.tsx` or amend the doc? (→ DSN-10)
The UI uses text glyphs (`⌕`, `❚❚`) while the design README promises an `icons.tsx` that doesn't exist. Small either way: (a) create the SVG icon set (no dependency), or (b) delete the promise from the README.
**Recommendation: (a)** — glyph icons are a visible "AI-built" tell.
**Your call:**Yes create it (A)

---

## What I already fixed (no decision needed — FYI)
Fonts now load (Inter / Inter Tight / JetBrains Mono via `next/font` — the single biggest "looks AI-built" cause), a search-query injection vector, a security-header misclassification, the RLS coverage checker's blind spot, a CSS bug, `.gitignore`, a silent database-seeding bug (`package.json`), and 5 of 6 failing tests. Details in `AUDIT-2026-07-03.md → §Applied directly`. Everything verified: typecheck clean, lint clean, 4615/4617 tests green (the 1 remaining is D10).
