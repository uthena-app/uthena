# Affiliate Onboarding Thanks — `/affiliate/onboarding/thanks`

## What this page does

The post-submit landing for the affiliate onboarding wizard. The user lands here after clicking "Submit application" on step 6 of `/affiliate/onboarding` and the `affiliates` row is created with `status = 'pending'`. The page shows a checkmark / celebration graphic, a "Thanks — we'll review your application within 2 business days" headline, a "What happens next" 3-step explainer (we review → we email you → once approved, you get your custom link and mini-shop URL), a "What you can do in the meantime" panel (browse `/browse`, look at `/[handle]` mini-shops of approved affiliates, prepare your promo plan), and a "Sign out" secondary link.

The page is **idempotent on re-visit**. A user who navigates back to `/affiliate/onboarding/thanks` after submitting sees the same "we're reviewing" state — no "submit again" button, no confusing transition. The state is derived from the existing `affiliates` row (`status = 'pending'` and `affiliate_onboarding_drafts.submitted_at IS NOT NULL`); the page is read-only.

This page is the symmetric counterpart to `01-specs/pages/affiliate-onboarding-welcome.md`. The wizard's state machine — submit, idempotency, handle transfer from reservation to `affiliates.handle`, email queue, admin alert — lives in `01-specs/pages/affiliate-onboarding.md`. This page just renders the "we got it" screen.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Thanks — we got your application" + checkmark graphic | hard-coded | H1 + SVG checkmark |
| Subhead | "We'll review your application within 2 business days and email you with a decision." | hard-coded | muted paragraph |
| What happens next | 3 numbered steps: "1. Our team reviews your application", "2. We email you with a decision", "3. Once approved, your custom link and mini-shop URL at /[handle] go live" | hard-coded | numbered list |
| In the meantime | 3 items: "Browse the catalog to see what you can promote", "Look at approved affiliates' mini-shops at uthena.com/[handle]", "Prepare your promo plan (where you'll share your link)" | hard-coded | bulleted list with links |
| Secondary CTA | "Sign out" | hard-coded | text link → calls `signOut` server action → redirects to `/` |
| Application reference | "Your application ID: #12345" (the `affiliates.id`, formatted) | `affiliates` row | small muted text, no PII |

**Queries / actions:**
- `getSession()` from `00-foundations/auth/` — server-side auth check. If no session, redirect to `/login?next=/affiliate/onboarding/thanks`.
- `getAffiliateApplication(userId)` — single read on `affiliates` join `affiliate_onboarding_drafts` (the latter is proposed in `affiliate-onboarding.md` OQ #1). Returns `{ status, submittedAt }`. If no `affiliates` row, or `submitted_at IS NULL`, redirect to `/affiliate/onboarding/welcome`.
- `signOut()` from `00-foundations/auth/` — called by the "Sign out" link.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the thanks page post-submit | Direct nav to `/affiliate/onboarding/thanks` while logged in, with `affiliates.status = 'pending'` | Render the page | authenticated, has pending application |
| Anon direct nav | Direct nav while not logged in | Redirect to `/login?next=/affiliate/onboarding/thanks` | unauthenticated |
| Auth user with no application | Direct nav while logged in but no `affiliates` row | Redirect to `/affiliate/onboarding/welcome` (the right entry point) | authenticated, no application |
| Approved affiliate re-visit | Direct nav while logged in with `affiliates.status = 'approved'` | Redirect to `/affiliate` dashboard (the post-approval home) | authenticated, approved |
| Rejected affiliate re-visit | Direct nav while logged in with `affiliates.status IN ('rejected', 'suspended')` | Redirect to `/affiliate/onboarding/welcome` (the re-apply entry point) | authenticated, not pending/approved |
| Click "Browse the catalog" | Inline link | Navigate to `/browse` | authenticated |
| Click "Approved affiliates' mini-shops" | Inline link | Navigate to `/affiliates` (a public index page in v1.5; v1 lists 3 featured affiliates directly) | authenticated |
| Click "Sign out" | Secondary link | Server action `signOut()`, redirect to `/` | authenticated |
| Refresh the page | Browser refresh (F5) | Same "we're reviewing" state rendered — no duplicate emails queued, no submit re-triggered | authenticated, pending |

## What this page does NOT do

- No "submit again" or "update application" affordance (the application is in review)
- No live status polling. The status is derived from a single DB read; the user gets the next state via email.
- No "share with a friend" or referral CTA (the user is not yet approved to refer)
- No upsell
- No client-side JS beyond the inline SVG checkmark
- No DB writes (read-only)

## Acceptance criteria

- [ ] Page is auth-gated (server-side check in the RSC loader — no flash of thanks content for anon); anon visitors are redirected to `/login?next=/affiliate/onboarding/thanks` and `?next=` is preserved
- [ ] Logged-in users with `affiliates.status = 'pending'` see the "we're reviewing" state (headline + 3-step "What happens next" with step 3 mentioning `/[handle]` + "In the meantime" panel + Sign out + application ID `#<affiliates.id>`)
- [ ] Logged-in users with no `affiliates` row are redirected to `/affiliate/onboarding/welcome`; users with `status = 'approved'` are redirected to `/affiliate`; users with `status IN ('rejected', 'suspended')` are redirected to `/affiliate/onboarding/welcome` (re-apply entry point)
- [ ] The page is idempotent: re-visiting the URL 100× in a row renders the same state, queues no additional emails, and does not modify any DB row (verified by a row-count snapshot test)
- [ ] The "What happens next" explainer is a numbered list of 3 items (with step 3 mentioning `/[handle]`); the "In the meantime" panel has 3 items (browse link, mini-shops link, plain text "prepare your promo plan")
- [ ] The "Sign out" link calls the `signOut` server action and redirects to `/`
- [ ] No PII in URLs (no email, no user_id, no application_id, no handle in query string) and no PII in the visible text (no email, no display name, no handle — the handle is reserved but not public until approval)
- [ ] Page renders in < 100ms p95 (RSC, one indexed DB read, no client JS); no `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the affiliate-onboarding feature build (`mockups/affiliate-onboarding-thanks.html`)
- Design tokens: `00-foundations/design/tokens.css`
- Components: `00-foundations/ui/Button.tsx`, `00-foundations/ui/Checkmark.tsx` (inline SVG), `00-foundations/ui/Link.tsx`
- Theme: both

## Security

- **Auth required:** YES — auth check is in the RSC loader. Anon users get a 302 to `/login?next=/affiliate/onboarding/thanks` before the page renders.
- **Allowed roles:** authenticated user with `affiliates.status = 'pending'`. Other states (no application, approved, rejected, suspended) get redirected to the appropriate page.
- **RLS policies that apply:** `affiliates` — self can `select` own row. The `getAffiliateApplication` query uses the authenticated session, so RLS enforces the `user_id = auth.uid()` check.
- **PII displayed:** no — the application ID is a numeric `bigint`, rendered as `#<id>`. The page is otherwise static copy. The user's own email/name is never shown. The handle is NOT shown on this page — it is reserved in `handle_reservations` and only made public when the application is approved.
- **PII in URLs:** NO. The route is `/affiliate/onboarding/thanks`; the `user_id` is derived from the auth session server-side, never query-stringed. No `?ref=`, no `?handle=`.
- **Audit logged:** no — this is a read-only page. The submit itself is logged in the wizard's `affiliate_onboarding.submitted` event. Repeated visits here are not a security event.
- **Rate limiting:** the page itself is rate-limited to 60 req/min/user via the standard rate limiter in `00-foundations/auth/`. Prevents a stuck client from hammering the redirect logic. (The 60/min limit is the page-level rate limit; the per-action rate limit on the wizard's `submitApplication` is 5/hour/user — see `affiliate-onboarding.md` Security.)
- **CSRF:** the "Sign out" server action is protected by Next.js's built-in action token. No other server actions on this page.
- **Open redirect protection:** the `?next=` param on login is validated server-side.
- **Session security:** see `/login` spec.
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 100ms (RSC, one indexed DB read, no client JS)
- **Render strategy:** RSC + SSR. No client components needed.
- **Cache:** none — user-specific content.
- **DB load:** one indexed lookup on `affiliates (user_id)`. Zero for the rest of the page.
- **Bundle size budget:** < 2KB added to client bundle (the inline SVG checkmark is part of the RSC payload, not a client component).

## Out of scope for v1

- Live status polling (e.g. "your application is being reviewed by Sarah") — v2
- "Resend confirmation email" affordance on this page (the user can request a resend from `/settings` → "Email history" — v2)
- "Update application" affordance for returned applications (the wizard spec covers a returned-state flow at the wizard level, not here)
- Animated celebration (confetti, etc.) — the checkmark graphic is static SVG
- Sharing the milestone socially ("I just applied to become a Uthena affiliate!") — v2
- Showing the reserved handle on the thanks page — it is reserved but not yet public; we deliberately hide it here to avoid "but I picked a different one!" confusion if the admin returns the application for a different handle. The handle goes public at the moment of approval (admin app sets `affiliates.status = 'approved'`).
- Multi-language support for the thanks copy (English only in v1)

## Open questions for human

1. **"Approved" re-visit redirect.** When an approved affiliate comes back to `/affiliate/onboarding/thanks`, the spec redirects them to `/affiliate`. Alternative: show a "You're approved — go to your dashboard" state on this same page. My recommendation: **redirect** — the thanks page is a one-time post-submit screen, not a status dashboard. A status dashboard lives at `/affiliate/applications/[id]` in v2. Approve redirect?
2. **Application ID display.** Show `#<affiliates.id>` as a support reference? My recommendation: **show it**. Approve `#<id>` or hide it?
3. **Hide the reserved handle on this page?** The handle is reserved in `handle_reservations` (post-approval it appears in `/[handle]`), but the spec does NOT show it here — reason: if the admin returns the application for a different handle, the user would see a "but I picked `marcus-reyes`!" mismatch. My recommendation: **hide it on the thanks page**; show it on the wizard's submit step (step 6). Approve hiding it here?

---

## Implementation notes

- Shipped as part of P13.2 (2026-06-30). RSC route at `app/affiliate/onboarding/thanks/page.tsx` with auth-gate redirect to `/login?next=...` (matches partner thanks pattern + spec line 23) + 60/min/user in-process page rate limit (`pageRateLimitVerdict` from `02-features/affiliate-onboarding/lib/page-rate-limit.ts`) + 5-state dispatch on `getMyOnboardingApplicationForThanks` (new query in `02-features/affiliate-onboarding/queries/getMyOnboardingApplicationForThanks.ts` — anon/approved/suspended/none-or-pending-without-submitted_at/pending+submitted mapping: anon → `/login?next=...`, approved → `/affiliate`, suspended/none → `/affiliate/onboarding/welcome` re-apply entry, pending+submitted → render). Static `<ThanksPage>` component (`02-features/affiliate-onboarding/components/ThanksPage.tsx`) renders the inline SVG checkmark (using `--success` + `--success-soft` tokens) + H1 "Application received!" + 3-step "What happens next" (review → email → dashboard at `/affiliate`) + application reference `#<affiliates.id>` for support emails + toolbar with "View my account" primary CTA → `/account` + "Sign out" form calling `signOutAction` from `@features/auth/actions` + token-only CSS + `loading.tsx` + `error.tsx` (logs only `error.digest`) + `not-found.tsx`. The page is idempotent on re-visit (no DB writes, no email re-send, no submit re-trigger) — the query is read-only and the page holds no state.
- **`getMyOnboardingApplicationForThanks`**: parallel `Promise.all` of `affiliates` (PII-safe cols: `id, user_id, status, created_at`) + `affiliate_onboarding_drafts` (`user_id, submitted_at`) in 1 RT. RLS keeps both self-scoped. Defensive mapping fails closed on unknown status / pending-without-submitted_at. Mirrors the partner onboarding `getMyOnboardingApplicationForThanks` query.
- **`email` shown in step 2**: passed from the page loader as `user.email` (the signed-in user's own address). Used only for display in the "we'll email you at <email>" line — never logged, never sent to any other surface.
- **Wizard submit redirect**: deferred. The wizard's atomic submit action at step 6 is Slice 2+ (per `02-features/affiliate-onboarding/components/AffiliateOnboardingShell.tsx` line 22 + STUB-104). When the submit ships, it should `redirect('/affiliate/onboarding/thanks')` post-commit. Filed in `docs/PROGRESS.md` follow-ups.
- **Last-updated footer**: hard-coded `2026-06-30` in both the ISO `dateTime` attribute and the displayed string, kept as module-level constants so the page never silently drifts on re-render. Bump when the page copy / flow changes.
