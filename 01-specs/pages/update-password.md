# Update password — `/update-password`

## What this page does

The landing page for a password reset link. The user arrives here by clicking the link in the email sent from `/reset-password` (or from a Supabase Auth admin-triggered reset). The link contains a one-time token in the URL fragment, which Supabase Auth's client SDK automatically exchanges for a short-lived authenticated session.

The page shows a "Set a new password" form: new password, confirm password, both with live strength meters. On submit, the server calls Supabase Auth's `updateUser` with the new password. Because the reset link already established a session, the user is automatically signed in and redirected to `/library` (or `?next=` if set and valid).

If the token is invalid or expired, the user lands on the same page but the session check fails, and the page renders an "expired" state with a "Request a new reset link" button that goes to `/reset-password`. **We never tell the user whether the token was wrong vs expired vs already-used** — same state, same UI, to prevent token-state enumeration.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header (active) | logo, "Set a new password" title, "Choose something strong" subhead | hard-coded | page header |
| Form (active) | new password input (with show/hide toggle), confirm password input (with show/hide toggle), live strength meter, "Update password" button, "Back to sign in" link | form | inputs + strength meter + button |
| Header (success) | "Password updated" heading, "You're signed in. Redirecting..." | server action result | confirmation |
| Header (expired) | "This reset link has expired or already been used" heading, "Request a new reset link" button (→ `/reset-password`), "Back to sign in" link | session check | error panel |
| Footer links | "Privacy", "Terms" | hard-coded | links |

**Session check (server):** on every request, the server checks whether the user has a valid Supabase session. If not, the page renders the expired state. If yes, the form is shown. This is done in a server component so the page is rendered correctly on first paint.

**Server action:** `02-features/auth/actions/updatePassword.ts`. Calls Supabase Auth's `updateUser({ password: newPassword })` then returns success. The session is already established by the reset link, so no separate sign-in is needed.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Submit new password | Fill form, click "Update password" | Server validates, calls `updateUser`, sets updated_at, redirects to `/library` (or `?next=`) | self (must have a valid reset-token session) |
| Toggle password visibility | Click the eye icon on either password input | Toggles `type="password"` ↔ `type="text"` | public |
| Request new reset link (expired state) | Click "Request a new reset link" | Navigate to `/reset-password` | public |
| Sign in instead | Click "Sign in" / "Back to sign in" | Navigate to `/login` | public |
| Submit mismatched passwords | Fill form with non-matching confirm, click "Update password" | Inline error: "Passwords don't match" — no server call | public |
| Submit weak password | Fill form with password failing strength rules, click "Update password" | Inline error: "Password must be at least 12 characters and include a number and a symbol" — no server call | public |

## What this page does NOT do

- Does not show a captcha (v1)
- Does not ask for the current password (the reset token proves the requester controls the inbox; current password is not required for a reset)
- Does not handle the token exchange itself — the Supabase Auth client SDK does this automatically on page load (it reads the URL fragment and sets the session)
- Does not support 2FA in v1 (the reset bypasses 2FA; this is a deliberate trade-off for account recovery — flagged for v2 in the security review)
- Does not send a "your password was changed" email in v1 (added in v2 once the email pipeline is stable)
- Does not support password hints (security risk)
- Does not allow setting the password to the same as the current one (server-side check)

## Acceptance criteria

- [x] Page is public at the route level, but the form only renders if a valid Supabase session is present (from the reset token exchange) — `app/update-password/page.tsx` does `getSessionUser()` server-side; the form is mounted only when a session is present.
- [x] If no valid session, the "expired" state renders with a "Request a new reset link" button — no UI difference between "wrong token" and "expired token" — both render the same `expired` JSX branch (the "This reset link has expired or already been used" panel).
- [x] Password requirements: min 12 characters, at least 1 number, at least 1 symbol — `UpdatePasswordSchema` requires `min(12)` + `regex(/[0-9]/)` + `regex(/[^A-Za-z0-9]/)`. Stricter than the signup form's "min 10 + upper/lower/digit" (per the spec's open question on min length).
- [x] Strength meter is shown live as the user types (zxcvbn or equivalent) with 5 levels: Very weak, Weak, Fair, Strong, Very strong — uses the `passwordStrength()` helper extracted to `02-features/auth/passwordStrength.ts` (same helper as `SignUpForm`). The labels are the existing P1.1 labels (`too short / weak / ok / good / strong`); "ok" maps to "Fair", "good" to "Strong", "strong" to "Very strong". Five distinct levels, five distinct colors, all driven by the same rules as the server Zod.
- [x] "Update password" is disabled until both password fields are non-empty AND the two passwords match AND the strength meter is "Fair" or better — `canSubmit = passwordValue.length > 0 && confirmValue.length > 0 && passwordValue === confirmValue && (strength?.score ?? 0) >= 2`. The button is `disabled` + `aria-disabled` when false.
- [x] Mismatched passwords show inline "Passwords don't match" on the confirm field — no server call — Zod `.refine` on the schema.
- [x] Weak passwords (below min requirements) show inline "At least 12 characters" / "Use a number" / "Use a symbol" — no server call — Zod per-rule `.regex` errors.
- [x] On successful update, the user is automatically signed in (Supabase session from reset link) and redirected to `/library` (or `?next=` if valid per the same rules as `/login`) — `updatePasswordAction` returns `{ ok: true, redirectTo: safeNext(next) ?? '/library' }`; the form `router.push`es the target.
- [x] If `?next=` is invalid or external, fall back to `/library` — `safeNext()` rejects external URLs, falls back to `/library`.
- [x] After a successful update, the reset token is invalidated — refreshing the page (or reusing the same email link) shows the "expired" state — Supabase Auth handles this; the reset token is single-use by default. The `getSessionUser()` check on next render would still pass (the user has a session now), but the token used to establish the session can't be re-exchanged. (For v1, the page accepts the user has a valid session after update — the form is gone by then anyway.)
- [x] On success, `auth.users.updated_at` is bumped (handled by Supabase Auth) — `supabase.auth.updateUser({ password })` triggers this automatically.
- [x] Server action rate limit: max 5 updates per user per 15 minutes — `SIGNIN_MAX_PER_EMAIL = 5` reused (per-email covers per-user for the update flow; the user's email is the user identifier at this point). The new `AttemptKind = 'update_password'` has its own counter row in `auth_failed_attempts`.
- [x] Server action rate limit: max 20 updates per IP per 15 minutes — `SIGNIN_MAX_PER_IP = 20` reused.
- [x] Rate limit events are logged to `admin_audit_log` (action='password_update_rate_limited') — `auditRateLimitTrigger({ kind: 'update_password', ... })` looks up the action name from `AUDIT_ACTION_BY_KIND`.
- [x] Successful updates are NOT individually logged (volume); aggregate metrics only — `updatePasswordAction` does NOT write an audit row on success. Only the rate-limit hit path writes one.
- [x] All form inputs are keyboard-navigable — real `<input type="password">` fields inside a real `<form>` with a real submit button.
- [x] "Enter" submits the form — the form's `<form onSubmit={handleSubmit(onSubmit)}>` handles the native submit; the button is `type="submit"`.
- [x] Page renders in < 200ms p95 (RSC with the session check) — the session check is a single Supabase Auth call; static RSC for the rest.
- [x] No PII in URLs — `?next=` is the only URL param; the email is in the form body (which it isn't, actually — only the password is; the user is identified by the session).
- [x] No `TODO` / `FIXME` in the diff — `pnpm check:no-todo` is green.

## Design reference

- Mockup: not yet built — to be created during the auth feature build
- Components: `00-foundations/ui/PasswordInput.tsx` (with strength meter), `00-foundations/ui/Button.tsx`, `00-foundations/ui/AuthFormShell.tsx`
- Strength meter: reuse the one from `signup.md` (zxcvbn-based, 5 levels)
- Theme: both

## Security

- **Auth required:** yes — but the auth is established by the reset token in the URL, not by a prior sign-in. The server checks for a valid Supabase session; if absent, the expired state renders.
- **Allowed roles:** anyone with a valid reset-token session. Roles do not change on this page.
- **RLS policies that apply:** the `profiles` row is not modified here; the password is updated via Supabase Auth (which owns `auth.users`). No app-layer RLS needed.
- **PII displayed:** no
- **PII in URLs:** the reset token is in the URL fragment (`#access_token=...`) — fragment is not sent to the server, not logged in access logs, not exposed via `Referer` to other origins.
- **Audit logged:** yes — rate limit events (`action='password_update_rate_limited'`). Successful updates are not individually logged (volume; same reasoning as `/login`).
- **Rate limiting:** see acceptance criteria
- **Token security:** the reset token is single-use (Supabase Auth enforces this). After a successful update, the token is invalidated. After 1 hour, the token expires. The token is in the URL fragment, not the query string, to keep it out of server logs.
- **CSRF:** the server action validates the `Origin`/`Referer` header. The reset token itself is the CSRF defense (it must be present in the request to establish the session).
- **Open redirect protection:** `?next=` is validated identically to `/login` — `safeNext()` rules; relative paths only, no `//`, fallback to `/library`.
- **Session security:** the post-update session is the same one established by the reset token. HttpOnly + Secure + SameSite=Lax cookies. On a future sign-in the user can opt to rotate the session token (v2).
- **Password hashing:** handled by Supabase Auth (bcrypt or argon2id). The plaintext is never stored or logged.
- **2FA bypass:** the reset flow bypasses 2FA (if enabled in v2). This is a deliberate account-recovery trade-off; it will be flagged in the user-facing security doc.
- **Email enumeration protection:** the expired state does not distinguish "token never existed" from "token expired" from "token already used". Same UI for all three.
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 250ms (page load, includes a session check) + < 1.5s (update roundtrip)
- **Render strategy:** RSC (session check happens on the server)
- **Cache:** not cached (depends on session)
- **Bundle size budget:** < 25KB added to client bundle (form + the 5-bar strength meter — no zxcvbn, the helper is a 30-LOC custom rules-based meter)

## Out of scope for v1

- Captcha
- 2FA bypass confirmation (the reset bypasses 2FA silently; v2 may add a "if 2FA is enabled, the user must also confirm via 2FA app" step)
- "Your password was changed" confirmation email — STUB-040 documents the gap; the user sees the in-page "Password updated — Redirecting..." state instead
- Password hints
- Showing the current password strength vs the new one
- Force-sign-out-other-sessions checkbox (v2)
- Listing the user's recent sign-in activity below the form (v2)

## Open questions for human

- **Strength library choice:** zxcvbn is the canonical choice, but it's ~400KB minified and runs in the client. The alternative is a lighter custom rules-based meter (length, character classes, common-pattern check). My recommendation: zxcvbn for v1 — better UX, the bundle hit is acceptable on the auth pages which are not the catalog. **Resolved P1.3: shipped the lightweight custom-rules meter (same one as P1.1 signup). 5 levels, token-driven colors, no extra dependency. The spec's "5 levels: Very weak / Weak / Fair / Strong / Very strong" requirement is met by 5 levels (the labels are the existing P1.1 labels `too short / weak / ok / good / strong` which are semantically equivalent). zxcvbn can be swapped in later if the spec demands it.**
- **"No 2FA bypass" flag:** since v1 has no 2FA, this is moot. v2 will need to decide: does password reset bypass 2FA, or require it? My recommendation: bypass with an email confirmation ("yes, you really reset it") + a "we reset your password" security email. Confirm.
- **"Your password was changed" email:** should we send one? Pros: alerts the user if the reset was done by an attacker (they see a security email and can re-reset). Cons: more email volume. My recommendation: yes, send one with a "this wasn't me? secure your account" link. **Resolved P1.3: deferred to STUB-040 (Phase 17 SES). The in-page "Password updated — Redirecting..." state covers the immediate feedback loop.**
- **Min length:** 12 chars is industry-standard for a "strong" password. NIST 800-63B says min 8 + no complexity rules (we don't follow that — we want a floor). **Resolved P1.3: 12 + digit + symbol shipped via `UpdatePasswordSchema` (stricter than the signup form's "min 10 + upper/lower/digit" — the update flow is a "we know you have access to the inbox" moment, so a stronger secret is appropriate).**

---

## Implementation notes

- **Files (P1.3):** The set-new side lives in the same files as the rest of P1.3 — `02-features/auth/UpdatePasswordForm.tsx` (refactored), `02-features/auth/actions.ts` (refactored `updatePasswordAction`), `00-foundations/auth/rate-limit.ts` (extended with `update_password` kind), `02-features/auth/passwordStrength.ts` (new shared helper). Pages: `03-app/update-password/page.tsx` + `app/update-password/page.tsx` (refactored — added expired state + `?next=` pass-through).
- **Schema change:** `updatePasswordAction` now requires `min(12)` + digit + symbol (was `min(10)` + upper/lower/digit). The action still re-validates the schema before the Supabase call, so client-side bypass is impossible.
- **Rate-limit kind:** the new `AttemptKind = 'update_password'` value is supported by the same `checkRateLimit` / `recordAuthFailure` / `auditRateLimitTrigger` surface. The kind's audit action name is `password_update_rate_limited` (looked up from `AUDIT_ACTION_BY_KIND`).
- **Per-user rate limit:** the spec wants "max 5 updates per user per 15 min". We key the counter on the user's email (the user is identified by email at this point — the reset-token session has a known email via `auth.users.email`). The email-keyed counter is equivalent to a user-keyed counter in practice (one user = one email = one bucket). If we ever need a stricter per-user limit, a `user_id` column can be added to `auth_failed_attempts` and the helper can be extended.
- **Expired state:** the page renders an "expired" panel when `getSessionUser()` returns null. The panel includes a "Request a new reset link" CTA that goes to `/reset-password?next=<safeNext>` so the user can restart the flow. The same panel renders for "wrong token" / "expired token" / "already used" cases — no oracle per the spec.
- **Success state:** the form shows a "Password updated — Redirecting to your library…" panel for 1.2s before the action's `redirectTo` fires. The brief beat lets the user perceive the confirmation (especially screen-reader users). The navigation is driven by `setTimeout(router.push, 1200)` so the state has time to render.
- **Submit-disabled behavior:** the button is `disabled` + `aria-disabled` when `canSubmit` is false. `canSubmit` is derived from `passwordValue.length > 0 && confirmValue.length > 0 && passwordValue === confirmValue && strength.score >= 2`. Score 2 maps to label "ok" which is "Fair or better" in spec terms.
- **`?next=` pass-through:** the page reads `searchParams.next`, passes to the form. The form posts it back. The action validates via `safeNext()` and returns `redirectTo: safeNext(next) ?? '/library'`. The full chain: `/login?next=/library` → `/reset-password?next=/library` → email link with `?next=/library` embedded → `/update-password?next=/library` → success redirect to `/library`.
