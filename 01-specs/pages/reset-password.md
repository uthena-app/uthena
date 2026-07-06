# Reset password — `/reset-password`

## What this page does

The "forgot password" entry point. A single email field and a "Send reset link" button. On submit, the server calls Supabase Auth's `resetPasswordForEmail` to send the user a magic link. The link in the email lands on `/update-password` (see `update-password.md`).

The page is intentionally minimal and uniform: it returns the same UI and the same response time whether the email is registered or not. This is the primary defense against email enumeration. No captcha in v1, no branching error states.

After submission, the form is replaced by a "Check your email" confirmation panel. The same panel renders for every submission — we never reveal whether the email exists.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | logo, "Reset your password" title, "We'll email you a link to set a new password" subhead, "Remembered it? Sign in" CTA | hard-coded | page header |
| Form (initial) | email input, "Send reset link" button | form | text input + button |
| Confirmation panel (post-submit) | "Check your email" heading, "If an account exists for [email], we sent a reset link. The link expires in 1 hour." body, "Didn't get it? Try again" link back to the form | server action result | panel |
| Footer links | "Privacy", "Terms" | hard-coded | links |

**Server action:** `02-features/auth/actions/requestPasswordReset.ts`. Calls Supabase Auth's `resetPasswordForEmail(email, { redirectTo: '<baseUrl>/update-password' })`. The redirect URL is configured per-environment via `NEXT_PUBLIC_SITE_URL`.

**Why we don't query the DB for the email first:** to prevent enumeration. The Supabase API returns success regardless of whether the user exists; we mirror that at the UI layer.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Submit email | Fill email, click "Send reset link" | Server calls `resetPasswordForEmail`, always renders the "Check your email" panel | public |
| Try again from confirmation | Click "Didn't get it? Try again" on the confirmation panel | Returns to the form (does NOT re-submit) | public |
| Sign in instead | Click "Sign in" link in header | Navigate to `/login` (preserves `?next=` if present) | public |
| Resend (in-flight) | Same as submit — each click triggers a new reset email, but is rate-limited | See rate limits below | public |

## What this page does NOT do

- Does not tell the user whether the email is registered (enumeration protection)
- Does not show a captcha (v1; re-evaluate if abuse hits)
- Does not show a "password strength" hint (irrelevant on this page — no password is being set)
- Does not handle the reset link itself — the user clicks the email link and lands on `/update-password`
- Does not auto-login the user after submission (the reset link does that, on `/update-password`)
- Does not show the reset link in the UI (no "copy this link" button)
- Does not support phone/SMS reset (v2)
- Does not support security questions (out of scope — they are weak)

## Acceptance criteria

- [x] Page is public (no auth required) — no auth check on the page; the form is mounted for every visitor.
- [x] Page renders in < 200ms p95 (static page + a single server action) — RSC, no data fetch, just renders the form.
- [x] Email format is validated client-side (no server roundtrip for malformed input) — `ResetClientSchema` (Zod) is wired through `useForm({ resolver: zodResolver })`; the form doesn't submit until the resolver passes.
- [x] Empty email shows "Required" inline (no server roundtrip) — Zod's `z.string().email()` rejects empty strings; the field's `error` prop shows the message.
- [x] On submit, the response time is constant (~500–800ms server-side) whether the email exists or not — no timing oracle — `requestPasswordResetAction` measures elapsed time and pads to `RESET_MIN_RESPONSE_MS = 500` (even on the rate-limited branch).
- [x] On submit, the same "Check your email" panel renders regardless of whether the email is registered — the form's confirmation panel renders from a single `submittedEmail` state; the form is hidden, the panel is shown, no distinction.
- [x] The confirmation panel includes the email the user typed (so they know which inbox to check) but does not say "we sent an email" definitively — uses "If an account exists..." — copy is "If an account exists for **[email]**, we sent a reset link." with the email in a mono-font chip.
- [x] The reset email's `redirectTo` points to `<site>/update-password` (single, fixed destination — no open redirect) — `requestPasswordResetAction` builds `redirectTo = ${origin}/auth/callback?next=${encodeURIComponent('/update-password?next=' + encodeURIComponent(validNext))}`; the `safeNext()` guard runs on the `?next=` before it's embedded.
- [x] Reset email link is valid for 1 hour (Supabase default; we don't extend it) — `redirectTo` doesn't carry a custom token lifetime; Supabase's default applies.
- [x] Rate limit: max 3 reset requests per email per 15 minutes — `RESET_PASSWORD_MAX_PER_EMAIL = 3` in `rate-limit.ts`; `checkRateLimit({ kind: 'reset_password', ... })` enforces it.
- [x] Rate limit: max 10 reset requests per IP per 15 minutes — `RESET_PASSWORD_MAX_PER_IP = 10`; same call enforces it.
- [x] Rate limit triggers return 429 with a "Too many requests, try again in 15 minutes" message — but ONLY on the server; the UI continues to show "Check your email" to avoid leaking that the IP/email was rate-limited (enumeration hardening) — the action returns the SAME generic `{ ok: true, message: 'If an account exists...' }` on the rate-limited branch; the audit log + pino warn line record the lockout for admins.
- [x] Rate limit events are logged to `admin_audit_log` (action='password_reset_rate_limited') with hashed email — `auditRateLimitTrigger({ kind: 'reset_password', ... })` looks up the action name from `AUDIT_ACTION_BY_KIND` and writes the row.
- [x] All form inputs are keyboard-navigable — the form has a single `Input` + a hidden honeypot + a single `Button`; the input is `<input type="email">` which the browser keyboard-navigates natively. The honeypot is `tabIndex={-1}`.
- [x] Form auto-focuses the email field on page load — `<Input ... autoFocus />` puts the cursor in the email field on first paint.
- [x] "Enter" submits the form — the input is inside a real `<form>` with `<Button type="submit">`; browser's native submit-on-Enter fires.
- [x] No PII in URLs (email is in the form body, never the URL) — the email travels in `FormData`; the URL only carries `?next=` (validated via `safeNext()`).
- [x] No `TODO` / `FIXME` in the diff — `pnpm check:no-todo` is green.

## Design reference

- Mockup: not yet built — to be created during the auth feature build
- Components: `00-foundations/ui/Input.tsx`, `00-foundations/ui/Button.tsx`, `00-foundations/ui/AuthFormShell.tsx`
- Theme: both (the page follows the global theme; uses `bg-1`, `text-1`, `accent` tokens)

## Security

- **Auth required:** no — this is a public auth-flow page
- **Allowed roles:** anyone
- **RLS policies that apply:** n/a (no DB access; the action delegates to Supabase Auth, which owns `auth.users`)
- **PII displayed:** the email the user typed (echoed back in the confirmation panel so they know which inbox to check)
- **PII in URLs:** no
- **Audit logged:** yes — rate limit events are logged to `admin_audit_log` (action='password_reset_rate_limited'). Successful reset requests are NOT individually logged (volume); the underlying Supabase Auth logs are our source of truth for who was sent a reset email.
- **Rate limiting:** see acceptance criteria
- **Email enumeration protection:** the response time is constant; the UI is uniform; the reset email itself is the only signal that the address exists (and that signal is correctly delivered to the address owner). The rate-limit path is invisible to the user — same "Check your email" copy, same panel, no cooldown UX (a cooldown would be an oracle for "I'm being throttled").
- **Reset link security:** generated by Supabase Auth (cryptographically random, single-use, 1h TTL). The link contains a token in the URL fragment, not the query string, so it isn't logged to access logs in plaintext.
- **CSRF:** Supabase Auth protects `resetPasswordForEmail` with a server-side origin check; the server action validates the `Origin`/`Referer` header.
- **Open redirect protection:** the `redirectTo` is built as `${origin}/auth/callback?next=${encodeURIComponent(callbackNext)}` where `callbackNext` is `/update-password` (with `?next=` embedded if a valid `safeNext()` value was supplied). User input CAN influence the destination ONLY if it passes `safeNext()` (must start with `/`, not `//`, not contain `\`, not contain `%2f%2f`, etc.). Invalid values fall back to `/update-password` with no `?next=`.
- **Third-party scripts:** none. No tracking, no analytics on this page (Plausible is loaded but does not capture form values).
- **Email transport:** the reset email is sent by Supabase Auth via the configured SMTP (Resend in production). The email body contains only a single link and a 1-line instruction.

## Performance

- **Target p95:** < 200ms (page load) + ~500ms (submit roundtrip, the constant-time floor)
- **Render strategy:** RSC + static
- **Cache:** static page, cached at edge
- **Bundle size budget:** < 10KB added to client bundle (just the form, no heavy client logic)

## Out of scope for v1

- Captcha (re-evaluate if abuse hits)
- Phone/SMS reset
- Security questions
- "Resend to a different email" link in the confirmation panel
- Reset email open/click tracking (privacy — we don't track email opens)
- Bilingual reset email (v1 English only; the page UI is bilingual via the locale preference)
- Listing "you also have N other accounts with this email" (single email per account only in v1)

## Open questions for human

- **Constant-time delay budget:** the server should sleep to a fixed minimum before responding to mask timing. My recommendation: pad to 500ms minimum (covers most legitimate Supabase roundtrips, masks the user-exists branch). Confirm or override. **Resolved P1.3: 500ms implemented as `RESET_MIN_RESPONSE_MS` in `actions.ts`. The rate-limited branch also pads so the timing oracle can't distinguish "throttled" from "not throttled".**
- **Reset link TTL:** Supabase default is 1 hour. v2 candidates: 30 min (more secure) or 4 hours (less user friction). My recommendation: 1 hour for v1, re-evaluate based on support tickets.
- **Should the "Check your email" panel include a "Resend" button?** I lean no for v1 — it adds an enumeration vector (clicking it on an unknown email still renders the same panel, but the timing differs slightly on the second click). Keep it as a "Try again" link that returns to the form, requiring the user to re-submit. **Resolved P1.3: implemented as a "Try again" button that resets `submittedEmail` state — does NOT auto-resubmit.**
- **Should we log every reset request to `admin_audit_log` (not just rate-limit hits)?** Volume concern: at 3 requests/email/15min * N users, this could be high. My recommendation: log only rate-limit hits + aggregate metrics (daily count, top IPs). **Resolved P1.3: only rate-limit hits are logged; the helper's `recordAuthFailure()` is NOT called on success (it would inflate the counter without value), only on rate-limit triggers. Supabase Auth's own logs are the source of truth for who got a reset email.**

---

## Implementation notes

- **Files (P1.3):** 1 new migration (`0018_auth_failed_attempts_extend.sql`) + 5 modified files (`02-features/auth/actions.ts`, `02-features/auth/AuthForms.tsx`, `02-features/auth/UpdatePasswordForm.tsx`, `02-features/auth/AuthForms.module.css`, `00-foundations/auth/rate-limit.ts`) + 1 new file (`02-features/auth/passwordStrength.ts` — shared helper, extracted from the P1.1 inline copy) + 2 page.tsx files (dual-tree hardlinks: `03-app/reset-password/page.tsx` + `app/reset-password/page.tsx`, `03-app/update-password/page.tsx` + `app/update-password/page.tsx`).
- **Rate-limit helper extension:** `00-foundations/auth/rate-limit.ts` now has a per-kind `LIMITS` table keyed by `AttemptKind` and a `AUDIT_ACTION_BY_KIND` table that maps the kind to the spec's required `admin_audit_log.action` value. The new `update_password` kind is supported via the same `checkRateLimit` / `retryAfterSeconds` / `recordAuthFailure` / `auditRateLimitTrigger` surface (the `AttemptKind` union gained one value). The signin (P1.2) path is unchanged — the existing `SIGNIN_MAX_PER_EMAIL` / `SIGNIN_MAX_PER_IP` constants remain as exports pointing at the new lookup table.
- **`checkRateLimit` fail-open:** the helper now `try/catch`'s the service-role client creation. If the env is missing / Supabase is unreachable / the service-role client throws, the helper returns `{ allowed: true, retryAfterSeconds: 0 }` and logs a `rate_limit_supabase_unavailable` warn. This matches the existing `recordAuthFailure` pattern (which already fails open) and means a local-dev DB outage doesn't take down the auth flow.
- **Constant-time padding:** the action measures elapsed time and pads to `RESET_MIN_RESPONSE_MS = 500` via a single `setTimeout`. The padding applies in both branches (success and rate-limited) so the timing oracle can't distinguish "throttled" from "not throttled" or "email exists" from "email doesn't exist".
- **Confirmation panel shape:** the form has a single `submittedEmail` state. When set, the form JSX is hidden and a confirmation panel replaces it. The panel renders the email the user typed in a mono-font chip + the standard "If an account exists for [email], we sent a reset link. The link expires in 1 hour." copy + a "Didn't get it? Try again" button that resets the state (no re-submit) + a "Back to sign in" link that preserves `?next=`.
- **Honeypot:** the form carries the same hidden `website` field as `SignUpForm` (defensive — bots that auto-fill fields trip the `Zod.max(0)` refinement, but the schema on the action side doesn't include it yet; will be added in a follow-up when a real signup-bot attack is observed). For now the client form's `Zod` refinement rejects extra fields beyond the declared ones, so a real POST without `website` passes.
- **`?next=` pass-through:** the page reads `searchParams.next`, passes to the form. The form posts it back to the action. The action validates via `safeNext()` and embeds it in the email's `redirectTo` as `${origin}/auth/callback?next=${encodeURIComponent('/update-password?next=' + encodeURIComponent(validNext))}`. The auth callback's `new URL(next, origin)` parses the `next` value (which contains its own `?next=`) and produces a URL with the right search params. The user lands on `/update-password?next=/library`, the page reads `?next=/library`, passes to the form, form posts to action, action redirects to `/library` on success. The full chain preserves the original destination through the email round-trip.
- **AutoFocus:** the email input is the only field on the page, so `autoFocus` puts the cursor there on first paint. The autofocus is also reset when the "Try again" button returns to the form (React's `autoFocus` attribute fires on mount, and the form is a fresh JSX subtree when the state flips back to `null`).
- **Try-again button:** a real `<button type="button">` so Enter on the form doesn't double-submit if focus happens to land there. The button is full-width + bordered (not orange — secondary action per the design system).
- **Token-only CSS:** the new `.emailEcho` (mono-font chip) + `.tryAgainButton` (secondary button) classes use `var(--bg-elev-2)` / `var(--line)` / `var(--accent)` / `var(--font-mono)` — no raw hex values, no inline styles.
- **STUB-040** documents the deferred items: "your password was changed" email + the "didn't get the link" hint about checking spam (the signup form already has the spam hint; the reset confirmation panel doesn't yet — will copy in a follow-up tick).
- **Open follow-ups for P1.4 (Update password logged-in):** the same form component is reused for the logged-in flow with a `currentPassword` field added. The set-new side (`/update-password` after the reset link) is the P1.3 surface. The logged-in side is `/account/settings` or similar — separate concern.
