# Partner Onboarding Thanks — `/partner/onboarding/thanks`

## What this page does

The post-submit landing for the partner onboarding wizard. The user lands here after clicking "Submit application" on step 7 of `/partner/onboarding` and the `partners` row is created with `status = 'pending'`. The page shows a checkmark / celebration graphic, a "Thanks — we'll review your application within 2 business days" headline, a "What happens next" 3-step explainer (we review → we email you with a decision → once approved, you can upload your first course), a "What you can do in the meantime" panel (browse the catalog, read the partner guide PDF, prepare your first course outline), and a "Sign out" secondary link.

The page is **idempotent on re-visit**. A user who navigates back to `/partner/onboarding/thanks` after submitting sees the same "we're reviewing" state — no "submit again" button, no confusing transition. The state is derived from the existing `partners` row (`status = 'pending'` and `partner_onboarding_drafts.submitted_at IS NOT NULL`); the page is read-only.

This page is the symmetric counterpart to `01-specs/pages/partner-onboarding-welcome.md`. The wizard's state machine — submit, idempotency, email queue, admin alert — lives in `01-specs/pages/partner-onboarding.md`. This page renders the "we got it" screen.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Thanks — we got your application" + checkmark graphic | hard-coded | H1 + SVG checkmark |
| Subhead | "We'll review your application within 2 business days and email you with a decision." | hard-coded | muted paragraph |
| What happens next | 3 numbered steps: "1. Our team reviews your application", "2. We email you with a decision (approved, returned for changes, or rejected)", "3. Once approved, you can upload your first course at /partner/upload" | hard-coded | numbered list |
| In the meantime | 3 items: "Browse the catalog", "Read the Partner Guide PDF (link to `/partner/guide`)", "Prepare your first course outline" | hard-coded | bulleted list with links |
| Secondary CTA | "Sign out" | hard-coded | text link → `signOut()` server action → `/` |
| Application reference | "Your application ID: #12345" (the `partners.id`, formatted) | `partners` row | small muted text, no PII |

**Queries / actions:**
- `getSession()` — server-side auth check. Anon → redirect `/login?next=/partner/onboarding/thanks`.
- `getPartnerApplication(userId)` — single read on `partners` join `partner_onboarding_drafts` (proposed in `partner-onboarding.md` OQ #2). Returns `{ status, submittedAt }`. If no `partners` row, or `submitted_at IS NULL`, redirect to `/partner/onboarding/welcome`.
- `signOut()` — called by the "Sign out" link.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the thanks page post-submit | Direct nav with `partners.status = 'pending'` | Render the page | authenticated, has pending application |
| Anon direct nav | Direct nav while not logged in | Redirect to `/login?next=/partner/onboarding/thanks` | unauthenticated |
| Auth user with no application | Direct nav with no `partners` row | Redirect to `/partner/onboarding/welcome` | authenticated, no application |
| Approved partner re-visit | Direct nav with `partners.status = 'approved'` | Redirect to `/partner` dashboard | authenticated, approved |
| Rejected partner re-visit | Direct nav with `partners.status IN ('rejected', 'suspended')` | Redirect to `/partner/onboarding/welcome` (re-apply entry point) | authenticated, not pending/approved |
| Click "Browse the catalog" | Inline link | Navigate to `/browse` | authenticated |
| Click "Partner Guide PDF" | Inline link | Navigate to `/partner/guide` (stub page in v1; full doc in v2) | authenticated |
| Click "Sign out" | Secondary link | Server action `signOut()`, redirect to `/` | authenticated |
| Refresh the page | Browser refresh (F5) | Same state — no duplicate emails, no submit re-trigger | authenticated, pending |

## What this page does NOT do

- No "submit again" or "update application" affordance (the application is in review; updates happen via a separate flow if the admin returns the application — see `partner-onboarding.md` for the returned-application flow)
- No live status polling. The status is derived from a single DB read; the user gets the next state via email.
- No "share with a friend" or referral CTA
- No upsell ("want to buy a course while you wait?")
- No client-side JS beyond the inline SVG checkmark
- No DB writes (read-only)
- No email re-send (the user can request a resend from `/settings` — see Open Questions)

## Acceptance criteria

- [ ] Page is auth-gated (server-side check in the RSC loader — no flash of thanks content for anon); anon visitors are redirected to `/login?next=/partner/onboarding/thanks` and `?next=` is preserved
- [ ] Logged-in users with `partners.status = 'pending'` see the "we're reviewing" state (headline + 3-step "What happens next" + "In the meantime" panel + Sign out + application ID `#<partners.id>`)
- [ ] Logged-in users with no `partners` row are redirected to `/partner/onboarding/welcome`; users with `status = 'approved'` are redirected to `/partner`; users with `status IN ('rejected', 'suspended')` are redirected to `/partner/onboarding/welcome` (re-apply entry point)
- [ ] The page is idempotent: re-visiting the URL 100× in a row renders the same state, queues no additional emails, and does not modify any DB row (verified by a row-count snapshot test)
- [ ] The "What happens next" explainer is a numbered list of 3 items; the "In the meantime" panel has 3 items (browse link, partner guide link, plain text "prepare your first course outline")
- [ ] The "Sign out" link calls the `signOut` server action and redirects to `/`
- [ ] No PII in URLs (no email, no user_id, no application_id in query string) and no PII in the visible text (no email, no display name)
- [ ] Page renders in < 100ms p95 (RSC, one indexed DB read, no client JS); no `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the partner-onboarding feature build (`mockups/partner-onboarding-thanks.html`)
- Design tokens: `00-foundations/design/tokens.css`
- Components: `00-foundations/ui/Button.tsx`, `00-foundations/ui/Checkmark.tsx` (inline SVG), `00-foundations/ui/Link.tsx`
- Theme: both

## Security

- **Auth required:** YES — auth check is in the RSC loader. Anon users get a 302 to `/login?next=/partner/onboarding/thanks` before the page renders.
- **Allowed roles:** authenticated user with `partners.status = 'pending'`. Other states (no application, approved, rejected, suspended) get redirected to the appropriate page.
- **RLS policies that apply:** `partners` — self can `select` own row. The `getPartnerApplication` query uses the authenticated session, so RLS enforces the `user_id = auth.uid()` check.
- **PII displayed:** no — the application ID is a numeric `bigint` (not an email or user_id), rendered as `#<id>`. The page is otherwise static copy. The user's own email/name is never shown (they know who they are).
- **PII in URLs:** NO. The route is `/partner/onboarding/thanks`; the `user_id` is derived from the auth session server-side, never query-stringed. No `?ref=`, no `?source=`.
- **Audit logged:** no — this is a read-only page. The submit itself is logged in the wizard's `partner_onboarding.submitted` event. Repeated visits here are not a security event.
- **Rate limiting:** the page itself is rate-limited to 60 req/min/user via the standard rate limiter in `00-foundations/auth/`. Prevents a stuck client from hammering the redirect logic. (The 60/min limit is the page-level rate limit; the per-action rate limit on the wizard's `submitApplication` is 5/hour/user — see `partner-onboarding.md` Security.)
- **CSRF:** the "Sign out" server action is protected by Next.js's built-in action token. No other server actions on this page.
- **Open redirect protection:** the `?next=` param on login is validated server-side (must be a relative path starting with `/` and not `//`).
- **Session security:** see `/login` spec.
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 100ms (RSC, one indexed DB read, no client JS)
- **Render strategy:** RSC + SSR. No client components needed.
- **Cache:** none — user-specific content.
- **DB load:** one indexed lookup on `partners (user_id)`. Zero for the rest of the page.
- **Bundle size budget:** < 2KB added to client bundle (the inline SVG checkmark is part of the RSC payload, not a client component).

## Out of scope for v1

- Live status polling (e.g. "your application is being reviewed by Sarah") — v2
- "Resend confirmation email" on this page (resend lives in `/settings` → "Email history", v2)
- "Update application" affordance for returned applications (the wizard covers a returned-state flow at the wizard level, not here)
- Animated celebration (confetti, etc.) — static SVG checkmark only
- Multi-language support for the thanks copy (English only in v1)

## Open questions for human

1. **"Approved" re-visit redirect.** When an approved partner comes back to `/partner/onboarding/thanks` (e.g. via a bookmark), the spec redirects them to `/partner`. Alternative: show a "You're approved — go to your dashboard" state on this same page. My recommendation: **redirect** — the thanks page is a one-time post-submit screen, not a status dashboard. A status dashboard lives at `/partner/applications/[id]` in v2. Approve redirect?
2. **Application ID display.** Show `#<partners.id>` as a support reference? My recommendation: **show it** — gives the user a reference number for support emails ("my application #12345"). The page requires auth + ownership, so no enumeration risk. Approve `#<id>` or hide it?
3. **Sign-out vs stay-signed-in.** The spec lists "Sign out" as a secondary CTA. Alternative: omit it (the user is signed in and can browse). My recommendation: **keep it** — the thanks page is a natural moment to consider "am I done here?" and a sign-out link is unobtrusive. Approve keeping it, or want a cleaner page without?

---

## Implementation notes

- (filled by the building agent)
