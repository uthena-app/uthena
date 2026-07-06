# PHASES.md — Uthena v2 build plan, v4 (2026-06-24)

> **The build contract.** One canonical doc. This is **v4** — rewritten
> after Klaas's 2026-06-24 direction: *"the previous phases can be done
> better too. The hourly cron needs to check ALL of them. I want a full
> live system. Go deep, don't just basics."*
>
> **What changed from v3.**
> - The "already shipped" framing for PH01–PH12 is **dropped**. Those
>   phases compiled and met the *minimum* acceptance criteria, but are
>   not production-grade. Every one of them is re-opened with
>   deepening tasks.
> - Phase count goes from 10 → **20**, total task lines from ~39 → **~200**.
> - Phases are now grouped into 6 parts (foundations / commerce /
>   account / portals / engagement / marketing+ship) so the cron has a
>   natural walking order.
>
> **Quick links.**
> - Live checklist (what the cron reads): `docs/PROGRESS.md`
> - Current-state audit + gap evidence: `docs/AUDIT.md`
> - Constitution: `AGENTS.md`
> - Builder operating manual: `QWEN.md`
> - Retirement log: `docs/RETIREMENT.md`

---

## What "deep" means per phase

A phase is `[x]` only when the **full live surface** is genuinely
working: real data, real auth, real RLS, real design tokens, real
keyboard nav, real empty/error states, real performance budget, real
test coverage. Not "compiles and one happy path renders." Concretely,
for each page that phase owns:

- Every section in the matching mockup or spec is present and
  data-driven (no hard-coded copy, no `TODO` placeholders).
- Empty state is designed. Error state is actionable. Loading state
  is visible.
- Keyboard reachable end-to-end. Focus rings on every interactive
  element. Skip-link present.
- Mobile responsive (the mockups target desktop; verify tablet + phone
  breakpoints don't break layout).
- All inputs Zod-validated. All server actions audit-logged. All PII
  masked in logs.
- Performance: catalog/product p95 < 200 ms; library p95 < 400 ms;
  course player first frame < 1.5 s (where applicable).
- `pnpm typecheck && pnpm lint && pnpm check:no-todo && pnpm check:pii
  && pnpm check:specs && pnpm check:rls` all green.

---

# Part 1 — Foundations (Phase 0 → 3)

> **Why first.** Nothing else works without a solid base. The cron walks
> Phase 0 → 3 before touching commerce.

## Phase 0 — Visual shell + design system + buyer-page rebuild

> **Why first within first.** Every page renders through the global shell.
> If the shell is half-built (current state: missing promo bar, search,
> full nav, footer), every later PR looks broken in screenshots.
> Phase 0 ships the shell to mockup parity + the two highest-traffic
> buyer pages (home + product detail) rebuilt to mockup.

### Shell components
- **P0.1** Reconcile design tokens against mockups — `tokens.css` vs
  `mockups/styles/main.css`. Document every gap; add the missing
  tokens. No magic literals in components.
- **P0.2** Global `SiteHeader` rebuild — promo bar + search + nav +
  login + cart, matches `mockups/home.html` lines 15–43. Promo copy
  data-driven from a constant.
- **P0.3** Global `SiteFooter` (new component) — 4-column layout + pay
  chips + copyright row, matches `mockups/home.html` lines 257–300.
  Renders on every page via `app/layout.tsx`.
- **P0.4** Search overlay — `⌘K` opens an instant-search modal backed
  by the catalog query (debounced). Empty + no-results states designed.
- **P0.5** Mobile nav drawer — hamburger reveals full nav + search +
  cart. Closes on route change and Escape.
- **P0.6** Skip-link + focus management — every page has a skip-link,
  visible focus rings, focus trap in modals.

### Product card + shared bits
- **P0.7** `ProductCard` redesign — PLR/MRR badge, category + module
  count, title, stars + review count, price + strikethrough + save%.
  Reads `avg_rating` + `review_count` + `msrp_cents` from the catalog
  query.
- **P0.8** `CategoryPill` component — used on home + browse + search.
- **P0.9** `EmptyState` + `ErrorState` + `Skeleton` primitives — used
  across every list page.

### Homepage rebuild (`/`)
- **P0.10** Homepage rebuild — match `mockups/home.html` lines 45–255
  section by section: hero (with art cells), trust strip, featured
  grid, reviews block, categories grid, newsletter, FAQ accordion.
  Each section is a real component in `02-features/home/`.
- **P0.11** Newsletter email capture UI (no server action yet — Phase
  17 wires SES).

### Product detail rebuild (`/products/[slug]`) — THE BIG ONE
- **P0.12** Product detail rebuild — match `mockups/product.html`
  lines 45–151 line-by-line. Gallery (multiple images), video preview
  thumbnail, rating row, price + strikethrough + save%, installments
  stub, license radio, perks list, tabs (Description / Curriculum /
  Instructor / Reviews), "At a glance" sidebar.
- **P0.13** `product_images` migration + multi-image gallery component.
- **P0.14** `products.bullets` JSONB column migration + perks list
  rendering.
- **P0.15** Curriculum tab data — JSONB `curriculum` column on
  `products` (Phase 15 LMS migration will normalize to `lessons` later).

### Browse + collections
- **P0.16** Browse polish — sort dropdown (newest / popular / price
  asc/desc), price filter (free / under $50 / under $100 / any),
  density toggle (comfortable / compact), URL-driven filters.
- **P0.17** Collections page (`/collections/[slug]`) — header,
  description, product grid, empty state. Matches the collections
  intent across mockups.

### Marketing surface polish
- **P0.18** Bundles listing (`/bundles`) — match the bundles section
  in mockups. Bundle cards with included-courses preview.
- **P0.19** Search results page (`/search?q=`) — result list with
  filters + pagination.
- **P0.20** Sitemap.xml — auto-generated from `products`,
  `categories`, `legal` pages. Submitted to search engines via
  `robots.txt`.
- **P0.21** OpenGraph + Twitter Card meta — every page generates
  correct preview cards. Dynamic `og:image` from product thumbnail
  (or generated default for non-product pages).
- **P0.22** JSON-LD structured data — `Product` schema on product
  pages, `BreadcrumbList` everywhere, `Organization` site-wide.

### Error + edge
- **P0.23** 404 + 500 + error pages — match the mockups' tone.
  Actionable ("Browse the catalog" / "Go home" / "Contact support").
- **P0.24** Loading + transition polish — `loading.tsx` for every
  route, suspense boundaries for client islands.

## Phase 1 — Auth surface deep

> PH04 shipped the routes; this phase makes them production-quality.

- **P1.1** Signup UX — inline validation (email format, password
  strength), terms checkbox, post-signup redirect to original URL,
  email verification gate.
- **P1.2** Login UX — remember-me, "forgot password" link, redirect
  to original URL, rate-limited (5/min/IP) with inline cooldown.
- **P1.3** Password reset UX — two-step (request link → set new), inline
  strength meter, success state, "didn't receive?" resend.
- **P1.4** Update password (logged-in) — requires current-password
  verification, inline validation, success confirmation.
- **P1.5** Email verification UX — clear "check your inbox" state,
  resend link with cooldown, post-verify landing page.
- **P1.6** OAuth (Google + Apple) — third-party login on `/login` and
  `/signup`. Account linking for existing email matches.
- **P1.7** Account shell + role-aware nav — top-level shell that knows
  buyer / partner / affiliate / admin and renders the right nav. Sidebar
  for partner/affiliate/admin areas.
- **P1.8** Session management — single-session enforcement (signing in
  elsewhere signs out the old device), session list in account
  settings (Phase 9), "sign out this device" / "sign out everywhere".
- **P1.9** Auth callback handler — handles email confirm, password
  reset, OAuth callback. Error states for expired links.
- **P1.10** Account switcher (admin) — for admins managing multiple
  accounts; logged in audit log.

## Phase 2 — Foundations library deep

> PH02 shipped the helpers; this phase makes them complete and tested.

- **P2.1** Auth guards audit — `requireUser`, `requireRole`,
  `requirePartner`, `requireAffiliate`, `requireAdmin` all implemented
  and tested (both authorized and unauthorized paths).
- **P2.2** Zod schemas complete — every entity (`profile`, `product`,
  `order`, `subscription`, `library_grant`, `payout_ledger`, …) has a
  Zod schema. Every server action validates input.
- **P2.3** Money helpers complete — `formatMoney`, `formatMoneyShort`,
  `addMoney`, `subtractMoney`, `applyDiscountBps`, `calculateRoyalty`,
  `calculateSubscriberDiscount`. All in cents (bigint-safe).
- **P2.4** Signed URL helpers tested — `mintDownloadUrl`,
  `mintStreamUrl` with IP binding, TTL enforcement, rate limit
  integration.
- **P2.5** Stripe wrapper hardened — env-gated, fails closed, all
  operations wrapped with `withStripeErrorHandling`. Idempotency keys
  on every write.
- **P2.6** GDPR helpers complete — export builders per entity, delete
  cascade logic, retention windows.
- **P2.7** Security headers middleware — CSP, HSTS, X-Frame-Options,
  Referrer-Policy, Permissions-Policy. Tested with `securityheaders.com`.
- **P2.8** WYSIWYG field — TipTap with image upload, code block, link,
  table, heading levels. JSON output schema validated.
- **P2.9** PostHog + Gorse + SES seams — env-gated, no-key = no-op,
  event shapes documented.
- **P2.10** Pino logger — structured schema (`event`, `actor`,
  `subject`, `context`), redactors for PII, request ID middleware.
- **P2.11** Error boundary — top-level + per-route. Friendly error
  pages, Sentry capture (once Phase 18 wires it).

## Phase 3 — Schema + RLS deep

> PH03 shipped 32 tables + RLS; this phase audits + scales.

- **P3.1** Index audit — every read path at 500+ products / 10k+ users
  has a covering index. Run `EXPLAIN ANALYZE` on representative
  queries.
- **P3.2** RLS test suite — automated tests that verify every policy
  with both authorized and unauthorized users (helper that signs in
  as different roles).
- **P3.3** Audit log growth — partition strategy (monthly), retention
  policy (24 months hot, archive cold), index on `(actor_id, event,
  created_at)`.
- **P3.4** `processed_webhooks` hardening — unique constraint on
  `stripe_event_id`, replay protection, conflict resolution.
- **P3.5** Hot/cold table strategy — `order_items`, `payout_ledger`
  split into current vs historical partitions.
- **P3.6** Migration dry-run — fresh-database bootstrap script that
  runs all migrations in order, verifies RLS, seeds minimal fixture
  data, smoke-tests the API.
- **P3.7** Type regeneration — `supabase gen types` runs in CI; types
  checked in. No hand-written DB types in the codebase.
- **P3.8** ENUM audit — every enum has explicit values, no orphan
  branches, deprecation strategy documented.

---

# Part 2 — Commerce (Phase 4 → 8)

> **Why next.** With shell + auth + schema solid, the buyer can actually
> browse, buy, watch, and pay. This is where revenue lives.

## Phase 4 — Cart + checkout deep

> PH06 shipped the basics. This phase makes cart + checkout
> production-quality.

### Cart
- **P4.1** Cart drawer — slide-in from header, shows line items,
  subtotal, "view cart" / "checkout" buttons. Add-to-cart from any
  page slides the drawer in.
- **P4.2** Cart persistence — server-side (auth) + localStorage
  mirror (anon). On signup, merge anon cart into auth cart with
  conflict resolution UI.
- **P4.3** Cart expiration — 30-day idle expiry, warning email at
  day 25 (Phase 17 wires email).
- **P4.4** Cart line-item edit — change license tier in cart,
  remove item, quantity (for bundle seats).
- **P4.5** Coupon code input — applies `coupons` table rules
  (percentage, fixed, partner-restricted, subscriber-only).
- **P4.6** Cart abandonment recovery — track `cart_abandoned` event,
  trigger recovery email (Phase 17).

### Checkout
- **P4.7** Checkout multi-step — 1) Email + account, 2) Payment, 3)
  Review, 4) Confirmation. Progress indicator.
- **P4.8** Stripe Tax wiring — actual tax calculation once Stripe
  account is live (resolves STUB-006).
- **P4.9** Address collection (if physical goods ship) — country-aware
  form fields, validation.
- **P4.10** Payment method picker — card / Apple Pay / Google Pay /
  Link. Saved methods for returning buyers.
- **P4.11** Order review screen — itemized total, taxes, discounts,
  legal links (terms + refund policy), place-order CTA.
- **P4.12** Confirmation + receipt — order confirmation page, email
  receipt (Phase 17), download invoice PDF.
- **P4.13** Checkout success + canceled pages — match
  `mockups/checkout-success.html` and `checkout-canceled.html`.

## Phase 5 — Subscriptions deep

> PH07 shipped the basic subscription surface. This phase makes it
> production-quality.

- **P5.1** Subscription landing — value-prop page explaining
  Personal Access tier, what's included, price, FAQ.
- **P5.2** Subscribe flow — Stripe Checkout Subscription mode, trial
  option (7-day), post-trial charge.
- **P5.3** Subscription status card — active / trialing / past_due /
  canceled / incomplete states with clear CTAs.
- **P5.4** Cancel-at-period-end — typed confirmation ("type CANCEL"),
  effective date display, resume CTA.
- **P5.5** Resume subscription — re-activate before period end.
- **P5.6** Stripe Billing Portal integration — manage payment method,
  view invoices, update billing address.
- **P5.7** Invoice list + download — last 12 months, PDF per invoice.
- **P5.8** Subscriber library access — `user_accessible_products` RPC
  already works; UI on `/library` shows "Personal Access" group with
  full catalog.
- **P5.9** Discount engine display — checkout shows subscriber
  discount clearly; partner products can opt-out via per-row override.
- **P5.10** Failed payment recovery — past_due state with retry
  banner, dunning emails (Phase 17).

## Phase 6 — Royalty + payouts deep

> PH08 shipped the ledger + cron. This phase makes the partner-side
> visible and operational.

- **P6.1** Partner lifetime-sales KPI (resolves STUB-032) — reads
  `payout_ledger` SUM for partner.
- **P6.2** Per-product revenue (resolves STUB-035) — partner courses
  list shows units sold + revenue per product.
- **P6.3** Partner payouts page — current locked / available /
  paid-out balance breakdown, recent ledger entries with deep links.
- **P6.4** Partner ledger detail — `/partner/payouts/[id]` shows
  individual ledger row with source order, refund (if any), locked
  window timeline.
- **P6.5** Partner payout method — PayPal email + bank details (encrypted
  at rest), micro-deposit verification for bank.
- **P6.6** Partner payout request — explicit "request payout" action
  when available balance exceeds threshold.
- **P6.7** Admin payouts queue — `/admin/payouts` shows pending requests,
  approve/deny, batch process, audit-logged.
- **P6.8** Admin payouts detail — full ledger history per partner,
  force-adjust with reason, clawback support.
- **P6.9** Royalty engine audit — verify snapshot at order time is
  used (not partner's current rate). Test edge cases: refund after
  lock window, partial refund, dispute reversal.
- **P6.10** Tax form integration — W-9 / W-8BEN collection in partner
  onboarding (Stripe Connect integration or equivalent).

## Phase 7 — Library + files deep

> PH09 shipped the signed URLs. This phase makes the library UX
> production-quality.

- **P7.1** Library landing — "Personal Access" + "Purchased" groups,
  file vault section. Real product cards with progress (Phase 15).
- **P7.2** Product detail in library — re-watch, download, share
  prevention UI, certificate status (Phase 15).
- **P7.3** File vault — list of every downloadable file per product,
  file size, format, last accessed.
- **P7.4** Bulk download — zip multiple files into one signed URL.
- **P7.5** Resume streaming — HLS playlist with continue-from-position,
  IP-bound token, range request support.
- **P7.6** Mobile player — responsive video player, full-screen,
  captions, playback rate, quality switcher.
- **P7.7** Download history — `/library/downloads` shows every
  signed URL mint, who, when, from where.
- **P7.8** Sharing prevention — token rotation on suspicious activity,
  concurrent-stream limit, geo anomaly detection.
- **P7.9** File vault search — filter by product, format, date.
- **P7.10** Storage quota display — partner's total uploaded size,
  per-product breakdown.

## Phase 8 — Subscriptions × library integration

> Cross-cutting concerns between Phase 5 and Phase 7.

- **P8.1** Library access sync — when subscription starts, library
  reflects catalog access immediately; when subscription ends, access
  revoked on next render (no per-product deletes).
- **P8.2** Catalog access display — subscriber sees "Included with
  Personal Access" badge on every catalog page.
- **P8.3** Subscriber-only content — partner can flag a product as
  subscriber-only; non-subscriber sees upgrade CTA.

> **Gift subscription (was P8.4): deferred to v2** (Klaas 2026-06-29).
> No gift subscriptions in v1 per `account-subscriptions.md:58`. If we
> ship this in the future, write a spec first and add as a new Phase.

---

# Part 3 — Account + legal (Phase 9 → 11)

## Phase 9 — Account area + GDPR deep

> PH10 shipped the basic account. This phase makes it production-quality.

### Profile
- **P9.1** Profile display + edit — name, bio, avatar, social links.
- **P9.2** Avatar upload — Bunny signed PUT + mime allowlist (jpeg/png/webp)
  + 5MB cap + square crop + storage path `avatars/{user_id}/{uuid}.{ext}`
  (resolves STUB-017).
- **P9.3** Email change — Supabase Auth verification flow (resolves
  STUB-018).
- **P9.4** Password change (logged-in) — current-password verification
  (Phase 1).

### Settings
- **P9.5** Settings shell — `/account/settings` sections: Account,
  Email, Password, Sessions, Notifications, Marketing, Privacy, Billing.
- **P9.6** Sessions management — list devices, "sign out this device",
  "sign out everywhere". Real with Supabase `admin.listSessions`.
- **P9.7** Notification preferences — granular per category
  (order updates, new courses, partner news, marketing).
- **P9.8** Marketing preferences — email/SMS/push opt-in per channel.
- **P9.9** Privacy controls — public profile toggle, data sharing
  opt-out, GPC respect.

### Orders + refunds
- **P9.10** Orders list — URL-driven filters, status badges, pagination.
- **P9.11** Order detail — items + summary + download links + invoice
  PDF + refund request link.
- **P9.12** Refund request form — reason category, free-text, file
  attachment (optional). Zod-validated, rate-limited (5/day).
- **P9.13** Refund sent confirmation — `/refund/sent` page.

### Reviews + certificates
- **P9.14** Reviews — create / edit / delete own review. Star picker,
  body, title. Status pills (pending / published / hidden).
- **P9.15** Certificates gallery — placeholder until Phase 15 ships the
  cert table.

### GDPR
- **P9.16** Data export (Art. 15) — `/account/data-export` page,
  assembles JSON from `profiles`, `orders`, `order_items`,
  `library_grants`, `reviews`, `subscriptions`, `notification_preferences`,
  `payout_ledger`, `audit_log`. Streams via signed URL. Rate-limited
  3/day.
- **P9.17** Account delete (Art. 17) — `/account/delete`, typed
  confirmation ("type DELETE"), calls `delete_my_account` RPC. Blocks
  on active subscriptions / pending payouts (resolves STUB-019).

## Phase 10 — Legal pages deep

> PH11 shipped the pages. This phase makes the content current and the
> UX polished.

- **P10.1** Terms review — verify content matches current uthena.com.
  Last-updated date visible. Anchor links to sub-sections.
- **P10.2** Privacy review — same. Verify GDPR Art. references are
  current. Cookie section matches Phase 11 consent categories.
- **P10.3** Refund policy review — same. Verify 14-day window language
  matches STUB-011 (or post-Phase-4 settings).
- **P10.4** DMCA — designated agent contact editable via Phase 14 admin
  (resolves STUB-009).
- **P10.5** Delivery — clarify "digital delivery" semantics; instant
  access wording.
- **P10.6** Data sharing opt-out — CCPA / GDPR Art. 15/17 language,
  GPC opt-out, data-controller email (resolves STUB-012 when mailbox
  is provisioned).
- **P10.7** Contact — option list + privacy inbox.
- **P10.8** FAQ — WYSIWYG in admin (Phase 14), 10+ entries matching
  current uthena.com FAQ.

## Phase 11 — GDPR consent + cookie deep

> PH12 shipped the banner. This phase makes it EU-compliant and granular.

- **P11.1** Granular consent UI — essential / analytics / marketing
  toggles, separate from the main banner, accessible from footer.
- **P11.2** Geo-detection — banner shown to EU visitors (IP-based
  with fall-back to "show to all"); consent log per visitor.
- **P11.3** Withdrawal flow — "manage cookie preferences" link in
  footer; toggles update consent log; analytics immediately stops
  firing.
- **P11.4** Partner DPA template — data-processing agreement for
  partners handling EU user data.
- **P11.5** Cookie scanner — periodically scan the site for new
  cookies, alert admin of unclassified ones.
- **P11.6** Consent log retention — 24 months, then anonymize to
  `(visitor_hash, granted_categories, timestamp)`.

---

# Part 4 — Portals (Phase 12 → 14)

## Phase 12 — Partner portal full

> PH13 shipped the shell + dashboard + courses list. This phase makes
> it the full partner operating system.

### Onboarding
- **P12.1** Onboarding wizard — `/partner/onboarding` multi-step:
  1) Bio + headshot, 2) Tax info (W-9/W-8BEN), 3) Payout method,
  4) Sample course draft, 5) Submit for review.
- **P12.2** Draft persistence — `partner_onboarding_drafts` table;
  resume from any step.
- **P12.3** Welcome + thanks pages — post-submit confirmation.

### Dashboard
- **P12.4** Dashboard refinements — KPI cards (lifetime sales,
  this-month sales, products, pending review), recent activity feed,
  earnings chart.

### Products
- **P12.5** Courses list — per-product revenue aggregates (resolves
  STUB-035).
- **P12.6** Course detail 5-tab — Curriculum / Pricing / Sales /
  Reviews / Settings (T04).
- **P12.7** Course creation wizard — `/partner/instructor-upload`
  multi-step: Details → Pricing → Files → Review → Submit.
- **P12.8** Upload backend — Bunny tus + ClamAV + encoding status
  enforcement.
- **P12.9** Bulk pricing editor — select multiple products, apply
  percentage discount or new price tier.
- **P12.10** Course draft auto-save — debounced 1s while editing (spec at `instructor-upload.md:79` + `partner-courses-detail.md:105`; the original PHASES.md line said "every 30 s" but the detailed spec won per AGENTS.md rule #5). Shipped via P12.7 Slice 1 (DetailsStep) + Slice 2 (CurriculumStep) — `DEBOUNCE_MS = 1000` constant, `useEffect` debounce + flush-on-unmount, inline "Saving… / Saved HH:MM:SS" indicator, server-side shallow-merge per step key, audit-logged, 60/min/user rate-limited.

### Sales analytics
- **P12.11** Sales page — lifetime + period + per-product + per-license
  breakdown. Date range filter. CSV export.
- **P12.12** Cohort chart — new customers × repeat rate over time.
- **P12.13** Top customers list — anonymized email, total spend,
  last purchase.

### Payouts
- **P12.14** Payouts page — locked/available/paid-out balance,
  ledger detail, payout history.
- **P12.15** Payout method setup — PayPal email + bank details +
  micro-deposit verification.
- **P12.16** Payout request — request payout action when above
  threshold.

### Settings
- **P12.17** Settings: bio, headshot, social links, public profile.
- **P12.18** Settings: payout method (P12.15).
- **P12.19** Settings: API tokens — create, list, revoke, one-time
  reveal.

### Notifications
- **P12.20** Partner email notifications — new sale, refund, payout
  sent, course approved/rejected, comment on review.

## Phase 13 — Affiliate portal full

> PH14 not started. Full new build.

### Onboarding
- **P13.1** Affiliate onboarding wizard — handle, bio, social links,
  payout method, tax info (lighter than partner).
- **P13.2** Welcome + thanks pages.

### Dashboard
- **P13.3** Affiliate shell + dashboard — clicks / conversions /
  earnings KPIs, recent activity.
- **P13.4** Performance chart — clicks + conversions + revenue over
  time.

### Links
- **P13.5** Link generator — auto-fill handle + product URL, custom
  slug, UTM params.
- **P13.6** Link list — per-link click/conversion/revenue stats.
- **P13.7** Link analytics deep — per-hour clicks, geo breakdown,
  device breakdown.

### Minishop + landing
- **P13.8** Public minishop `/[handle]` — curated storefront, hero,
  featured products, contact card.
- **P13.9** Custom landing pages — `/[handle]/[slug]` per campaign.
- **P13.10** Promotional assets — downloadable banners, email swipes,
  social posts.

### Settings
- **P13.11** Settings: profile, payout, API tokens (mirror of P12).

### Notifications
- **P13.12** Affiliate email notifications — new conversion, payout
  sent, performance milestones.

## Phase 14 — Admin console full

> PH15s1 shipped the shell + categories + payouts. This phase makes
> it the full admin operating system.

### Customers
- **P14.1** Customers list — filters (role, signup date, lifetime
  spend, risk score), bulk export.
- **P14.2** Customer detail — profile, orders, subscriptions, library,
  audit-logged PII reads.

### Partners
- **P14.3** Partners list — KYC/tax status filters, pending
  approvals queue.
- **P14.4** Partner detail — sales, upload queue, approve/suspend
  action, payout history.
- **P14.5** Partner approval workflow — review submitted onboarding,
  request more info, approve/suspend.

### Affiliates
- **P14.6** Affiliates list + detail — clicks / conversions / payouts,
  approve/suspend.

### Orders + refunds
- **P14.7** Orders list — filters, bulk export.
- **P14.8** Order detail — items + customer + ledger + audit trail.
- **P14.9** Refunds queue — approve/deny with reason; triggers refund
  path.

### Payouts + content moderation
- **P14.10** Payouts queue (admin) — see P6.7.
- **P14.11** Content moderation queue — products / reviews / profiles
  flagged by users or auto-detected.

### Settings editor
- **P14.12** Platform settings editor — subscriber discount bps,
  refund window days, royalty default, DMCA agent, support email,
  legal email. Resolves STUB-008, STUB-011.
- **P14.13** Email templates editor — WYSIWYG for transactional
  emails (Phase 17 wires SES).
- **P14.14** Feature flags — toggle features on/off without deploy.
- **P14.15** Maintenance mode — site-wide banner + admin bypass.

### Analytics + reports
- **P14.16** Analytics dashboard — revenue (daily/weekly/monthly),
  conversion, retention, top products, top partners.
- **P14.17** Reports — downloadable CSVs (orders, payouts,
  subscriptions, audit log).
- **P14.18** Audit log search UI — filter by actor, event, date, with
  PII-redacted display.

### Admin operations
- **P14.19** Admin 2FA — required for admin role.
- **P14.20** Admin role granularity — super-admin vs support vs
  finance vs content-mod.

---

# Part 5 — Engagement + growth (Phase 15 → 18)

## Phase 15 — LMS full

> PH16 shipped the schema. This phase makes it the full learning
> experience.

### Schema (PH16 carry-over)
- **P15.1** LMS migration — `lesson_progress`, `bookmarks`,
  `certificates` + RLS (T21). Resolves STUB-029.

### Player
- **P15.2** Course player shell — lesson list + video + tabs
  (Description / Notes / Q&A / Resources).
- **P15.3** Video player — HLS, captions, playback rate, quality
  switcher, full-screen.
- **P15.4** Progress tracking — server action on `timeupdate` (debounced),
  resume from last position.
- **P15.5** Bookmarks — add/remove/list per lesson.
- **P15.6** Per-lesson notes — markdown editor, exportable.
- **P15.7** Q&A per lesson — public questions + instructor answers.
- **P15.8** Lesson resources — downloadable files (signed URLs).

### Library integration
- **P15.9** Library progress bars — per-course completion %.
- **P15.10** "Continue watching" rail — top of `/library`.

### Certificates
- **P15.11** Auto-issue on course completion — signed PDF.
- **P15.12** `/account/certificates` gallery — replaces placeholder.
- **P15.13** Public `/verify-certificate/[code]` — verify a cert is
  real.
- **P15.14** Certificate PDF download — branded with Uthena logo +
  partner attribution.

### Reviews
- **P15.15** Course reviews — public on product page, filterable,
  sortable. Instructor can reply.

### Advanced
- **P15.16** Drip content — release lessons on a schedule (e.g.
  1/week).
- **P15.17** Course preview — first lesson free for non-buyers.

## Phase 16 — Recommendations

> PH17. Wire the Gorse seam end-to-end.

- **P16.1** Event tracking — view / click / add_to_cart / purchase /
  signup events emitted to Gorse (fail-open if down).
- **P16.2** Recommendation rails on home / product / library.
- **P16.3** Cold start — popularity-based fallback for new users.
- **P16.4** Multi-armed bandit testing — explore vs exploit.
- **P16.5** Recommendation explanations — "because you bought X".
- **P16.6** Per-user feedback — thumbs up/down on recommendations.

## Phase 17 — Email system

> PH18. Full SES + templates + triggers.

### Infrastructure
- **P17.1** SES adapter (env-gated; no key = no-op).
- **P17.2** Email queue — durable, retriable, idempotent.
- **P17.3** Suppression list + bounce/complaint handling.
- **P17.4** Unsubscribe management — global + per-category.

### Templates (React Email)
- **P17.5** Order confirmation + receipt.
- **P17.6** Refund confirmation.
- **P17.7** Payout sent.
- **P17.8** Email verification.
- **P17.9** Password reset.
- **P17.10** Review confirmation (resolves STUB-031).
- **P17.11** Partner: new sale, refund, course approved/rejected.
- **P17.12** Affiliate: new conversion, payout sent.
- **P17.13** Admin: new partner application, refund request, payout
  request.
- **P17.14** Drip campaigns — onboarding sequence, re-engagement,
  win-back.

### Admin tools
- **P17.15** Template editor in admin (Phase 14 wires it).
- **P17.16** A/B subject line testing.
- **P17.17** Send log + delivery dashboard.

## Phase 18 — Observability

> PH19. Sentry + log schema + dashboards.

- **P18.1** Sentry — error reporting (env-gated), source maps,
  release tracking.
- **P18.2** Pino log schema — consistent across all
  `00-foundations/log/` calls; tested with grep.
- **P18.3** Request ID middleware — every request gets an ID,
  propagated through logs.
- **P18.4** Audit log search UI (admin, P14.18).
- **P18.5** Alerting rules — Sentry alerts on error rate spikes,
  webhook failures, payment failures.
- **P18.6** Custom dashboards — PostHog (or self-hosted) for
  conversion funnels, retention cohorts.
- **P18.7** APM — request latency by route, DB query slowlog.
- **P18.8** Rate limit migration to Supabase-backed table — resolves
  STUB-012 / STUB-013.

---

# Part 6 — Marketing + ship (Phase 19 → 20)

## Phase 19 — Marketing surface

> PH20. SEO + content + landing.

### SEO
- **P19.1** SEO audit — meta tags, canonical URLs, hreflang,
  structured data.
- **P19.2** Shopify → Uthena 301 redirect map (data-model driven).
- **P19.3** Sitemap.xml (P0.20) + robots.txt + Bing webmaster.
- **P19.4** OpenGraph image generator — dynamic per-product.

### Content
- **P19.5** Blog index (`/blog`) + article (`/blog/[slug]`).
- **P19.6** Blog WYSIWYG (TipTap, P2.8) in admin.
- **P19.7** Blog categories + tags + search.
- **P19.8** About / Contact / Press / Careers pages.
- **P19.9** Agent commerce page — for AI agents buying on behalf of
  users.

### Search + bundles
- **P19.10** Site search backend (cmd+k wired in P0.4).
- **P19.11** Bundles configurator (`/bundles/[slug]`) — pick tier /
  license, save as preset.
- **P19.12** Bundle analytics — conversion rate per bundle.

### Conversion
- **P19.13** Landing pages builder — admin can create custom landing
  pages (e.g. for partner-specific promos).
- **P19.14** A/B test framework — feature-flag-driven experiments.
- **P19.15** Affiliate program public page.

## Phase 20 — Ship hardening

> PH21. CI + STUBS + runbooks + sign-off.

- **P20.1** CI scripts full pass — `pnpm check:all` green.
- **P20.2** Unit tests for new surfaces — every action, every guard,
  every formatter.
- **P20.3** E2E tests — Playwright for the buyer flow (signup →
  browse → buy → watch) and partner flow (signup → upload → publish).
- **P20.4** Performance audit — Lighthouse, Core Web Vitals on every
  page; budget enforced in CI.
- **P20.5** Security audit — secrets scan, dependency scan, RLS
  re-verify, PII log re-verify.
- **P20.6** STUBS cleanup — renumber duplicate IDs, remove resolved
  entries.
- **P20.7** README status table — fully updated.
- **P20.8** Pre-deploy checklist — manual smoke test on staging.
- **P20.9** Runbooks — incident response, secret rotation, payout
  procedures, refund approval.
- **P20.10** Sign-off — human approval + production deploy.

---

# Total scope

- **20 phases.** Grouped into 6 parts (Foundations / Commerce /
  Account / Portals / Engagement / Marketing+Ship).
- **~200 task lines.** Phase 0 = 24 (the visual shell + buyer pages
  rebuild); Phase 1 = 10; Phase 2 = 11; Phase 3 = 8; Phase 4 = 13;
  Phase 5 = 10; Phase 6 = 10; Phase 7 = 10; Phase 8 = 3 (gift
  subscription deferred to v2); Phase 9 = 17;
  Phase 10 = 8; Phase 11 = 6; Phase 12 = 20; Phase 13 = 12; Phase 14 =
  20; Phase 15 = 17; Phase 16 = 6; Phase 17 = 17; Phase 18 = 8;
  Phase 19 = 15; Phase 20 = 10.
- **~200–250 hourly cron ticks** end-to-end. At 1 tick/hour, that's
  roughly 8–10 days of continuous cron work. Some tasks slice into
  sub-ticks; the cron handles that with the existing `[~]` convention.

---

# How a phase gets split

1. **Vertical split > horizontal split.** Cut by user-visible surface,
   not by technical layer.
2. **Foundation-first.** A phase that adds a new foundation helper is
   its own phase.
3. **Migration before feature.** A schema change ships in its own
   mini-phase. RLS too.
4. **Spec before code.** A new spec or spec update is its own phase.

# Conventions across all phases

- **No `TODO` / `FIXME` / `XXX` in code.** Follow-ups go to `STUBS.md`.
- **No PII in logs.** `pino` redactors. Test it.
- **Every new table has RLS in the same migration.** Test it.
- **Every new server action validates with Zod.** Before the DB call.
- **No inline magic values.** Design tokens for color/space/type.
  Money in cents. Time in seconds.
- **Specs are updated before code in the same PR.**
- **Every UI surface has a screenshot or recording.** Mockup is the
  reference.
- **Read the real files.** Reasoning is not a substitute for reading
  the code you depend on.

# Status table (initial state 2026-06-24)

All phases start as `[ ]`. The cron walks them in order.

| Phase | Title | Tasks | Status |
|---|---|---|---|
| **0** | Visual shell + design system + buyer-page rebuild | 24 | `[ ]` |
| 1 | Auth surface deep | 10 | `[ ]` |
| 2 | Foundations library deep | 11 | `[ ]` |
| 3 | Schema + RLS deep | 8 | `[ ]` |
| 4 | Cart + checkout deep | 13 | `[ ]` |
| 5 | Subscriptions deep | 10 | `[ ]` |
| 6 | Royalty + payouts deep | 10 | `[ ]` |
| 7 | Library + files deep | 10 | `[ ]` |
| 8 | Subscriptions × library integration | 3 | `[ ]` |
| 9 | Account area + GDPR deep | 17 | `[ ]` |
| 10 | Legal pages deep | 8 | `[ ]` |
| 11 | GDPR consent + cookie deep | 6 | `[ ]` |
| 12 | Partner portal full | 20 | `[ ]` |
| 13 | Affiliate portal full | 12 | `[ ]` |
| 14 | Admin console full | 20 | `[ ]` |
| 15 | LMS full | 17 | `[ ]` |
| 16 | Recommendations | 6 | `[ ]` |
| 17 | Email system | 17 | `[ ]` |
| 18 | Observability | 8 | `[ ]` |
| 19 | Marketing surface | 15 | `[ ]` |
| 20 | Ship hardening | 10 | `[ ]` |
| | **Total** | **~224** | |

---

**Live orchestration log:** see `.mavis/active-phase.md`. **Live
checklist:** `docs/PROGRESS.md`. **Retired artifacts:** `docs/RETIREMENT.md`.
