# Signup — `/signup`

## What this page does

Email + password signup. Single form, single button. The user chooses their role at signup: **Customer** (default — the only role a regular signup gets), **Become a partner** (sends an application), or **Join as affiliate** (sends an application). After signup, the user is redirected to the `?next` param or `/library` by default.

Customer is the default role — no approval needed. Partner and Affiliate are gated behind an application (status='pending') and admin review.

OAuth (Google) is supported — same flow, different provider.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | logo, "Create your account" title, "Join 50,000+ resellers, instructors, and affiliates" subhead, "Already have an account? Sign in" CTA | hard-coded | form header |
| Form | email input, password input, password strength indicator, display name input, "I agree to terms" checkbox | form | text inputs + checkbox |
| Role chooser | 3 radio cards: Customer, Partner, Affiliate. Each has a short description. Customer is default. | form state | radio cards |
| Submit | "Create account" button | form | button |
| Divider | "or" | hard-coded | text |
| OAuth | "Continue with Google" button | OAuth flow | button |
| Error | (if signup fails) inline error message | server error | inline |
| Footer links | "Privacy", "Terms" | hard-coded | links |

**Server action:** `02-features/auth/actions/signUp.ts`. Calls Supabase Auth's `signUp` to create the user, then creates the `profiles` row, then (if partner/affiliate) creates the `partners` or `affiliates` row with `status='pending'`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Sign up as customer | Fill form, leave role as Customer, click "Create account" | Creates user + profile (role='customer'), sends verification email, redirects to `?next=` or `/library` | public |
| Sign up as partner | Fill form, select "Become a partner" role, click "Create account" | Creates user + profile (role='customer' initially) + partners row (status='pending'), shows a "Thanks, we'll review your application" state, redirects to `/partner/onboarding/welcome` | public |
| Sign up as affiliate | Fill form, select "Join as affiliate" role, click "Create account" | Creates user + profile (role='customer' initially) + affiliates row (status='pending'), shows the "Thanks" state, redirects to `/affiliate/onboarding/welcome` | public |
| Sign up with Google | Click "Continue with Google" | OAuth flow. After OAuth, if no role was chosen, defaults to Customer. Role can be set post-signup in `/settings`. | public |
| Verify email | Click the link in the verification email | Marks email as verified, allows access to gated features (checkout, etc.) | self |
| Resend verification email | Click "Resend" on the verification banner | Sends a new email, rate-limited to 1/minute, 5/hour | self |
| Sign in instead | Click "Sign in" link in header | Navigate to `/login?next=` (preserves next) | public |
| Agree to terms | Check the "I agree" checkbox | Required before submit | public |

## What this page does NOT do

- No email/phone verification step inside the form (verification happens via email link)
- No Captcha in v1 (re-evaluate if abuse hits)
- No "complete your profile" wizard after signup (the user is sent to /library; profile completion is optional and on /settings)
- No 2FA setup (v2)
- No social profile import (v2)
- No "invite code" / referral code field at signup (the affiliate attribution is via cookie, not a code field)
- No password hint (security risk)

## Acceptance criteria

### Customer signup (this tick — P1.1)

- [x] Page is public (no auth)
- [x] Email format is validated client-side (no server roundtrip) — Zod resolver on the client + server
- [x] Password strength is shown live — 5-bar meter with `too short / weak / ok / good / strong` labels derived from the same rules as the server-side Zod refinement (no new dependency)
- [x] Password requirements: min 10 chars, at least 1 number, at least 1 letter (enforced both client-side and server-side; both surface the same error message)
- [x] Password is NOT shown in plain text in the URL or any log — pino redact paths cover `password` / `*.password`; the form uses `<input type="password">`; the server action never logs the raw value
- [x] "I agree to terms" is required (submit disabled until checked) — checkbox is required, schema is `z.literal(true)`, server re-validates on submit, button is `disabled` + `aria-disabled` until checked
- [x] Duplicate email shows "An account with this email already exists. Sign in instead." (this DOES distinguish "exists" from "doesn't" — that's a deliberate trade-off because the user can recover via "Forgot password") — emitted by the `friendlyAuthError` mapper when Supabase returns "user already registered"
- [x] On successful signup:
  - User record created in `auth.users` (Supabase handles)
  - Verification email sent (Supabase handles)
  - Auto-login is gated by Supabase's email confirmation setting; in dev (auto-confirm) the user lands on `?next=` or `/library`; in prod (confirmation required) the user sees the "Check your email" message
  - Redirect to `?next=` (validated) or `/library` by default — `safeNext()` blocks protocol-relative (`//evil.com`), backslash, and `%2f%2f` bypasses
- [x] If `?next=` is invalid or external, fall back to `/library` — `safeNext()` returns `null` and the action uses `/library`
- [x] Audit logging: every signup attempt writes one row to `admin_audit_log` with `action='signup_attempted'` / `'signup_succeeded'` / `'signup_failed'`, `target_kind='user'`, hashed email (`sha256(AUDIT_HASH_SALT:email)`), hashed IP, and truncated UA. Service-role client is used so the write works before auth is established.

### Deferred to other phases

- [ ] Role chooser has Customer pre-selected — Phase 12 partner-onboarding wizard handles partner role intent (out of scope for P1.1; current signup creates `profiles.role='customer'` per the existing 0001 trigger)
- [ ] Selecting Partner or Affiliate shows a short description of what that means — Phase 12/13 partner / affiliate onboarding wizards own this affordance
- [ ] On successful signup: `profiles` row, partner/affiliate rows — `profiles` row is created by the existing DB trigger on `auth.users` insert; partner/affiliate rows are owned by the dedicated onboarding wizards (P12 / P13)
- [ ] OAuth flow: after returning from Google, if no role was selected, default to Customer — Phase 1 P1.6
- [ ] "Continue with Google" does NOT require "I agree to terms" — Phase 1 P1.6 (no Google OAuth UI yet)
- [ ] Rate limiting: max 3 signups per IP per hour — STUB-038 (this tick does IP hashing + audit logging but does not enforce a rate limit at the edge; deferred to Phase 2 P2.1 when the platform-wide rate-limit helper lands)
- [ ] Rate limiting: max 1 signup per email per 10 minutes — same STUB-038
- [ ] Welcome email on first signup — Phase 17 SES
- [ ] Resend verification email UI — Phase 1 P1.5
- [ ] **P1.6 Slice 2**: "Continue with Google" / "Continue with Apple" buttons on /signup (the buttons are code-complete; the /signup form adoption is the next slice after the /login wires up in P1.6 Slice 1)
- [ ] **P1.6 Slice 2**: "Continue with Google" does NOT require "I agree to terms" — Google's consent screen is the equivalent acceptance per Apple's App Store Guideline 4.8

### Cross-cutting (always true)

- [x] All form inputs are keyboard-navigable — checkbox is native `<input type="checkbox">`; button is a real `<button>`; the focus-visible outline is inherited from the P0.6 focus-ring work
- [x] Page renders in < 200ms p95 (RSC + static page; the form is the only client island)
- [x] No PII leak in URLs — `next` is the only URL param, no email/password echo; audit log stores hashed email only
- [x] No `TODO` / `FIXME` in the diff — `check:no-todo` is green

## Design reference

- Mockup: not yet built — to be created during the auth feature build
- Components: `00-foundations/ui/Input.tsx`, `00-foundations/ui/PasswordInput.tsx` (with strength meter), `00-foundations/ui/RoleChooser.tsx`, `00-foundations/ui/Checkbox.tsx`

## Security

- **Auth required:** no — this is the signup page
- **Allowed roles:** anyone
- **RLS policies that apply:** the `profiles`, `partners`, `affiliates` tables have INSERT policies that allow a user to create their own row
- **PII displayed:** the email and display name the user typed (locally only)
- **PII in URLs:** no
- **Audit logged:** yes — every signup is logged (user_id, ip_hash, ua_hash, role chosen)
- **Rate limiting:** see acceptance criteria
- **Open redirect protection:** the `?next=` param is validated server-side
- **Email verification:** required before checkout, library access, or any data-modifying action. The verification email contains a one-time link valid for 24h.
- **Password hashing:** handled by Supabase Auth (bcrypt or argon2id — Supabase's choice, we don't see the hash)
- **CSRF:** Supabase Auth handles CSRF for password signup via state tokens
- **OAuth security:** standard `state` param validation, `nonce` for ID token validation
- **Duplicate account prevention:** the email field has a unique constraint at the DB level
- **Brute force protection:** rate limits per IP and per email
- **Email enumeration protection:** the duplicate-email message is a deliberate trade-off (see above)
- **Third-party scripts:** Google OAuth SDK. No other third parties.

## Performance

- **Target p95:** < 200ms (page load) + < 2s (signup roundtrip, includes email)
- **Render strategy:** RSC + static
- **Cache:** static page, cached at edge
- **Bundle size budget:** < 35KB added to client bundle (form + password strength + role chooser)

## Out of scope for v1

- Email/phone verification step inside the form
- Captcha
- "Complete your profile" wizard
- 2FA setup
- Social profile import
- "Invite code" / referral code field
- Password hint

## Open questions for human

- **Welcome email on first signup:** send one with a link to /library and (for partner/affiliate) their onboarding next steps? My recommendation: yes. Resend template in `04-platform/emails/`.
- **Partner application form:** when a user signs up as Partner, do we ask for additional info right there (website, bio, why they want to be a partner), or do we collect that in `/partner/onboarding` after signup? My recommendation: minimal info at signup (just email + password + display name), then a separate onboarding flow at `/partner/onboarding` that collects the rest. Less friction at signup.
- **Affiliate application:** same question. My recommendation: same answer. Onboarding at `/affiliate/onboarding` after signup.
- **Account deletion (GDPR):** in v1, the user can request account deletion from `/settings`. We process it async (anonymize financial records, delete everything else). v2: self-serve.

---

## Implementation notes

### P1.1 (2026-06-25, slice shipped)

Customer signup polished to production-grade. The role chooser + partner/affiliate-onboarding paths stay out of scope (P12 / P13 own those); the rate-limit at the edge stays out of scope (P2.1 owns the platform-wide helper). What shipped in this tick:

- **Terms checkbox** — controlled, schema-validated as `z.literal(true)`, server re-validates. Submit button is `disabled` + `aria-disabled` until checked. Pinned at the bottom of the form, above the CTA.
- **`?next=` pass-through** — the signup page reads `searchParams.next`, the form appends it to the FormData, the action re-validates it via `safeNext()` (protocol-relative, backslash, and `%2f%2f` bypasses all blocked), and passes it through to `emailRedirectTo` so the post-verify landing honors it. The login form preserves the same `next` when linking to signup (and vice-versa).
- **Password strength meter** — 5-bar meter + label, driven by the same rules as the server-side Zod refinement (length ≥ 10, then variety classes). Hidden when the input is empty so it doesn't show "too short" before the user types.
- **Audit log on every attempt** — `writeSignupAudit()` runs before + after the Supabase call, writing one row per outcome to `admin_audit_log` with `action='signup_attempted' | 'signup_succeeded' | 'signup_failed'`, `target_kind='user'`, hashed email (`sha256(AUDIT_HASH_SALT:email)`), hashed IP, and UA truncated to 200 chars. Service-role client because the audit row needs to land before any auth context exists. Failures are logged but never block the user-facing flow.
- **Verify-gate landing copy** — the "Check your email" message now also surfaces a "Didn't get it? Check spam, or sign in to resend" hint so the post-submit state is actionable.
- **Open redirect protection** — `safeNext()` is exported from `actions.ts` so other auth flows can reuse the same rule. Already wired into `signInAction` and `signUpAction`.

Files touched:
- `02-features/auth/actions.ts` (signature: `signUpAction` now accepts `next` + `acceptTerms`; new `safeNext()` export)
- `02-features/auth/AuthForms.tsx` (signature: `SignUpForm` now accepts `next`; new `passwordStrength()` helper)
- `02-features/auth/AuthForms.module.css` (new: `.checkboxRow`, `.checkbox`, `.checkboxLabel`, `.fieldError`, `.strengthMeter`, `.strengthBarRow`, `.strengthBar`, `.strengthBarOn_{0..4}`, `.strengthLabel`; updated `.serverMessage` + new `.serverMessageHint`)
- `app/signup/page.tsx` (signature: now reads `searchParams.next`)
- `01-specs/pages/signup.md` (this file — acceptance criteria marked off, out-of-scope items point at the right phase)

STUB-038 created (next free ID, no collision) to capture the deferred IP-edge rate limit + welcome email follow-ups. Phase 2 P2.1 owns the platform-wide rate-limit helper; Phase 1 P1.5 owns the resend-verify UI; Phase 17 owns the welcome email.
