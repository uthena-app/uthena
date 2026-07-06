# Verify email — `/verify-email`

## What this page does

The landing page for the email verification link sent during signup. The user arrives here by clicking the link in the "Welcome to Uthena — confirm your email" message. The link contains a one-time token in the URL, which Supabase Auth's client SDK exchanges for a verification event via `verifyOtp`.

On success, the page shows "Email verified!" and auto-redirects to `/library` after 2 seconds. On failure (invalid token, expired link, already used), the page shows "Verification link expired or already used" with a "Resend verification email" button.

The resend action is rate-limited (1/minute, 5/hour per user) to prevent abuse. It is only available to logged-in, unverified users — anonymous visitors cannot trigger a resend (they have no user_id to verify).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header (loading) | spinner + "Verifying your email..." | server status | loading state |
| Header (success) | "Email verified!" heading, "Taking you to your library..." body | server action result | confirmation |
| Header (expired) | "This verification link has expired or already been used" heading, "Check your inbox for the most recent verification email" body, "Resend verification email" button (disabled if rate-limited, with "Try again in Xs" countdown) | session/error state | error panel |
| Footer links | "Privacy", "Terms" | hard-coded | links |

**Token verification (server):** on every request, the server reads the token from the URL and calls Supabase Auth's `verifyOtp({ token_hash, type: 'email' })`. The response determines which state to render. This is done in a server component so the page is rendered correctly on first paint (no client-side flash of "verifying...").

**Server action:** `02-features/auth/actions/resendVerificationEmail.ts`. Calls Supabase Auth's `resend({ type: 'signup', email: user.email })` for the currently signed-in user. Requires an active session and `email_confirmed_at IS NULL` in `auth.users`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Auto-verify on page load | Click verification link → arrive at `/verify-email?token=...` | Server calls `verifyOtp`, renders success, auto-redirects to `/library` | any (token is the credential) |
| Resend verification email | Click "Resend verification email" on the expired state | Server calls `resend`, shows "Email sent — check your inbox" toast, starts 60s cooldown | self (must be signed in, unverified) |
| Wait for cooldown | Rate-limited state | Button shows "Try again in 45s" countdown, auto-re-enables | self |
| Sign in instead | Click "Sign in" link | Navigate to `/login` | public |
| Sign out | Click "Sign out" | Sign out, navigate to `/` | self |

## What this page does NOT do

- Does not ask the user to type their email again (the resend goes to the email on their account, looked up by session)
- Does not require a captcha (v1)
- Does not show a "your email is now verified" banner across the app (v2; in v1, the next page load reflects the verified state because `auth.users.email_confirmed_at` is set)
- Does not handle the case of "user closed the browser before clicking the link" — the user can re-trigger a resend from their account settings
- Does not send a "welcome to Uthena" follow-up email on this page (the welcome email is sent on signup, not on verification)
- Does not display the user's email on the page (PII minimization)

## Acceptance criteria

- [ ] Page is public at the route level (the token in the URL is the credential)
- [ ] On load with a valid token: server calls `verifyOtp`, renders success, redirects to `/library` after 2s
- [ ] On load with an invalid/expired/already-used token: renders the expired state (no UI difference between the three failure modes)
- [ ] The expired state does NOT reveal whether the email was already verified (this would leak account state to anyone with the link)
- [ ] "Resend verification email" button is only enabled when the user has an active session AND `email_confirmed_at IS NULL` — otherwise the button is hidden
- [ ] Resend is rate-limited: 1 per 60s, 5 per hour per user (server-side, enforced before calling Supabase)
- [ ] When rate-limited, the button shows a live countdown ("Try again in 45s") and is disabled
- [ ] On successful resend, a "Check your inbox" toast appears for 4s
- [ ] On resend failure (Supabase error), an inline error appears ("Couldn't send email — try again")
- [ ] After successful verification, `auth.users.email_confirmed_at` is set (handled by Supabase Auth)
- [ ] After successful verification, the next page load reflects the verified state (no stale UI)
- [ ] After successful verification, if a `profiles` row did not exist yet, create it (edge case: OAuth signup that skipped the profile step) — handled by a DB trigger or by the `verifyOtp` callback
- [ ] All actions are keyboard-navigable
- [ ] Page renders in < 250ms p95 (RSC with the verifyOtp call)
- [ ] No PII in URLs (token is in the URL but is opaque; user's email is never in the URL)
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: not yet built — to be created during the auth feature build
- Components: `00-foundations/ui/Button.tsx`, `00-foundations/ui/AuthFormShell.tsx`, `00-foundations/ui/Toast.tsx`
- Theme: both

## Security

- **Auth required:** no at the route level. The verification token is the credential. For the resend action, yes — must be signed in.
- **Allowed roles:** anyone with a valid token. The resend action requires an authenticated, unverified session.
- **RLS policies that apply:** n/a for the verification itself (Supabase Auth owns `auth.users`). For the resend action, the user is identified by their session, not by a row lookup.
- **PII displayed:** no — we don't display the user's email on this page. The success message is generic.
- **PII in URLs:** the verification token is in the query string (Supabase Auth default — `token_hash`). The query string can appear in access logs. Mitigation: the token is single-use, short-lived (24h), and the access log retention is 30 days. v2: move to URL fragment like the reset token.
- **Audit logged:** yes — verification attempts (success and failure) are logged to `admin_audit_log` with action='email_verification' and a hashed user_id. Rate-limit hits on resend are also logged.
- **Rate limiting:** see acceptance criteria. Resend: 1/min, 5/hr per user. Page load itself is not rate-limited (the user might click the link from their email multiple times).
- **Token security:** generated by Supabase Auth (cryptographically random, single-use, 24h TTL for email verification).
- **CSRF:** the verification token is the CSRF defense (it's a one-time credential). The resend server action validates `Origin`/`Referer`.
- **Open redirect protection:** this page does not accept `?next=`. The success state always redirects to `/library`. If a future need arises, the same rules as `/login` apply.
- **Email enumeration protection:** the expired state does not distinguish "token never existed" from "token expired" from "token already used" from "email already verified". Same UI, same response time.
- **Re-verification abuse:** an attacker with a leaked verification link can verify the email — but if they have the link, they have the email account, so this is not an additional attack surface. Once verified, the link is dead.
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 250ms (page load, includes a `verifyOtp` roundtrip) + < 1s (resend roundtrip)
- **Render strategy:** RSC (the verifyOtp call happens on the server)
- **Cache:** not cached (depends on token, which is unique)
- **Bundle size budget:** < 8KB added to client bundle (just the resend button + countdown)

## Out of scope for v1

- Captcha
- "Welcome to Uthena" follow-up email on verification
- A "your account is now fully active" banner that persists across sessions
- A separate `/settings/email` page for managing the verification status (added in v2)
- Showing a list of "what you can do now that you're verified" suggestions after verification
- Phone verification (v2)
- Re-sending from a "type your email again" form (v2 — in v1, the user must be signed in to resend)
- Multi-language verification emails (v1 English only; the UI is bilingual via the locale preference)

## Open questions for human

- **Token in query vs fragment:** Supabase Auth puts the email verification token in the query string by default (unlike the password reset token, which is in the fragment). This means it can land in access logs. My recommendation: keep the default for v1 (24h TTL + single-use mitigates the risk) and revisit in v2. Alternatively, we can configure Supabase to use the fragment for both. Confirm.
- **Auto-redirect delay:** 2 seconds is the spec default. Faster (1s) is less patient, slower (4s) is friendlier for slow networks. My recommendation: 2s. Confirm.
- **Resend for users NOT signed in:** if the user closes the browser, opens the email on a different device, and clicks the link, they may not be signed in. The expired state has no resend button. Should we add a "type your email to resend" fallback? My recommendation: no for v1 — they can sign in on the same device (their original session is still alive if it hasn't expired) or use the "forgot password" flow. Adding a resend-by-email path adds an enumeration vector. Confirm.
- **Should we hide the resend button entirely and require re-signup?** I lean against this — the user did sign up, they just need a new link. Hiding resend pushes them to support. Confirm resend is the right UX.

---

## Implementation notes

### P1.5 implementation (2026-06-25)

**Entry shapes handled (union covers all paths Supabase + our forms can land here):**

1. `?token_hash=...&type=email` — direct OTP-style link. Server-side calls
   `supabase.auth.verifyOtp({ token_hash, type: 'email' })` and renders
   success or expired based on the result.
2. `?type=signup` — came from the auth callback after a PKCE exchange.
   The callback has already set `email_confirmed_at`; we render success
   and auto-redirect to `next` after 2s.
3. No params + signed in + verified → success state (defensive — page is
   rarely reached here, but `router.refresh` after verification could
   land here).
4. No params + signed in + unverified → "Check your inbox" landing with
   the resend button.
5. No params + anonymous → "Check your inbox" landing, no resend button
   (per spec — the resend action requires a session).

**`?next=` pass-through.** The signup action embeds it in the email's
`redirectTo`:

```ts
emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
  `/verify-email?type=signup&next=${encodeURIComponent(validNext)}`,
)}`
```

The auth callback's existing `new URL(next, origin)` parsing
round-trips it to `/verify-email?type=signup&next=/library`. The page
validates `next` via `safeNext()` before using it for the auto-redirect
— defense-in-depth, the callback already validates it.

**Unified expired state.** Per spec §Security "Email enumeration
protection": invalid / expired / already-used / already-verified all
render the same expired UI. The page NEVER reveals whether an email
is already verified. The resend action requires an active session and
`email_confirmed_at IS NULL`; an already-verified user gets a
friendly "your email is already verified" message (no email sent).

**Rate-limit handling.** Spec says "1 per 60s, 5 per hour per user".
The `checkRateLimit` helper uses a single 15-min window; we map the
intent to `perEmail: 1, perIp: 20` (max 4 attempts per hour —
strictly tighter than 5/hour, and a 15-min minimum gap — vastly more
than 60s). See STUB-041 for the follow-up if the gap matters.

**Files shipped:**
- `04-platform/migrations/0019_auth_failed_attempts_email_verification.sql`
- `00-foundations/auth/rate-limit.ts` (extended — `'email_verification'` kind + new LIMITS row + new AUDIT_ACTION_BY_KIND entry)
- `02-features/auth/actions.ts` (added `resendVerificationEmailAction`)
- `02-features/auth/ResendVerificationForm.tsx` + `.module.css`
- `02-features/auth/VerifyEmailRedirect.tsx` (2s auto-redirect)
- `app/verify-email/page.tsx` (full rewrite — 4 states + server-side `verifyOtp` + `?next=` pass-through)
- `app/verify-email/verify-email.module.css` (NEW — token-only styles for the 3 states)
- `app/verify-email/loading.tsx` + `loading.module.css` (unchanged from P0.24)

**Open follow-up:** STUB-041 documents the single-window rate-limit
gap if fine-grained "1/60s + 5/hour" enforcement is ever needed.
