# Change password (logged-in) — `/account/password`

## What this page does

Logged-in users change their own password. The user navigates here from a "Change password" CTA on `/account/profile` (the natural "manage your account" surface). The page presents three fields:

1. **Current password** — proves the requester controls the account (the user is already signed in, but a hijacked session could otherwise change the password and lock out the real owner). Verified server-side by re-signing-in with the supplied current password against the user's email via the Supabase Auth admin API.
2. **New password** — the new secret, with a live strength meter.
3. **Confirm new password** — must match the new password.

On submit:
- Current password is verified (server-side call; same outcome as `signInWithPassword` but using the service-role client so the user keeps their current session).
- New password is validated against the update schema (`min 12 + digit + symbol`, the stricter rule set from P1.3).
- Password is updated via Supabase Auth's `updateUser({ password })`. The user stays signed in on the same session.
- The success state shows a brief "Password updated" confirmation; the page redirects to `/account/profile` after 1.2s.
- On rate-limit hit, the form shows an inline cooldown (same pattern as login).
- On invalid-current-password, the form shows "Current password is incorrect" without revealing whether the email is registered (it always is — the user is signed in).

## Why this page is separate from `/update-password`

`/update-password` is the **post-reset** surface — the landing page for a password-reset email link. Its contract is "the reset link established a session; set a new password." It explicitly does **not** require the current password (the reset link proves the requester controls the inbox; that's enough for a reset). See `01-specs/pages/update-password.md` §What this page does NOT do.

`/account/password` is the **logged-in, self-serve** surface. The user already has a long-lived session; we want to re-prove account ownership before changing the secret. Different trust boundary, different form.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Change password" title, "Verify your identity, then choose a new password" lede | hard-coded | page header |
| Form | Current password input (with show/hide toggle), New password input + live strength meter, Confirm password input | form | inputs + strength meter |
| Success | "Password updated" heading, "You're still signed in. Returning to your profile…" | server action result | confirmation |
| Cooldown | "Too many attempts. Try again in Xm Ys." (rendered only when rate-limited) | server action `rateLimited` | inline notice |
| Footer link | "Back to profile" (→ `/account/profile`) | hard-coded | link |

**Server action:** `changePasswordAction` in `02-features/auth/actions.ts`. Verified server-side (Zod + service-role signin + RLS-aware `updateUser`). Returns the same `AuthActionResult` discriminated union as the rest of the auth actions so the form's error/cooldown rendering works identically.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Submit valid form | Fill all 3 fields, click "Update password" | Server verifies current password, calls `updateUser`, returns success → 1.2s success state → redirect to `/account/profile` | self (must have a valid session) |
| Submit with wrong current password | Fill fields, click "Update password" | Server returns `{ok: false, error: 'Current password is incorrect.'}` (generic — doesn't reveal which field was wrong beyond the top-level message) | self |
| Submit with mismatched new/confirm | Fill fields with non-matching confirm, click "Update password" | Inline error on confirm field: "Passwords do not match" — no server call | self |
| Submit with weak new password | Fill fields with new password failing strength rules | Inline Zod errors per rule (length, digit, symbol) — no server call | self |
| Submit with same as current password | Fill fields with new = current | Server returns `{ok: false, error: 'New password must differ from your current password.'}` | self |
| Rate-limited submit | Repeated failed submits | Inline cooldown notice ("Too many attempts. Try again in Xm Ys.") + submit button disabled | self |
| Navigate back | Click "Back to profile" | Navigate to `/account/profile` | self |

## What this page does NOT do

- Does NOT require the reset flow (that's `/update-password`). The user is already signed in here.
- Does NOT email a "your password was changed" notification in v1 (Phase 17 SES — STUB-040 covers this).
- Does NOT invalidate other sessions on this device (v2 — see account-settings.md `P9.6 Sessions management`).
- Does NOT prompt for 2FA in v1 (no 2FA yet).
- Does NOT allow the new password to be the same as the current password (server-side check, not a Zod rule, so the error message is friendlier than the generic schema error).
- Does NOT log the new password (plaintext, obviously) or the current password. Only failure events (wrong current password, rate-limit hit) are written to `auth_failed_attempts` + `admin_audit_log` per the existing rate-limit surface.

## Acceptance criteria

- [ ] Page is auth-gated — anonymous visitors are redirected by the existing `app/account/layout.tsx` (which redirects to `/login?next=/account`).
- [ ] Page route exists at `app/account/password/page.tsx` (and dual-tree hardlinked at `03-app/account/password/page.tsx`).
- [ ] Page renders only when the user has a valid Supabase session (the layout's `getSessionUser()` check covers this).
- [ ] Form has three fields: Current password, New password, Confirm password — in that order.
- [ ] Current password is required (`autoComplete="current-password"`); new + confirm are `autoComplete="new-password"`.
- [ ] Current password is verified server-side via service-role `signInWithPassword` against the user's email BEFORE the password is updated.
- [ ] The verify-current-password call uses the service-role client (not the request-scoped one) so the user's existing session cookies are not touched (the signin response is discarded; the user keeps their current session).
- [ ] New password requirements match the P1.3 update schema: `min 12 + digit + symbol` (stricter than the signup form's `min 10 + upper/lower/digit`).
- [ ] Strength meter is shown live as the user types (reuses `passwordStrength()` helper from `02-features/auth/passwordStrength.ts`); 5 levels: too short / weak / ok / good / strong.
- [ ] "Update password" submit button is disabled until all three fields are non-empty AND new = confirm AND strength score ≥ 2 (Fair or better). The button is `disabled + aria-disabled` when false.
- [ ] Wrong current password returns a single friendly error: "Current password is incorrect." (not "wrong password" — same copy as a logged-in user could be expected to see for a typo).
- [ ] New password same as current returns: "New password must differ from your current password."
- [ ] Mismatched new/confirm shows inline "Passwords do not match" on the confirm field (no server call).
- [ ] Weak new password shows inline per-rule errors (length, digit, symbol) on the new password field (no server call).
- [ ] On successful update, the user STAYS signed in (Supabase session is unchanged — only the password is rotated).
- [ ] On success, the form shows a "Password updated" state for 1.2s, then `router.push('/account/profile')`.
- [ ] Server action rate limit: max 5 attempts per user per 15 min — reuses `kind: 'update_password'` rate-limit bucket (5/email/15min + 20/IP/15min from P1.3).
- [ ] Server action rate limit: max 20 attempts per IP per 15 min — same bucket.
- [ ] Rate-limit events are logged to `admin_audit_log` with `action='password_update_rate_limited'` (reuses the existing `auditRateLimitTrigger` helper from P1.3).
- [ ] Wrong-current-password failures are logged to `auth_failed_attempts` with `reason='invalid_credentials'` (admin-only signal; user-facing copy stays generic).
- [ ] Successful updates are NOT individually logged (volume; matches P1.3 contract — only rate-limit hits write audit rows).
- [ ] `?next=` is NOT supported on this page (the user is logged in; there's no redirect-after-reset to preserve). The form's success path goes to `/account/profile` always.
- [ ] Page renders in < 250ms p95 (RSC + form, no DB reads; the layout's `getSessionUser` is the only Supabase call before render).
- [ ] No PII in URLs (no `?next=` parameter accepted).
- [ ] No `TODO` / `FIXME` / `HACK` in the diff.
- [ ] All form inputs are keyboard-navigable; the form has a real submit button + visible focus rings (token-only CSS).
- [ ] Mobile responsive at 360px, 768px, 1280px (single column on all breakpoints — the form is naturally narrow).
- [ ] No console errors in dev or prod; no PII in logs (`check:pii` is green).
- [ ] Page is reachable from `/account/profile` via a "Change password" link.

## Design reference

- Components: reuses `Button` + `Input` from `00-foundations/ui/primitives/Button`. Reuses `passwordStrength()` from `02-features/auth/passwordStrength.ts`. Reuses `.form` / `.h1` / `.lede` / `.serverError` / `.serverMessage` / `.strengthMeter` / `.strengthBarRow` / `.strengthBar` / `.strengthBarOn_*` / `.strengthLabel` from `02-features/auth/AuthForms.module.css` (the same module the reset/update form uses — visual consistency).
- No new mockup — the design mirrors the existing `/update-password` form 1:1, with one extra field at the top.

## Security

- **Auth required:** YES — the existing `app/account/layout.tsx` redirects unauthenticated visitors to `/login?next=/account`.
- **Allowed roles:** any authenticated user (customer, partner, affiliate, admin).
- **RLS policies that apply:** the password is updated via Supabase Auth's `updateUser` (which owns `auth.users`). No app-layer RLS needed.
- **Current-password verification:** the action calls `getServiceSupabase().auth.signInWithPassword(email, currentPassword)` BEFORE calling `updateUser`. The service-role client is used so the existing user session is untouched (the signin response is discarded; we only check that the call succeeded). If `signInWithPassword` returns an error, we return "Current password is incorrect." without revealing which Supabase error fired (no oracle for "this email is locked" vs "wrong password" — though the user already knows their own email).
- **Same-as-current check:** the action compares the new password against the current. If equal, returns the friendly "must differ" message. This prevents the user from "changing" their password to the same value (which would update the auth `updated_at` for no real security benefit and trigger rate-limit noise if they retry).
- **PII displayed:** no — the form has no PII (the user is identified by session).
- **PII in URLs:** no — no `?next=` accepted.
- **Audit logged:** rate-limit hits only (reuses P1.3's `auditRateLimitTrigger`); successful updates are NOT logged (volume; same as P1.3).
- **Rate limiting:** `kind: 'update_password'` bucket — 5/email/15min + 20/IP/15min (reused from P1.3).
- **CSRF:** server actions use Next.js's built-in origin check + Supabase Auth session cookie. No additional token needed.
- **Session security:** the user's existing session is preserved across the password update (the verify-current-password step uses a separate service-role call; the `updateUser` call mutates the password on the existing session).
- **Password hashing:** handled by Supabase Auth (bcrypt or argon2id). Plaintext is never stored or logged.
- **No reset flow:** this page does NOT trigger a reset email. It's a self-serve change for users who know their current password. Users who forgot their password use `/reset-password` → `/update-password` (the reset flow).
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 250ms (page render) + < 1.5s (update roundtrip, including the verify-current-password call).
- **Render strategy:** RSC (no client-side data fetching for the initial render; the layout already does the session check).
- **Cache:** none — page is user-specific.
- **Bundle size budget:** < 5 KB added to client bundle (the form reuses existing `passwordStrength` + `AuthForms.module.css`; the only new code is the `currentPassword` field + the verify-step error path).

## Out of scope for v1

- "Your password was changed" confirmation email — STUB-040 documents the gap (Phase 17 SES).
- 2FA re-prompt.
- "Sign out other sessions" checkbox (v2 — `account-settings.md` P9.6 owns this).
- Force-password-rotation policy (v2).
- Password hint support (security risk).
- Listing recent sign-in activity (v2).
- OAuth users without a password — these users don't have a "current password" so this flow is N/A for them. OAuth-only users use the `/reset-password` flow if they need to set a password for the first time (Supabase supports this via `signInWithPassword` after the OAuth link sets an email identity).

## Open questions for human

- **Session keep-alive:** does the user's session cookie's `expires_at` get bumped by Supabase Auth when `updateUser` is called? **Resolved P1.4: research shows `updateUser` does NOT bump session expiry; the session cookie's expiry is set at sign-in and stays fixed. If the user is mid-session when they change their password, the session stays active until its natural expiry (typically 1 hour). They may need to re-sign-in afterward — but this is unchanged from the P1.3 reset flow (which uses the same `updateUser` call). Not a regression. If we want a longer session on password-change, we'd need to call `supabase.auth.refreshSession()` after `updateUser` — flagged as a v2 follow-up if usage data shows churn.**
- **Multi-device sign-out:** the spec for this page is "change password, stay signed in on this device." The Open Question in `account-settings.md` P9.6 covers the "sign out other devices" checkbox. Recommendation: ship v1 without it (single device, the current one).
- **OAuth-only users:** users who signed up via Google have no password. The form's "current password" field is meaningless for them. The action returns `{ok: false, error: 'You signed up with Google. Use the reset flow to set a password.'}` and the page renders a CTA to `/reset-password`. **Resolved P1.4: this is the right shape. We detect OAuth-only users server-side (the `user.app_metadata.provider` array doesn't include `'email'` or there are 0 password-set identities) and return the friendly "use reset flow" message. The check happens BEFORE the `signInWithPassword` call so we never probe with a wrong creds attempt.**
- **Audit log volume:** every wrong-current-password attempt writes a row. A power user mistyping 20 times = 20 audit rows. At 50K MAU this is fine; matches the P1.3 contract. Re-evaluate at 250K.

---

## Implementation notes

- **Files (P1.4):**
  - **NEW** `01-specs/pages/account-password.md` (this file).
  - **NEW** `02-features/auth/ChangePasswordForm.tsx` — client component, mirrors `UpdatePasswordForm` but adds a `currentPassword` field. Reuses `passwordStrength()` helper.
  - **MODIFIED** `02-features/auth/actions.ts` — adds `changePasswordAction` (verify current password via service-role `signInWithPassword`, then `updateUser` on the request session; reuses `kind: 'update_password'` rate-limit bucket).
  - **MODIFIED** `02-features/auth/AuthForms.module.css` — no changes needed; the form reuses the existing `.form` / `.h1` / `.serverError` / `.strengthMeter` classes.
  - **MODIFIED** `02-features/auth/index.ts` (if it exists) — re-export `ChangePasswordForm`. Else: direct import from `@features/auth/ChangePasswordForm`.
  - **NEW** `app/account/password/page.tsx` — RSC, auth-gated via layout, renders `<ChangePasswordForm />`.
  - **NEW** `app/account/password/password.module.css` — token-only header + back-link styles (the form itself uses `AuthForms.module.css`).
  - **NEW** `app/account/password/loading.tsx` + `.module.css` — per P0.24 convention for auth-gated routes.
  - **NEW** `03-app/account/password/page.tsx` + `.module.css` + `loading.tsx` + `loading.module.css` — dual-tree hardlinks to `app/`.
  - **MODIFIED** `app/account/profile/page.tsx` — adds a "Change password" CTA pointing to `/account/password` (new card or a row at the top of the page, not in the danger zone).
  - **MODIFIED** `02-features/auth/README.md` — adds P1.4 status + file map.
  - **MODIFIED** `docs/PROGRESS.md` — P1.4 ticked.

- **Reused rate-limit bucket:** the action calls `checkRateLimit({ kind: 'update_password', email: user.email, ip })` — same bucket as P1.3's reset-completion action. Per the spec semantics, "limit updates per user per 15 min" is one policy across both flows (the user can't bypass the limit by switching between the reset-completion form and the logged-in change form).

- **Service-role verify-current-password:** the action calls `getServiceSupabase().auth.signInWithPassword(email, currentPassword)`. The response's session is discarded. The action then calls `getServerSupabase().auth.updateUser({ password })` on the request session. The two calls are sequential (the second depends on the first succeeding). Total: 2 Supabase Auth calls per update.

- **OAuth-only user detection:** `user.app_metadata?.providers` (or `user.identities`) is checked. If the user has no `email` provider (i.e., signed up exclusively via OAuth), the action returns the friendly "use the reset flow" message WITHOUT calling `signInWithPassword` (we don't want to log a phantom failed attempt).

- **Same-as-current check:** after the verify-current-password call succeeds, the action compares `parsed.data.password === currentPassword`. If equal, returns `{ok: false, error: 'New password must differ from your current password.'}`. This is a constant-time comparison (string equality in JS for short strings is not a real timing oracle at this scale; not worth the extra complexity).

- **Loading file:** the route's `loading.tsx` mirrors the `auth.module.css` shape from `/update-password` — a centered 460px card with header + 3 input skeletons + a button skeleton. RSC, token-only, zero client JS. Per the P0.24 Slice 2 convention for auth-gated routes.

- **Profile page CTA:** the "Change password" link is rendered ABOVE the existing danger zone, in its own card (light treatment — not destructive). Title: "Security"; lede: "Manage how you sign in." Single CTA: "Change password" → `/account/password`.

- **No git, working tree only:** per the AGENTS.md / QWEN.md conventions and the project decision (STUB-003). All edits are in-place.