# Pricing — `/pricing`

<!--
Spec for P5.1 (Subscription landing).
This is the public marketing surface for the Personal Access tier.
The page is a marketing/info page — the actual subscribe action lives
on /account/subscriptions after authentication. The CTA on this page
deep-links to /signup?next=/pricing for anon users (so the user can
sign up first, then land back here to subscribe) and to
/account/subscriptions for authed users.
-->

## What this page does

The public marketing landing page for the **Personal Access** subscription tier. A visitor lands here, learns what the subscription includes, sees the price ($19/month), and can either (a) sign up + subscribe in two clicks (anon) or (b) jump straight to their existing subscription management page (authed). Below the pricing card, a 5–8 item FAQ answers the most common pre-purchase questions.

This page is **not** the subscription management surface — that's `/account/subscriptions` (auth-required). This is the marketing page that explains the value prop and links into the management surface.

## Data this page shows

| Field | Source | Format | Sort/filter |
|---|---|---|---|
| Plan name | `PLAN_NAME` constant from `@features/subscriptions/format` | text (`'Personal Access'`) | — |
| Price | `STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY` env via `getEnv()` | formatted `$19` / `Free` if missing | — |
| Stripe-ready badge | `isStripeConfigured()` from `@foundations/money/stripe` | boolean → show or hide the "Stripe not configured" notice | — |
| What's included list | Hard-coded `PRICING_FEATURES` in `02-features/subscriptions/copy.ts` | ordered bullet list | — |
| FAQ | Hard-coded `PRICING_FAQ` in `02-features/subscriptions/copy.ts` | accordion (native `<details>`/`<summary>`) | — |
| Visitor session | `getSessionUser()` from `@foundations/auth/guards` | null vs User | controls primary CTA copy + href |
| Current subscription (optional CTA path) | `getCurrentSubscription()` from `@features/subscriptions` | null vs row | authed-active → "Manage subscription" CTA instead of "Subscribe" |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Click "Subscribe" CTA (anon) | Click the primary CTA when not signed in | Redirect to `/signup?next=/account/subscriptions` | Public |
| Click "Subscribe" CTA (authed, no sub) | Click the primary CTA when signed in but no row | Redirect to `/account/subscriptions` (which calls `startSubscriptionAction` server-side) | Authenticated |
| Click "Manage subscription" CTA (authed, active sub) | Click the CTA when the user already has an active row | Redirect to `/account/subscriptions` | Authenticated |
| Open FAQ item | Click `<summary>` | Native `<details>` expand/collapse; no JS | Public |
| Tab through FAQ | Keyboard | Native `<details>` is keyboard-accessible | Public |

The CTA is the single interactive control on the page. The FAQ accordion is a no-JS native element.

## What this page does NOT do

- Does NOT call `startSubscriptionAction` directly — that action lives on `/account/subscriptions` (auth-gated). The pricing page only links there.
- Does NOT show a "compare plans" table — Personal Access is the only tier in v1.
- Does NOT display the user's actual discount savings (that's a checkout-time signal, not a marketing-page signal).
- Does NOT show testimonials or reviews (those live on `/` per P0.10's `ReviewsSection`).
- Does NOT support annual billing — only monthly.
- Does NOT support trial opt-in on the page — trials are decided by the Stripe subscription config, surfaced via the `trial_end` field on `/account/subscriptions`.
- Does NOT collect payment info — Stripe Checkout hosts that.

## Acceptance criteria

- [ ] Page renders at `/pricing` for anonymous and authenticated visitors (no auth required).
- [ ] Page hero shows: eyebrow ("Subscription"), H1 ("Personal Access"), one-line value prop, and the price `$19/month` (or "Free" if `STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY` env is missing — same shape as `StartSubscriptionCard`).
- [ ] Below the hero, the existing `<StartSubscriptionCard />` component is rendered with the correct `stripeReady` + `priceConfigured` flags. The card's existing graceful-degrade notice ("Subscriptions are temporarily disabled…") renders when Stripe is not configured.
- [ ] A "What's included" section lists exactly 5 benefits: (1) 15% discount on every PLR order, (2) discount stacks with partner attribution but not with coupons (per `getSubscriberDiscountContext` doc), (3) cancel-anytime / access continues to period end, (4) secure Stripe billing, (5) future subscriber-only content flag (per P8.3).
- [ ] A FAQ accordion with at least 6 questions covering: what is Personal Access, what's the difference vs. one-time PLR, can I cancel anytime, what happens after I cancel, do I get library access, do you offer a free trial, what payment methods are accepted, how do refunds work.
- [ ] The CTA's href + label are conditional: anon → `/signup?next=/account/subscriptions` + "Sign up & subscribe"; authed with no sub → `/account/subscriptions` + "Subscribe"; authed with active sub → `/account/subscriptions` + "Manage subscription".
- [ ] If Stripe is not configured, the CTA renders `disabled` with a notice mirroring the card's notice — same env-gate UX as `/account/subscriptions`.
- [ ] OpenGraph + Twitter Card meta is set via `buildPageMetadata` (per P0.21). OG image defaults to the dynamic `/og?title=Personal+Access+Subscription` generator.
- [ ] Page renders at RSC + ISR 300s (per AGENTS.md public-page cache strategy; same as `/browse`).
- [ ] Renders correctly with no JS — hero, card, FAQ all use semantic HTML.
- [ ] Keyboard accessible: skip-link target (`<main id="main">`) is the page's wrapper; CTA is a real `<Link>`; FAQ uses native `<details>` so keyboard users can Tab to each `<summary>` and press Space/Enter to toggle.
- [ ] Mobile responsive: at ≤ 880px the card and FAQ sections stack vertically; CTA remains full-width.
- [ ] Footer "Marketplace" or "Earn" column links to `/pricing` (per P0.3's existing footer pattern).
- [ ] No `TODO` / `FIXME` / `HACK` in shipped code. Follow-ups (if any) go to `STUBS.md` with a reason.
- [ ] All 6 checks green: `pnpm typecheck && pnpm lint && pnpm check:no-todo && pnpm check:pii && pnpm check:specs && pnpm check:rls`.
- [ ] `pnpm build` clean — the new route adds no client JS beyond the existing `StartSubscriptionButton` client island (already shipped).

## Design reference

- Mockup: **to be created during the P5.1 build** (per the spec convention; the home page's `mockups/home.html` provides the design-system reference).
- Design tokens: `00-foundations/design/tokens.css` (use `--accent` for eyebrow, `--heading` for H1, `--text-2` for body, `--line` for borders, `--bg-elev-1` for card surface).
- Theme: dark (the existing site theme).
- Visual reference: the existing `StartSubscriptionCard` component (already shipped in `02-features/subscriptions/components/`) is the design anchor — the pricing page reuses it as the centerpiece.
- FAQ pattern: mirror `02-features/home/FaqSection.tsx` (native `<details>`/`<summary>`, eyebrow + H2 + accordion list).

## Security

- **Auth required:** no — public page. Anyone can read.
- **Allowed roles:** public, customer (authenticated or not). No partner/affiliate/admin gating.
- **RLS policies that apply:** none directly. The page reads `subscriptions` via `getCurrentSubscription()` which is RLS-gated (self-only) when called for the authed user — anon calls short-circuit before any DB hit.
- **PII displayed:** no. The page does not display user email, name, or any identifier.
- **PII in URLs:** no. CTA links use route paths, not user identifiers.
- **Audit logged:** no. Read-only marketing page; no state-changing actions.
- **Third-party scripts:** none. Page is pure HTML + design tokens + the existing `StartSubscriptionButton` client island (which calls our own server action).

## Performance

- **Target p95:** < 200ms (per AGENTS.md marketing-page budget; same as `/browse`).
- **Render strategy:** RSC + ISR `revalidate = 300` (5 min) — same as other public marketing routes. The page's content is static copy + a single optional DB read (`getCurrentSubscription()` for the CTA's authed-no-sub branch).
- **Cache:** the page-level `revalidate = 300` handles HTML caching. `getCurrentSubscription()` is per-request (it's auth-scoped).
- **Bundle size budget:** < 50 KB added to client bundle. The page ships **zero** new client JS — only the existing `StartSubscriptionButton` client island (already shipped by P5.x prior work). The FAQ uses native `<details>` so no accordion JS is added.

## Out of scope for v1

- Annual billing option (Stripe supports it; we add later when there's demand).
- Multi-tier comparison table (Personal Access is the only tier).
- Trial opt-in CTA on the page (trials are decided by Stripe's subscription config, not by the page).
- A/B testing the headline (deferred to P19.14 feature-flag framework).
- Admin-editable pricing copy (deferred to P14.12 platform settings editor).
- Annual price + savings badge (deferred until annual billing ships).
- "Best value" / "Most popular" badges (single-tier page doesn't need them).
- Countdown timer for a launch promo (no launch promo scheduled).

## Open questions for human

- **None** — this page is a straightforward marketing surface that reuses the existing `StartSubscriptionCard`. If you want a different page route (e.g. `/subscriptions` instead of `/pricing`), flag it; otherwise `/pricing` is the canonical URL.

---

## Implementation notes (filled during build)

- **Route:** `/pricing`. The footer link in `SiteFooter.tsx` (P0.3 deliverable) gets a new "Pricing" entry in the Marketplace column. The existing `/account/subscriptions` route stays the auth-gated management surface.
- **CTA logic:** `getSessionUser()` + `getCurrentSubscription()` are awaited in parallel (same `Promise.all` pattern as the header data fetcher). The CTA href is computed from the two results before render. Anon path: `/signup?next=/account/subscriptions`. Authed-no-sub: `/account/subscriptions`. Authed-active: `/account/subscriptions` (the management page handles the active-sub case itself).
- **Existing component reuse:** the page imports `StartSubscriptionCard` from `@features/subscriptions` and passes `stripeReady` + `priceConfigured`. No new card component is needed — the existing one already matches the spec's centerpiece.
- **FAQ content:** 6 questions (within the 6–12 budget). Answer length 1–3 sentences each.
- **No schema changes:** the page is read-only against the existing `subscriptions` table. No new migration, no new RLS, no new spec coverage check needed (this is a public marketing route).
- **No new client islands:** the page is RSC. The existing `StartSubscriptionButton` is the only client code, and it's already shipped.