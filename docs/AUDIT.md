# Uthena v2 — Audit (2026-06-24, refreshed 09:50 +07)

> **Source of truth for "what's done, what's off, what's missing."** Every
> claim is grounded in a file I just read from `/Users/klaas/Documents/Uthena/`,
> not memory. Where a mockup exists, I compared byte-by-byte to the current page.
>
> **Scope note (2026-06-24, 09:50 +07).** Per Klaas's direction — "go deep,
> don't just basics, really extend all the phases" — the previous "already
> shipped" framing for PH01–PH12 is **dropped**. Those phases compiled and
> met minimum acceptance, but are not production-grade. Every phase is
> re-opened with deepening tasks. The build plan is now **20 phases,
> ~224 task lines** in `PHASES.md` (v4). The audit below is the rationale
> for why each phase needs deepening.
>
> **Status legend.** `✓` shipped (production-grade) · `~` shipped but
> materially off mockup or incomplete · `–` scaffolded (route + shell) only ·
> ` ` not started · `!` blocker.

---

## TL;DR — the situation in 4 lines

1. **Backend is genuinely far along.** PH01–PH12 + PH15 slice 1 + PH13a,b +
   PH10a–e are all real shipped work — 32 tables with RLS, auth, cart,
   checkout (Stripe), subscriptions, library + signed URLs, legal pages,
   GDPR banner, admin shell + categories + payouts, partner shell + dashboard
   + courses list, account profile + settings + orders + refund + reviews.
2. **The buyer-facing UI is far below the mockup bar.** Home, product detail,
   browse, and most other surfaces are functionally correct but visually
   half-built. The `product.html` mockup is the most extreme case — see §3.
3. **Three big functional gaps remain:** PH10f (GDPR export/delete), the
   entire affiliate portal (PH14), and the rest of the admin console
   (PH15 customers/partners/affiliates/orders/refunds/settings/analytics).
4. **Two build-orchestration artifacts are now dead weight** the user wants
   retired: the AllProjects meta-dashboard and the Uthena Cockpit (v1 inside
   `.mavis/dashboard/`, v2 spec in `01-specs/pages/cockpit-v2.md`). See §6.

---

## 1. What's actually shipped (verified from files) — **and what each phase still needs to deepen**

Verified by reading `PHASES.md` status table, `.mavis/active-phase.md`
session log, and the on-disk `app/` tree. The "shipped" label here means
**minimum-acceptance-criteria met**, not production-grade. Each row also
points at the deepening tasks in `PHASES.md` v4.

### Phase 0 — Visual shell + buyer-page rebuild (NEEDED)
The big one. Buyer-facing pages are ~70% off the mockup. Phase 0 in v4
has 24 tasks covering shell, home, product detail, browse, search, SEO
infrastructure. See §3 for the product-page gap.

### Phase 1 — Auth surface deep (NEEDED)
12 auth routes exist (`/login`, `/signup`, `/reset-password`,
`/update-password`, `/verify-email`, `/auth/callback`). But: no OAuth,
no inline validation polish, no single-session enforcement, no account
switcher. Phase 1 in v4 has 10 tasks.

### Phase 2 — Foundations library deep (NEEDED)
All helpers exist (`00-foundations/{auth,data,files,money,gdpr,email,
analytics,log,...}`) but: Zod schemas incomplete, security headers
untested, WYSIWYG barely wired, Pino schema not enforced, Sentry
capture pending. Phase 2 in v4 has 11 tasks.

### Phase 3 — Schema + RLS deep (NEEDED)
32 tables with RLS in `04-platform/migrations/0001_initial.sql`. But:
indexes not audited for 500+ course scale, RLS not tested with
unauthorized users, audit log not partitioned, no hot/cold strategy.
Phase 3 in v4 has 8 tasks.

### Phase 4 — Cart + checkout deep (NEEDED)
Stripe Checkout one-time works. But: cart has no drawer, no anon→auth
merge, no abandonment recovery; checkout is single-step not multi-step,
no Stripe Tax wired, no saved payment methods. Phase 4 in v4 has 13
tasks.

### Phase 5 — Subscriptions deep (NEEDED)
`/account/subscriptions/` + `02-features/subscriptions/`. But: no
landing page, no trial, no invoice PDF, no failed-payment recovery.
Phase 5 in v4 has 10 tasks.

### Phase 6 — Royalty + payouts deep (NEEDED)
`payout_ledger`, 14-day lock, `release-locked-balances` cron. But:
partner-side visibility is weak (STUB-032, STUB-035), no payout method
setup, no admin payout queue. Phase 6 in v4 has 10 tasks.

### Phase 7 — Library + files deep (NEEDED)
`/library/` with `user_accessible_products` RPC, 24h/4h TTLs. But: no
bulk download, no resume streaming, no sharing prevention, no storage
quota. Phase 7 in v4 has 10 tasks.

### Phase 8 — Subscriptions × library integration (NEEDED)
Schema exists; integration gaps: no "Included with Personal Access"
badge on catalog, no subscriber-only flag, no gift subscription.
Phase 8 in v4 has 4 tasks.

### Phase 9 — Account area + GDPR deep (NEEDED)
Profile + settings + orders + refund + certificates (placeholder) +
reviews exist. But: avatar upload missing (STUB-017), email change
missing (STUB-018), data export missing (PH10f), account delete
missing (PH10f). Phase 9 in v4 has 17 tasks.

### Phase 10 — Legal pages deep (NEEDED)
All 9 pages exist. But: content may have drifted from live uthena.com,
no per-page last-updated dates, no print-friendly, no in-page search.
Phase 10 in v4 has 8 tasks.

### Phase 11 — GDPR consent deep (NEEDED)
Consent log + analytics gating. But: no granular toggles, no
geo-detection, no withdrawal flow. Phase 11 in v4 has 6 tasks.

### Phase 12 — Partner portal full (NEEDED)
Shell + dashboard + settings + courses list. But: no onboarding
wizard, no course creation wizard, no upload backend, no bulk pricing,
no draft auto-save, no cohort analytics. Phase 12 in v4 has 20 tasks.

### Phase 13 — Affiliate portal full (NOT STARTED)
Nothing built. Phase 13 in v4 has 12 tasks to build from scratch.

### Phase 14 — Admin console full (PARTIAL)
Shell + categories + payouts. But: no customers, no partners (admin
side), no affiliates (admin side), no orders/refunds queue, no
platform_settings editor (STUB-008, STUB-011), no analytics, no
reports, no audit log search UI. Phase 14 in v4 has 20 tasks.

### Phase 15 — LMS full (PARTIAL)
Schema pending (`certificates` table ships in Phase 15.1, resolves
STUB-029). No player, no progress, no bookmarks, no notes, no Q&A, no
certificates UI. Phase 15 in v4 has 17 tasks.

### Phase 16 — Recommendations (NOT STARTED)
Phase 16 in v4 has 6 tasks to build from scratch.

### Phase 17 — Email system (NOT STARTED)
Phase 17 in v4 has 17 tasks (SES + 14 templates + admin tools).

### Phase 18 — Observability (PARTIAL)
Pino logger exists, Sentry seam exists. But: not enabled, no request
ID middleware, no alerting, no APM, rate limits still in-process
(STUB-012, STUB-013). Phase 18 in v4 has 8 tasks.

### Phase 19 — Marketing surface (PARTIAL)
Sitemap, OpenGraph, JSON-LD partially planned in Phase 0. Blog,
search backend, 301 map, bundles configurator, A/B test framework all
missing. Phase 19 in v4 has 15 tasks.

### Phase 20 — Ship hardening (PARTIAL)
CI scripts exist; STUBS cleanup pending; runbooks missing; E2E tests
missing. Phase 20 in v4 has 10 tasks.

### What exists but is **NOT** done

| Item | Status | Why |
|---|---|---|
| `app/products/[slug]/page.tsx` | **~ partial** | Compiles, but compared to `mockups/product.html` it is missing ~70% of the surface (gallery, rating row, price+save, installments, license radio, tabs, curriculum, reviews, "at a glance" sidebar). **This is the page Klaas called out.** |
| `app/page.tsx` (home) | **~ partial** | Has hero + categories strip + featured grid. Missing promo bar, search in header, hero art cells, trust strip (3-step), customer reviews block, categories grid with icons, newsletter signup, FAQ accordion. |
| `app/browse/page.tsx` | **~ partial** | Has category sidebar filter + product grid. Missing sort dropdown, price filter, instant-search, view density toggle. |
| `app/SiteHeader.tsx` | **~ minimal** | Just brand + 3 nav links + cart. Mockup has promo bar + search + 6-item nav + login/cart buttons. |
| **No global footer** | gap | Mockup footer (4 columns + pay chips + copyright) is not built. Each page rolls its own footer (home has one, others don't). |
| `/account/certificates` | `–` placeholder | `STUB-029` — table ships in PH16 |
| `/account/data-export` | not built | PH10f |
| `/account/delete` | not built | PH10f |

### What is **entirely missing** (no code yet)

- **Affiliate portal (PH14) — all of it.** `02-features/affiliate-portal/`
  exists but is empty (just `README.md`). No `app/affiliate/` routes.
- **Partner portal extras (PH13b2–PH13e):** `/partner/courses/[id]` 5-tab
  detail, instructor upload (backend + UI), partner sales analytics,
  onboarding wizard, settings payout-method + API tokens.
- **Admin console extras (PH15 remainder):** customers + detail, partners +
  detail, orders + detail + refunds, settings, affiliates + detail,
  analytics + reports + review.
- **Public `/[handle]` minishop** (affiliate-facing).
- **LMS (PH16):** progress, bookmarks, certificates, library-watch.
- **Recommendations (PH17):** Gorse seam + rails.
- **Email (PH18):** SES adapter + triggers.
- **Observability (PH19):** Sentry + log schema.
- **Marketing (PH20):** blog, search, 301 redirect map, bundles configurator.
- **Ship hardening (PH21):** full CI pass + STUBS cleanup + README sign-off.

---

## 2. Stubs still open (intentional gaps, from `STUBS.md`)

35+ entries across the file, but with **massive ID collisions** (008, 009,
010, 011, 012, 013, 014 each appear multiple times — see memory note). For
the audit, here are the ones that block real user value:

| Stub | What it defers | Why it matters |
|---|---|---|
| STUB-005 | Anon cookie cart | Forces every browser through signup before buying. OK for B2B / wholesale audience; not a real blocker. |
| STUB-006 | Stripe Tax | Tax = 0 today. Real money impact. Resolves once `STRIPE_SECRET_KEY` is real. |
| STUB-008 | Subscriber discount reads env, not `platform_settings` | Discount engine works but admin can't tune it from UI. Fixed by PH15 admin settings (planned) or PH18. |
| STUB-009 | DMCA agent hard-coded | DMCA page shows a static contact. v2. |
| STUB-011 | 14-day refund window is a literal | Admin can't change it. PH18. |
| STUB-012 | Categories reorder N transactions (not atomic) | Real risk; PH21. |
| STUB-013 | Signed-URL rate limit is in-process Map | Fine for single-instance, breaks at multi-instance. v2. |
| STUB-017 | Avatar upload not wired | Profile page shows initials only. Bunny signed PUT + cropper is the missing piece. |
| STUB-018 | Email change not on profile | Lives on settings. Wire when settings slice lands. |
| STUB-029 | `/account/certificates` placeholder | Table ships in PH16. |
| STUB-030 | Reviews soft-delete uses `'hidden'` (not spec's `'rejected'`) | Schema-shape mismatch. PH21 cleanup. |
| STUB-031 | Review confirmation email | PH18. |
| STUB-032 | Partner dashboard lifetime sales shows $0 | ~~Lives in PH15.~~ **Resolved 2026-06-26 by P6.1** — migration `0029_partner_lifetime_sales.sql` ships the `get_partner_lifetime_sales_cents(partner_id)` RPC + partial covering index; `getPartnerDashboardSummary` now reads from it in parallel with the 3 product-count reads. |
| STUB-035 | Partner product list has no per-product aggregates | ~~PH15.~~ **Resolved 2026-06-26 by P6.2** — migration `0030_partner_product_aggregates.sql` ships the `get_partner_product_aggregates(p_partner_id)` SECURITY DEFINER RPC + `order_items_partner_product_idx` covering index `(partner_id, product_id) INCLUDE (quantity, line_total_cents)`; `getMyPartnerProducts` now merges the per-product `units_sold` + `revenue_cents` into each row. The page renders two new right-aligned columns: "Sold" (monospace integer) + "Revenue" (`formatMoney` USD). Fail-soft on RPC error (warn log + 0/0 across the board). |

---

## 3. The product detail gap (what you called out)

Compared `mockups/product.html` (201 lines, includes styles/main.css) to
`app/products/[slug]/page.tsx` (169 lines) + `app/products/[slug]/product.module.css`
(316 lines).

**In the mockup, missing from the code:**

- **Promo announcement bar** at the very top ("Become an affiliate — earn
  20%"). Should be part of the global header.
- **Header search** with `⌘K` shortcut chip.
- **Header CTAs** ("Log in" + "Cart 0" buttons). Currently a single cart icon.
- **Image gallery with thumbnails** (main image + 4 thumbs, one is a video
  preview labelled "PREVIEW · 1:42"). The code only renders one image.
- **Video preview thumbnail** with overlay play button.
- **Rating row** (★ + "5.00 · 12 reviews" + instructor link + "ID #PLR-1284").
- **Price + strikethrough + save%** ($57 ~~$399~~ SAVE 86%) — the code
  shows only the discounted price.
- **Installments line** ("OR 4 × $14.25 with Shop Pay").
- **License radio selector** with side-by-side PLR/MRR cards, each with a
  name + description + price. Code shows them as separate cards but no
  radio, no description.
- **Single primary "Add to cart" CTA** below the license picker. Code shows
  one button per tier — wrong shape.
- **Perks checklist** ("✓ Earn money reselling this course", etc.). Code
  has "What you get" with hard-coded bullets — not data-driven, not the same
  content.
- **Tab strip** (Description / Curriculum / Instructor / Reviews with
  counts). Code has no tabs at all.
- **Curriculum list** (12 modules with index, title, duration). Code has
  none.
- **"At a glance" sidebar** (Format / Modules / License / Instructor /
  Updated). Code has the pricing card only.
- **Full site footer** (4 columns + pay chips + copyright row).

**What this means for the build plan.** The product detail page is not a
"missing feature" — it's a "rebuild to match mockup" task. The data model
already supports most of it (pricing tiers, partner, thumbnail). What's
missing is gallery/upload handling for multiple images, video preview,
ratings aggregation from `reviews`, curriculum from `lessons`, and the
full markup/CSS.

Estimated scope for the product detail rebuild: **3–5 hour slices** if
broken cleanly.

---

## 4. Mockup-by-mockup coverage

| Mockup | Page | Status | Gap |
|---|---|---|---|
| `home.html` | `/` | ~ partial | Header promo + search, hero art cells, trust strip, reviews block, categories grid, newsletter, FAQ accordion |
| `browse.html` | `/browse` | ~ partial | Sort dropdown, price filter, search, density toggle, richer ProductCard |
| `product.html` | `/products/[slug]` | ~ far-off | See §3 |
| `library.html` | `/library` | ~ partial | Mockup has sidebar nav (in `LibraryNav.tsx` — exists). Compare render. |
| `catalog.html` | (none) | gap | Catalog isn't a Uthena concept; browse is. Mockup is dead reference. |
| `collections/[handle].html` | (none) | gap | `app/collections/[handle]/page.tsx` exists but probably minimal. |
| `bundles.html` | `/bundles` | not audited | Listed as shipped. |
| `instructor.html` | `/partner/dashboard` | ✓ good | Real PartnerShell, KPIs, quick actions — matches spirit. |
| `upload.html` | `/partner/instructor-upload` | not built | PH13c. |
| `affiliate.html` | `/affiliate/*` | not built | PH14. |
| `admin.html` | `/admin/*` | partial | Categories + payouts exist; rest is PH15 remainder. |
| `minishop.html` | `/[handle]` | not built | PH14. |

---

## 5. Honest risks going into the build

1. **No real data seeded.** Every page has a real-looking empty state, but
   we have not exercised the pages with a seeded catalog of 465 products +
   real orders + real payouts. The 500+ course scale from STUB-014 was
   designed-for but not load-tested. The first time we seed 200+ products
   we will probably find missing indexes.

2. **No payment credentials.** `STRIPE_SECRET_KEY` is empty in `.env.example`.
   Every money path runs as a no-op or fails closed with an inline notice
   (STUB-002/006). Production deploys need real keys wired.

3. **Supabase is local Docker on ports 54421/54422.** STUB-004. Fine for
   dev; Coolify will use managed ports.

4. **The `qwen-runner/` inside the repo is a separate execution harness** for
   a local Qwen model via LM Studio. It is **not** what the user wants —
   they want a Mavis hourly cron, mirroring the Soofos `build-build-build`
   pattern. The Qwen runner's `backlog.json` is useful as a **plan
   reference** but its dashboard + state + LM Studio wiring is dead weight.

5. **No real tests beyond typecheck + lint + the 4 CI scripts.** There is
   no Playwright suite exercised against a running app, no integration
   tests against the local Supabase, no seeded-fixture regression. PH21
   hardening has to add this.

6. **Design tokens exist but may not match the mockup CSS exactly.**
   `00-foundations/design/tokens.css` is referenced everywhere; the mockup
   uses a `styles/main.css` with a similar but separate scale. The first
   Phase 0 task should reconcile these.

7. **No git in the repo.** STUB-003. Per Klaas's directive. The hourly
   cron will work on the working tree and rely on Klaas to checkpoint
   manually if he wants rollback.

---

## 6. Dashboard artifacts to retire — **DONE 2026-06-24**

The user said: "Let's remove the idea of having a dashboard for building
this, and remove those parts."

**Trashed 2026-06-24 09:38 +07** (recoverable via macOS Trash; see
`docs/RETIREMENT.md` for the audit trail):

| Item | Path | Why it went |
|---|---|---|
| Uthena Cockpit v1 | `/Users/klaas/Documents/Uthena/.mavis/dashboard/` (176 MB) | Vite+React+TS app, sole purpose was per-project cockpit |
| Cockpit runtime data | `/Users/klaas/Documents/Uthena/.mavis/data/` | Cockpit SQLite / runtime files |
| Old mavis plans | `/Users/klaas/Documents/Uthena/.mavis/plans/` | PH10a-era mavis team plan YAML; superseded by the hourly cron |
| Cockpit v2 spec | `/Users/klaas/Documents/Uthena/01-specs/pages/cockpit-v2.md` | Unbuilt spec; concept retired |
| Cockpit v2 impl spec | `/Users/klaas/Documents/Uthena/01-specs/pages/cockpit-v2-implementation.md` | Companion to cockpit-v2.md |
| Cockpit v2 mockup | `/Users/klaas/Documents/Uthena/mockups/cockpit-v2.html` | Unused reference |
| Cockpit audit plan | `/Users/klaas/Documents/Uthena/docs/COCKPIT_V2_AUDIT_AND_PLAN.md` | Companion to cockpit-v2.md |
| Qwen runner | `/Users/klaas/Documents/Uthena/qwen-runner/` (212 KB) | LM Studio + Qwen harness with its own dashboard; the runner itself and its dashboard are dead weight |
| Qwen runner backlog | (preserved at `/Users/klaas/Documents/Uthena/docs/legacy/qwen-runner-backlog.json`) | Useful as a plan reference; the runner harness was deleted, the backlog copy was kept |

**Not touched (per Klaas direction):**

- `/Users/klaas/Documents/AllProjects/` — the cross-project meta-dashboard
  workspace. Kept intact.
- `/Users/klaas/.minimax/agents/mavis/crons/` — the Mavis cron definitions.
  The Soofos `build-build-build` cron is unaffected; the new Uthena
  `uthena-builder` cron lives there too.
- `.mavis/active-phase.md` — the orchestrator log; entries for the
  retired cockpit are kept as historical record (not edited).

---

## 7. Decisions resolved (2026-06-24)

1. **Dashboard cleanup.** ✓ Trashed. Per Klaas: Uthena cockpit + Qwen
   runner + Cockpit v2 specs go; AllProjects stays.
2. **Cron cadence.** Hourly (`1 * * * *`).
3. **Cron default state.** Disabled until full task list is reviewed and
   Klaas enables.
4. **Branch / git.** Still no git (STUB-003). Working-tree only; Klaas
   checkpoints manually.
5. **PROGRESS.md location.** `/Users/klaas/Documents/Uthena/docs/PROGRESS.md`.
6. **Phasing.** Merged into a single `PHASES.md` (Part 1 historical +
   Part 2 active). Phase 0 is the visual-quality unblocker.
7. **Cron prompt path fixed (2026-06-24 09:43).** The cron file at
   `~/.minimax/agents/mavis/crons/uthena-builder.md` had 7 stale
   references to `docs/PHASES-V3.md` (now trashed). All rewritten to
   point at the merged `PHASES.md` (allowAlways permission granted).
   Cron is clean and ready; still `disabled: true` — enable with
   `mavis cron enable mavis uthena-builder` when ready.
