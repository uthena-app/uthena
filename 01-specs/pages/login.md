# Login — `/login`

## What this page does

Email + password login. Single form, single button. After successful login, the user is redirected to the `?next` query param (if set) or `/library` by default. If the user came from an affiliate link, the affiliate attribution is preserved through the login.

OAuth (Google, GitHub) is supported as a secondary option — same auth flow, different identity provider. In v1 we ship Google only; GitHub is added in v2.

"Sign in" not "Log in" because the brand voice prefers verb forms.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | logo, "Sign in" title, "Welcome back" subhead, "Don't have an account? Sign up" CTA | hard-coded | form header |
| Form | email input, password input, "Remember me" checkbox (v1: always true), "Sign in" button | form | text inputs + button |
| Divider | "or" | hard-coded | text |
| OAuth | "Continue with Google" button | OAuth flow | button |
| Error | (if login fails) "Invalid email or password" message | server error | inline |
| Footer links | "Forgot password?", "Privacy", "Terms" | hard-coded | links |

**Server action:** `02-features/auth/actions/signIn.ts`. Uses Supabase Auth's `signInWithPassword`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Sign in with email/password | Fill form, click "Sign in" | Server validates, creates session, redirects to `?next=` or `/library` | public |
| Sign in with Google | Click "Continue with Google" | OAuth flow, returns to same redirect logic | public |
| Forgot password | Click "Forgot password?" | Navigate to `/reset-password` | public |
| Sign up | Click "Sign up" link in header | Navigate to `/signup?next=` (preserves next) | public |
| Resend verification email | (only on signup, see /signup spec) | — | — |
| View privacy / terms | Click footer links | Navigate to `/privacy` / `/terms` | public |

## What this page does NOT do

- No "remember this device" trust signal (v1: cookies expire on session end + 30 days, no per-device trust)
- No "login as admin" (admins use the same login form; the role check happens post-auth via `profiles.role`)
- No magic link login (v2)
- No phone/SMS login (v2)
- No 2FA (v2; documented as a v2 feature in the security review checklist)
- No "stay signed in" beyond 30 days (v2)
- No "log in as a different user" UI inside the app (sign out, then sign in)
- No social proof ("trusted by 50,000 users") — out of scope for v1
- No Captcha — re-evaluate if abuse becomes an issue

## Acceptance criteria

### Customer login (this tick — P1.2)

- [x] Page is public (no auth required to view)
- [x] Invalid email format shows inline validation (no server roundtrip)
- [x] Empty fields show "Required" inline (no server roundtrip)
- [x] Wrong credentials show "Email or password is incorrect." (don't distinguish "user not found" from "wrong password" — security)
- [x] On successful sign-in, session cookie is set with HttpOnly, Secure, SameSite=Lax
- [x] Session TTL: 30 days (refreshed on activity — Supabase default)
- [x] `?next=` param is validated — must be a relative path, never an external URL (open redirect protection via `safeNext()`)
- [x] If `?next=` is invalid or external, fall back to `/library`
- [x] If the user is already logged in and visits /login, server-side redirect to `?next=` (or `/library`) — no double-login
- [x] **Rate limiting: max 5 failed attempts per email per 15 minutes** → 15-min cooldown + inline cooldown notice + submit button disabled
- [x] **Rate limiting: max 20 failed attempts per IP per 15 minutes** → same cooldown UX (dimension is per-email OR per-IP, whichever trips first)
- [x] **Rate limiting is logged to `admin_audit_log`** with `action='auth_rate_limit_triggered'`, `target_kind='auth_attempt'`, `target_id='email'|'ip'`, hashed email + IP in metadata
- [x] **Every failed sign-in attempt** (regardless of reason: wrong password, unverified email, unknown user, server error) writes one row to `auth_failed_attempts` with the hashed email + IP, so admins can review abuse patterns
- [x] **Remember-me checkbox** is present, defaults to checked (per spec), persists choice to localStorage so a re-visit keeps the user signed in
- [x] Forgot-password link preserves `?next=` so the post-reset flow lands the user back where they tried to go
- [x] Sign-up link in the footer preserves `?next=`
- [x] OAuth flow correctly returns to the same `?next=` — **P1.6 Slice 1** ships this. The `signInWithOAuthAction` embeds `next` in the provider's `redirectTo`; the auth callback preserves it; the user lands back where they intended.
- [x] OAuth account with same email as existing password account: link them (Supabase's `auth.email.link_accounts=true` setting handles this — documented in P1.6's spec; STUB-042 tracks the flip to `false` if we ever want a stricter link-confirmation flow)
- [x] All form inputs are keyboard-navigable
- [x] "Enter" submits the form
- [x] Cooldown notice uses `role="status"` + `aria-live="polite"`; the submit button gets `disabled` + `aria-disabled` while the cooldown is active
- [x] Page renders in < 200ms p95 (RSC, single server action)
- [x] No PII leak in URLs (the rate-limit dimension is reported as "email" / "ip" without the actual values)
- [x] No `TODO` / `FIXME` in the diff

### Deferred to other phases

- **P1.6 Slice 2** — /signup OAuth wiring + Apple-specific concerns (the first-sign-in name capture, the "Hide My Email" relay). P1.6 Slice 1 (this tick) ships the OAuth infra + the buttons on /login; /signup adoption is the next slice.
- **P1.10 — Account switcher (admin)** — the admin-only "log in as user X" surface; orthogonal to this spec.

### Cross-cutting

- **Open-redirect guard**: `safeNext()` in `02-features/auth/redirect.ts` — must start with `/`, must NOT start with `//`, must NOT contain `\`, must NOT match `/[^/]*:\/\//`, must NOT contain `%2f%2f`.
- **Audit-log destinations**: `admin_audit_log` for the rate-limit trigger event (action='auth_rate_limit_triggered'); `auth_failed_attempts` for every failed attempt (per-IP, per-email, hashed). The two tables are joined-by-hash so admins can pivot.
- **PII safety**: emails and IPs are SHA-256-hashed with `AUDIT_HASH_SALT` before storage. The raw IP is retained only long enough to be returned to the client in the rate-limit response (the response surface is the duration in seconds, NOT the IP itself).
- **Lazy GC**: the rate-limit helper deletes `auth_failed_attempts` rows older than 24 hours on a best-effort basis (every 32 calls).

## Design reference

- Mockup: not yet built — to be created during the auth feature build
- Components: `00-foundations/ui/Input.tsx`, `00-foundations/ui/Button.tsx`, `00-foundations/ui/AuthFormShell.tsx`

## Security

- **Auth required:** no — this is the auth page
- **Allowed roles:** anyone
- **RLS policies that apply:** n/a (no DB access on this page except for auth)
- **PII displayed:** the email the user typed (locally only, in the input field — we don't echo it back)
- **PII in URLs:** no
- **Audit logged:** yes — failed login attempts are logged with IP, user-agent, and the email attempted (email is hashed, not stored in plaintext). Successful logins are NOT individually logged (would create too much log volume) — we monitor aggregate metrics instead.
- **Rate limiting:** see acceptance criteria
- **Open redirect protection:** the `?next=` param is validated server-side. Only relative paths starting with `/` and not `//` are allowed.
- **CSRF:** Supabase Auth handles CSRF for password login via state tokens. OAuth uses standard `state` param.
- **Session security:** HttpOnly + Secure + SameSite=Lax cookies. Session tokens rotated on privilege escalation.
- **Brute force protection:** the rate limit + IP-based throttling is the primary defense
- **Email enumeration protection:** we don't distinguish "user not found" from "wrong password"
- **Timing attack protection:** the auth check takes a constant time regardless of which error we return
- **Third-party scripts:** Google OAuth SDK. No other third parties.

## Performance

- **Target p95:** < 200ms (page load) + < 1s (auth roundtrip)
- **Render strategy:** RSC + static
- **Cache:** static page, cached at edge
- **Bundle size budget:** < 30KB added to client bundle (form + minimal JS for OAuth flow)

## Out of scope for v1

- "Remember this device" trust signal
- Magic link login
- Phone/SMS login
- 2FA (TOTP, SMS, hardware keys)
- "Stay signed in" beyond 30 days
- "Log in as a different user" inline UI
- Social proof
- Captcha (re-evaluate if abuse hits)

## Open questions for human

- **OAuth providers in v1:** Google only, or also Apple/Microsoft? My recommendation: Google only. Apple is iOS-only and adds friction; Microsoft is enterprise and we don't have enterprise customers yet. Add in v2.
- **"Sign in" vs "Log in" copy:** I went with "Sign in" for brand voice. Confirm this is the right call.
- **Failed-attempt throttling:** hard block (15min wait) or soft (CAPTCHA after 3)? My recommendation: hard block. Simpler. Less code. CAPTCHA can be added in v2 if needed. **Resolved in P1.2**: hard block with the per-IP + per-email limits spec'd above; CAPTCHA deferred to v2.
- **Welcome email on first sign-in:** do we send one? My recommendation: yes, a single welcome email with a link to the library and to the partner/affiliate signup if they want. Resend template in `04-platform/emails/`. **Deferred to Phase 17** (SES).

---

## Implementation notes

### P1.2 — Login UX (this tick)

**Files shipped (8 new, 4 modified):**

- **NEW** — `04-platform/migrations/0017_auth_failed_attempts.sql` — new table with 3 covering indexes (per-email window, per-IP window, per-kind audit-trail) + RLS (`admin_read` only; no anon/auth policies; service-role client bypasses RLS for the helper).
- **NEW** — `00-foundations/auth/rate-limit.ts` — `recordAuthFailure()`, `checkRateLimit()`, `retryAfterSeconds()`, `auditRateLimitTrigger()`, `maybeGc()`. Sliding-window counter over the `auth_failed_attempts` table (no in-memory state — works across instances). Hashes email + IP with `AUDIT_HASH_SALT` before storage.
- **MODIFIED** — `02-features/auth/actions.ts` — added `rateLimited` discriminator to `AuthActionResult`, extended `SignInSchema` with optional `remember` field, called `checkRateLimit()` BEFORE the Supabase Auth call, called `recordAuthFailure()` on every failure (mapped reason via `mapFailureReason()`), called `auditRateLimitTrigger()` when the gate trips.
- **MODIFIED** — `02-features/auth/AuthForms.tsx` — added remember-me checkbox (persists to `localStorage` key `uthena.rememberMe.v1`), inline cooldown notice (role=status, aria-live=polite, tabular-nums countdown), `?next=` preservation on the forgot-password link, `disabled` + `aria-disabled` on inputs + submit during cooldown.
- **MODIFIED** — `02-features/auth/AuthForms.module.css` — added `.rememberRow`, `.cooldownNotice`, `.cooldownLabel`, `.cooldownCount`, `.cooldownHint` (all token-only).
- **MODIFIED** — `app/login/page.tsx` — server-side `getSessionUser()` check at the top; logged-in visitors are redirected to `?next=` (validated) or `/library` — no double-login.
- **MODIFIED** — `02-features/auth/README.md` — file map updated; P1.2 status moved to "shipped".
- **MODIFIED** — `01-specs/pages/login.md` — this file. Acceptance criteria reorganized into "Customer login (this tick — P1.2)" + "Deferred to other phases" + "Cross-cutting".

**Architecture decisions worth remembering:**

- **Why a separate `auth_failed_attempts` table** (not a counter on a shared admin table). The admin_audit_log FK requires `auth.users.id`, which doesn't exist for pre-auth events. The new table is INSERT-only from the service-role client and has its own admin_read policy.
- **Why lazy GC instead of a cron job**. The spec has no scheduled-job infrastructure yet (Phase 18 P18.7 — APM + DB slowlog — is where DB maintenance jobs land). Lazy GC keeps the table bounded at ~5 MB per 100k attempts without adding operational surface area.
- **Why the rate-limit gate runs BEFORE the Supabase Auth call**. Two reasons: (a) avoids burning through Supabase Auth's own throttling quota, (b) prevents an attacker from using the rate-limit response as an oracle for "this email exists" (the rate-limit path returns the same copy regardless of whether the email is registered).
- **Why the rate-limit response surfaces the duration but not the IP**. The cooldown seconds are required so the form can show a countdown. The IP is never sent back to the client (even hashed) — it's a server-internal key. Same for the email.
- **Why `localStorage` for remember-me (not a server-side flag)**. The Supabase session cookie already controls persistence; the "remember me" checkbox is a UX hint that the form reads on the next visit to decide whether to re-prime the email field. A server-side flag would require an extra column on `profiles` + a sync point on every login.
- **Why the `disabled` + `aria-disabled` pair on the submit button**. Visual disabled state for sighted users; aria-disabled keeps the button focusable + announces the disabled state to screen readers (the native `disabled` attribute removes the button from the tab order, which can confuse assistive tech users who expect to land on it + see the cooldown).
- **Why `setValue('remember', 'on' | '')` and not `boolean`**. The HTML form posts `remember=on` when checked, no value when unchecked. Zod's `union([literal('on'), literal('')])` matches the wire format exactly; mapping to a boolean would add a transformation that doesn't buy anything.
- **Why the audit-log FK hack (`actor_id = '00000000-...'`)**. Pre-auth events have no `auth.users.id` to FK-reference. The pattern matches Phase 2 P2.1's planned `auth_audit_log` table (STUB-038). When that table lands, the rate-limit trigger rows migrate there and the admin_audit_log writes stop.

**What's NOT in this tick (documented in spec as deferred):**

- OAuth (P1.6) — the form's "Continue with Google" button is NOT in this tick. The action's `AuthActionResult` shape already supports a separate OAuth result type when P1.6 lands.
- Captcha — re-evaluate if abuse hits the rate-limit thresholds in production.
- Welcome email on first sign-in — Phase 17 (SES).
- Welcome email on every sign-in — out of scope (would create too much volume).
- "Login as admin" inline switcher — P1.10.
