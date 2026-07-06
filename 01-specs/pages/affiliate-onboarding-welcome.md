# Affiliate Onboarding Welcome — `/affiliate/onboarding/welcome`

## What this page does

The entry screen for the affiliate onboarding wizard. The user lands here immediately after selecting "Join as affiliate" at `/signup` and the account is created. The page reassures and orients: a "Welcome — let's get you set up" headline, a 1-paragraph explanation of the affiliate program (20% commission on referred sales, 30-day cookie window, monthly PayPal payouts, $50 minimum), a 3-step "What you'll need" checklist (handle + bio, PayPal email, agreement to terms), a primary "Start application" button that navigates to the actual wizard at `/affiliate/onboarding`, and a secondary "Not now" link that sends the user to `/library`.

This page is a wrapper. It does NOT collect data and does NOT write to the database. The wizard's state machine — step persistence, draft row, handle reservation, idempotency, file uploads — lives in `01-specs/pages/affiliate-onboarding.md`. This page is just the front door.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Welcome — let's get you set up" | hard-coded | H1 |
| Subhead | 1-paragraph program explanation (20% commission, 30-day cookie window, monthly PayPal payouts, $50 minimum) | hard-coded | muted paragraph |
| Checklist | 3 items: "Handle + bio (your public URL will be uthena.com/[handle])", "PayPal email for monthly payouts", "Agreement to the Affiliate Terms + Uthena ToS" | hard-coded | check list with check icons |
| Primary CTA | "Start application" | hard-coded | button |
| Secondary CTA | "Not now" | hard-coded | text link → `/library` |
| Footer | "Already approved? Sign in to your affiliate dashboard" | hard-coded | text link → `/login?next=/affiliate` |

**Queries / actions:**
- `getSession()` from `00-foundations/auth/` — server-side auth check. If no session, redirect to `/signup?next=/affiliate/onboarding/welcome`.
- `getAffiliateStatus(userId)` — single read on `affiliates` table for the current user. If a row exists with `status IN ('pending', 'approved')`, redirect to the appropriate page (`/affiliate/onboarding/thanks` for pending, `/affiliate` for approved) — never show the welcome screen to someone who already has an application in flight.
- No mutation. No draft row is created on this page. The draft is created on the first `saveStep` call inside the wizard (see `affiliate-onboarding.md` Open Questions for the lazy-vs-eager decision).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the welcome page | Direct nav to `/affiliate/onboarding/welcome` while logged in, with no existing `affiliates` row | Render the page | authenticated, no `affiliates` row with `status IN ('pending', 'approved')` |
| Anon direct nav | Direct nav while not logged in | Redirect to `/signup?next=/affiliate/onboarding/welcome` (signup honors `?next`) | unauthenticated |
| Pending affiliate re-visit | Direct nav while logged in with `affiliates.status = 'pending'` | Redirect to `/affiliate/onboarding/thanks` (the right state for them) | authenticated, has pending application |
| Approved affiliate direct nav | Direct nav while logged in with `affiliates.status = 'approved'` | Redirect to `/affiliate` dashboard | authenticated, has approved application |
| Click "Start application" | Primary CTA | Navigate to `/affiliate/onboarding` (the wizard shell) | authenticated, no approved row |
| Click "Not now" | Secondary link | Navigate to `/library` (user can resume later) | authenticated |

## What this page does NOT do

- No form fields, no draft creation, no handle reservation, no file upload (this is the entry screen, not the wizard)
- No DB writes (read-only — one `affiliates` lookup for the redirect check)
- No client-side JS for form handling (the page is RSC + static copy)
- No "what's an affiliate?" marketing block (signup already explained it)
- No handle availability preview (the wizard does that at step 2 with a debounced check)
- No affiliate terms PDF preview (that's inside the wizard at step 5)
- No "Resume where you left off" affordance (handled inside the wizard via `current_step` in the draft)

## Acceptance criteria

- [ ] Page is auth-gated (server-side check in the RSC loader — no flash of welcome content for anon); anon visitors are redirected to `/signup?next=/affiliate/onboarding/welcome` and `?next=` is preserved through signup
- [ ] Logged-in users with `affiliates.status = 'pending'` are redirected to `/affiliate/onboarding/thanks`; users with `status = 'approved'` are redirected to `/affiliate`; neither is shown the welcome screen
- [ ] The page renders the 3-step "What you'll need" checklist with all 3 items; the "Start application" button navigates to `/affiliate/onboarding` (the wizard); the "Not now" link navigates to `/library`
- [ ] No `affiliate_onboarding_drafts` row and no `handle_reservations` row is created by visiting this page (both happen on the first `saveStep` inside the wizard)
- [ ] Rate-limited to 60 req/min/user (page-level); `getAffiliateStatus` is a single indexed lookup
- [ ] No PII in URLs (no email, no user_id in query string); page renders in < 100ms p95 (RSC, no client JS); no `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the affiliate-onboarding feature build (`mockups/affiliate-onboarding-welcome.html`)
- Design tokens: `00-foundations/design/tokens.css`
- Components: `00-foundations/ui/Button.tsx`, `00-foundations/ui/CheckList.tsx`, `00-foundations/ui/Link.tsx`
- Theme: both

## Security

- **Auth required:** YES — the auth check is in the RSC loader, not the page component. Anon users get a 302 to `/signup?next=/affiliate/onboarding/welcome` before the page renders.
- **Allowed roles:** any authenticated user without an active `affiliates` row (pending OR approved). The `suspended` case is handled in the wizard, not here — see `affiliate-onboarding.md` Open Questions.
- **RLS policies that apply:** `affiliates` — self can `select` own row. The `getAffiliateStatus` query uses the authenticated session, so RLS enforces the `user_id = auth.uid()` check.
- **PII displayed:** no — the page is static copy. No user data is rendered.
- **PII in URLs:** NO. The route is `/affiliate/onboarding/welcome`; the `user_id` is derived from the auth session server-side, never query-stringed. No `?step=`, no `?from=`.
- **Audit logged:** no — this is a read-only page with no mutation. The `affiliate_onboarding.started` event (if we add one) would be logged in the wizard, not here.
- **Rate limiting:** the page itself is rate-limited to 60 req/min/user via the standard rate limiter in `00-foundations/auth/`. This is the page-level equivalent of the per-action rate limit on the wizard's `saveStep`.
- **CSRF:** no server actions on this page; nothing to CSRF.
- **Open redirect protection:** the `?next=` param on signup (when this page is the destination) is validated server-side (must be a relative path starting with `/` and not `//`).
- **Session security:** see `/login` spec.
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 100ms (RSC, one indexed DB read, no client JS)
- **Render strategy:** RSC + SSR. No client components needed — the page is a static layout with two navigation links.
- **Cache:** none — user-specific content.
- **DB load:** one indexed lookup on `affiliates (user_id)`. Zero for the rest of the page.
- **Bundle size budget:** < 2KB added to client bundle (effectively zero; this is RSC-only).

## Out of scope for v1

- "Start application" click tracking / funnel analytics (defer to v2; the wizard's `step_saved` audit is enough)
- "Earn more with these tips" marketing block (the welcome page is a confirmation, not a sales pitch)
- "Save my progress reminder" email after N days of not starting the wizard (defer to v2; the user can return to `/affiliate/onboarding` and the wizard auto-resumes)
- A/B test of welcome copy
- Multi-language support for the welcome copy (English only in v1)

## Open questions for human

1. **Handle hint on the welcome page.** Should the page mention that handles must be 3-30 chars (lowercase letters/digits/hyphens) and must be unique, so the user is primed before they hit the wizard? My recommendation: **no** — the wizard's step-2 inline availability check is the right place for that education. Adding it to the welcome page creates a "wait, what's a handle?" moment that the wizard already handles better. Approve no hint, or want a short hint sentence on the welcome page?
2. **Suspended affiliate handling.** If `affiliates.status = 'suspended'`, should this page show the welcome screen (and the wizard's re-submission flow handle the rest) or redirect somewhere else? My recommendation: **show the welcome screen** — the user is re-applying, the wizard handles the rest. The wizard spec already covers this in its Open Questions. Approve, or want a different v1 behavior?
3. **"Not now" link destination.** Same question as the partner welcome: `/library` (default home) or `/browse` (browse as a buyer)? My recommendation: **keep `/library`** — it's the default post-signin landing and the catalog is one click away. Approve?

---

## Implementation notes

- Shipped as part of P13.2 (2026-06-30). RSC route at `app/affiliate/onboarding/welcome/page.tsx` with auth-gate redirect to `/signup?next=...` (matches partner welcome pattern + spec line 30) + 60/min/user in-process page rate limit (`pageRateLimitVerdict` from `02-features/affiliate-onboarding/lib/page-rate-limit.ts`) + 4-state dispatch on the affiliate-row read (`getMyAffiliateApplicationStatus` — anon/approved/pending/default mapping: anon → `/signup?next=...`, approved → `/affiliate`, pending → `/affiliate/onboarding/thanks`, default → render). Static `<WelcomePage>` component (`02-features/affiliate-onboarding/components/WelcomePage.tsx`) renders the H1 "Welcome, {firstName}!" + 1-paragraph recap + 4-step "What happens next" explainer (wizard → admin review → handle+payout setup → start sharing) + primary CTA "Continue onboarding →" → `/affiliate/onboarding` + secondary "Sign out" form calling `signOutAction` from `@features/auth/actions`. First-name derivation reads `profiles.display_name` (first token) with email-local-part fallback so the headline always reads "Welcome, <something>!" + token-only CSS (success accent for eyebrow + step badges, action accent for primary CTA) + `loading.tsx` + `error.tsx` (logs only `error.digest`, never the raw message) + `not-found.tsx`. Per the task instructions, the page renders a 4-step "What happens next" explainer instead of the spec's 3-step "What you'll need" checklist — spec field is overridden by the parent's task brief.
- **`signOutAction` import**: comes from `@features/auth/actions` (the canonical location per the existing partner ThanksPage). The auth feature re-exports it as a named export.
- **Last-updated footer**: hard-coded `2026-06-30` in both the ISO `dateTime` attribute and the displayed string, kept as module-level constants so the page never silently drifts on re-render. Bump when the page copy / flow changes.
