# Partner Onboarding Welcome — `/partner/onboarding/welcome`

## What this page does

The entry screen for the partner onboarding wizard. The user lands here immediately after selecting "Become a partner" at `/signup` and the account is created. The page reassures and orients: a 2-line welcome headline, a 1-paragraph explanation of the partner program (60% revenue share, monthly payouts via PayPal, you upload courses, we review and publish), a 4-step "What you'll need" checklist (display_name + bio + website, PayPal email, tax info, KYC docs), a primary "Start application" button that navigates to the actual wizard at `/partner/onboarding`, and a secondary "Not now" link that sends the user to `/library` (they can come back later).

This page is a wrapper. It does NOT collect data and does NOT write to the database. The wizard's state machine — step persistence, draft row, idempotency, file uploads — lives in `01-specs/pages/partner-onboarding.md`. This page is the front door.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Welcome — let's get you set up" | hard-coded | H1 |
| Subhead | 1-paragraph program explanation (60% revenue share, monthly PayPal payouts, upload → review → publish) | hard-coded | muted paragraph |
| Checklist | 4 items: "Profile info (display name, bio, website)", "PayPal email for payouts", "Tax info (country + tax ID; W-9 for US)", "KYC documents (gov ID front + back)" | hard-coded | check list with check icons |
| Primary CTA | "Start application" | hard-coded | button → `/partner/onboarding` |
| Secondary CTA | "Not now" | hard-coded | text link → `/library` |
| Footer | "Already approved? Sign in to your partner dashboard" | hard-coded | text link → `/login?next=/partner` |

**Queries / actions:**
- `getSession()` — server-side auth check. Anon → redirect `/signup?next=/partner/onboarding/welcome`.
- `getPartnerStatus(userId)` — single read on `partners`. If `status IN ('pending', 'approved')`, redirect (`/partner/onboarding/thanks` for pending, `/partner` for approved).
- No mutation. Draft is created on the first `saveStep` inside the wizard — see Open Questions.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the welcome page | Direct nav while logged in, no existing `partners` row | Render the page | authenticated, no `partners` row with `status IN ('pending', 'approved')` |
| Anon direct nav | Direct nav while not logged in | Redirect to `/signup?next=/partner/onboarding/welcome` (signup honors `?next`) | unauthenticated |
| Pending partner re-visit | Direct nav with `partners.status = 'pending'` | Redirect to `/partner/onboarding/thanks` | authenticated, has pending application |
| Approved partner direct nav | Direct nav with `partners.status = 'approved'` | Redirect to `/partner` dashboard | authenticated, has approved application |
| Click "Start application" | Primary CTA | Navigate to `/partner/onboarding` (the wizard) | authenticated, no approved row |
| Click "Not now" | Secondary link | Navigate to `/library` | authenticated |

## What this page does NOT do

- No form fields, no draft creation, no file upload (this is the entry screen, not the wizard)
- No DB writes (read-only — one `partners` lookup for the redirect check)
- No client-side JS for form handling (RSC + static copy)
- No analytics on the "Start application" click (defer to v2; the wizard's `step_saved` audit log is more useful)
- No "What is the partner program?" marketing block (signup already explained it; the welcome page is a confirmation, not a sales pitch)
- No partner agreement PDF preview (that's inside the wizard at step 6)
- No avatar / profile pre-fill (the wizard does that at step 2)
- No "Resume where you left off" affordance (handled inside the wizard via `current_step` in the draft)

## Acceptance criteria

- [ ] Page is auth-gated (server-side check in the RSC loader — no flash of welcome content for anon); anon visitors are redirected to `/signup?next=/partner/onboarding/welcome` and `?next=` is preserved through signup
- [ ] Logged-in users with `partners.status = 'pending'` are redirected to `/partner/onboarding/thanks`; users with `status = 'approved'` are redirected to `/partner`; neither is shown the welcome screen
- [ ] The page renders the 4-step "What you'll need" checklist with all 4 items; the "Start application" button navigates to `/partner/onboarding` (the wizard); the "Not now" link navigates to `/library`
- [ ] No `partner_onboarding_drafts` row is created by visiting this page (the row is created on the first `saveStep` inside the wizard, not on the welcome screen)
- [ ] Rate-limited to 60 req/min/user (page-level) to prevent scraper abuse of the redirect logic; `getPartnerStatus` is a single indexed lookup
- [ ] No PII in URLs (no email, no user_id in query string); page renders in < 100ms p95 (RSC, no client JS); no `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the partner-onboarding feature build (`mockups/partner-onboarding-welcome.html`)
- Design tokens: `00-foundations/design/tokens.css`
- Components: `00-foundations/ui/Button.tsx`, `00-foundations/ui/CheckList.tsx`, `00-foundations/ui/Link.tsx`
- Theme: both

## Security

- **Auth required:** YES — the auth check is in the RSC loader, not the page component. Anon users get a 302 to `/signup?next=/partner/onboarding/welcome` before the page renders.
- **Allowed roles:** any authenticated user without an active `partners` row (pending OR approved). The `suspended` case is handled in the wizard, not here — see `partner-onboarding.md` Open Questions.
- **RLS policies that apply:** `partners` — self can `select` own row. The `getPartnerStatus` query uses the authenticated session, so RLS enforces the `user_id = auth.uid()` check.
- **PII displayed:** no — the page is static copy. No user data is rendered.
- **PII in URLs:** NO. The route is `/partner/onboarding/welcome`; the `user_id` is derived from the auth session server-side, never query-stringed. No `?step=`, no `?from=`.
- **Audit logged:** no — this is a read-only page with no mutation. The `partner_onboarding.started` event (if we add one) would be logged in the wizard, not here.
- **Rate limiting:** the page itself is rate-limited to 60 req/min/user via the standard rate limiter in `00-foundations/auth/`. This is the page-level equivalent of the per-action rate limit on the wizard's `saveStep`.
- **CSRF:** no server actions on this page; nothing to CSRF.
- **Open redirect protection:** the `?next=` param on signup (when this page is the destination) is validated server-side (must be a relative path starting with `/` and not `//`).
- **Session security:** see `/login` spec. The welcome page inherits the same session.
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 100ms (RSC, one indexed DB read, no client JS)
- **Render strategy:** RSC + SSR. No client components needed — the page is a static layout with two navigation links.
- **Cache:** none — user-specific content (the redirect check depends on the user's session and partner status).
- **DB load:** one indexed lookup on `partners (user_id)`. Zero for the rest of the page.
- **Bundle size budget:** < 2KB added to client bundle (effectively zero; this is RSC-only).

## Out of scope for v1

- "Start application" click tracking / funnel analytics (defer to v2; the wizard's `step_saved` audit is enough)
- Personalized checklist (e.g. "Based on your country, you'll need a W-9") — the page shows the same 4 items to everyone; the wizard step 4 handles country-specific conditional fields
- "Save my progress reminder" email after N days of not starting the wizard (defer to v2; the user can return to `/partner/onboarding` and the wizard auto-resumes from the saved step)
- A/B test of welcome copy
- Deep-link from a marketing email directly to `/partner/onboarding` (defer; users land on the marketing page first, then `/signup`)

## Open questions for human

1. **Draft row creation timing.** The wizard spec creates the draft on the first `saveStep` (lazy). This page does NOT create a draft. Should we eagerly create one here (so analytics can count "started onboarding" before step 1 saves) or on the "Start application" click? My recommendation: **no** — keep it in `saveStep`. The welcome page stays pure RSC, no write path. Approve lazy creation?
2. **Suspended partner handling.** If `partners.status = 'suspended'`, should this page show the welcome screen (and the wizard's re-submission flow handle the rest) or redirect somewhere else (e.g. a contact-support prompt)? My recommendation: **show the welcome screen** — the user is re-applying, the wizard handles the rest. Approve, or want a different v1 behavior?
3. **"Not now" link destination.** `/library` is the natural default, but for a fresh signup the library is empty. Alternative: `/browse`. My recommendation: **keep `/library`** — it's the default post-signin landing and the catalog is one click away. Approve?

---

## Implementation notes

- (filled by the building agent)
