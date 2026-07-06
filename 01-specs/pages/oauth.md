# OAuth (third-party login) — P1.6

> **This is a cross-cutting spec** for the OAuth provider buttons that ship
> on `/login` and `/signup`. The implementation touches the foundation
> (rate-limit helper, env-gated provider config), the auth feature
> (server action + buttons), and both auth pages. The previous P1.1 +
> P1.2 + P1.3 + P1.4 + P1.5 specs deferred this work to P1.6 — those
> deferred items move into the "Customer login / signup (P1.6)" sections
> of `login.md` and `signup.md` when this spec ships.

## What this feature does

Adds **Google** and **Apple** as third-party sign-in providers on
`/login` and `/signup`. Same flow shape as email + password — a single
button, a single round-trip to the provider, the user lands back on the
post-auth destination with a valid Supabase session.

```
/login or /signup
   → click "Continue with Google"
   → server action calls supabase.auth.signInWithOAuth({ provider: 'google' })
   → browser follows the returned URL to Google's consent screen
   → user consents
   → Google redirects to /auth/callback?code=...&next=...
   → callback exchanges the code for a session cookie
   → user is redirected to `next` (or /library by default)
```

The same shape applies to Apple. The two providers differ only in the
provider ID — everything else (the action, the buttons, the callback,
the audit log) is shared.

## Why Google + Apple

- **Google** — by far the most common third-party login on the modern
  web. Supabase's hosted OAuth integration takes 5 minutes to set up.
- **Apple** — required by App Store Guideline 4.8 for any iOS app that
  uses a third-party or social login (Google alone would get us
  rejected). Apple is a 30-minute setup (Services ID + key generation)
  but non-negotiable if we ever ship an iOS companion app.

GitHub, Microsoft, and Facebook were considered and **deferred to v2** —
no customer has asked for them, and each provider adds an attack surface
that the security team has to review.

## Data this feature shows

| Surface | Field | Source | Format |
|---|---|---|---|
| Login page | "or" divider | hard-coded | text |
| Login page | "Continue with Google" button | env-gated | button |
| Login page | "Continue with Apple" button | env-gated | button |
| Signup page | "or" divider | hard-coded | text |
| Signup page | "Continue with Google" button | env-gated | button |
| Signup page | "Continue with Apple" button | env-gated | button |
| Auth callback | error state from provider | query param | inline error |
| Auth callback | "Account already exists" link flow | query param | redirect to /login |

The two buttons are env-gated — if a provider is not configured, the
button is **hidden** (not shown as "Coming soon"). Reasoning: a "Coming
soon" button implies a roadmap commitment; a hidden button just means
the option isn't available. Admins can flip the env var to enable
without a code change.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Sign in with Google | Click "Continue with Google" on /login | OAuth flow → callback → `next` or `/library` | public |
| Sign up with Google | Click "Continue with Google" on /signup | OAuth flow → callback → `next` or `/library` (no email-verification step — Google already verified the email) | public |
| Sign in with Apple | Click "Continue with Apple" on /login | OAuth flow → callback → `next` or `/library` | public |
| Sign up with Apple | Click "Continue with Apple" on /signup | OAuth flow → callback → `next` or `/library` | public |
| Provider returns an error | Provider error param on callback | Inline error on /login with provider's error message | public |
| Email already exists with different provider | OAuth creates a new identity; user already has password account with same email | Per `auth.email.link_accounts` setting — Supabase auto-links OR shows a "sign in with your password to link" message | public |

## What this feature does NOT do

- No "Sign in with GitHub" / "Microsoft" / "Facebook" in v1 — deferred to v2
- No "Sign in with passkey" / WebAuthn — v2
- No "Sign in with magic link" — v2
- No per-provider branding customization beyond the standard provider
  label (Google's "Continue with Google" + Apple's "Continue with Apple")
- No provider-merge UI in this slice — Supabase's `linkIdentity` flow
  ships separately when the email-conflict UX is built (PH09+)
- No "use the same email to link" prompt when a user signs in with
  Google on an account that already exists with email+password — this is
  configurable at the Supabase level via the `auth.email.link_accounts`
  project setting; the spec records the chosen policy but does not
  change Supabase config (that's a platform-side decision by Klaas)

## Acceptance criteria

### Customer OAuth (this tick — P1.6 Slice 1: /login + Google + Apple)

- [ ] **Spec exists at `01-specs/pages/oauth.md`** with the full design
      contract (this file).
- [ ] New server action `signInWithOAuthAction(formData)` lives in
      `02-features/auth/actions.ts` alongside the other auth actions.
      Input is a hidden `provider` field (one of `'google' | 'apple'`)
      + an optional `next` field.
- [ ] Action is Zod-validated — provider is enum-checked, `next` flows
      through `safeNext()`.
- [ ] Action calls `supabase.auth.signInWithOAuth({ provider, options:
      { redirectTo: <origin>/auth/callback?next=<safeNext or /library> } })`.
- [ ] Action uses `redirect(data.url)` to send the browser to the
      provider's consent screen. The redirect is a `NextResponse.redirect`
      so the browser follows it natively — no client JS required.
- [ ] Action is rate-limited via the existing `checkRateLimit()` helper
      with `kind: 'oauth_signin'`. New LIMITS row:
      `{ perEmail: 5, perIp: 10 }` per 15 min (a real user wouldn't
      click 5+ times in 15 min; the IP ceiling stops an automated
      enrollment-flooding attempt).
- [ ] Rate-limit hits write to `auth_failed_attempts` with
      `reason: 'rate_limited'` and to `admin_audit_log` with
      `action: 'oauth_signin_rate_limited'`.
- [ ] Successful OAuth-init writes one row to `admin_audit_log` with
      `action: 'oauth_signin_initiated'`, hashed IP, truncated UA, the
      provider name. The audit row lets the admin see the volume of
      OAuth attempts.
- [ ] When the provider env var is unset, the corresponding button is
      hidden on /login and /signup. The action rejects the request with
      a generic error if called directly (defense — never expose a
      provider that's not configured).
- [ ] New env vars: `OAUTH_GOOGLE_ENABLED` and `OAUTH_APPLE_ENABLED`
      (boolean). The provider config in Supabase (client ID, secret,
      services ID, key) lives in the Supabase project settings — not in
      our env. The env vars are just the "show the button" toggle.
- [ ] New module `00-foundations/auth/oauth.ts` exposes
      `getOAuthEnabledProviders(): OAuthProvider[]` (pure, env-gated,
      no I/O).
- [ ] New client-free component `02-features/auth/OAuthButtons.tsx`
      (RSC; no client JS) renders the enabled-provider buttons. Each
      button is a real `<form action={signInWithOAuthAction}>` with a
      hidden `provider` field. Server-side, the form posts, the action
      calls Supabase, returns a `redirect()` to the provider URL.
- [ ] `OAuthButtons` is wired into the `SignInForm` (P1.6 Slice 1) with
      an "or" divider between the email form and the buttons. The
      `/signup` form gets the same buttons in P1.6 Slice 2.
- [ ] `SignInForm` accepts an `enabledProviders: OAuthProvider[]` prop
      so the page can pass the env-gated list down. When the list is
      empty, no divider is shown.
- [ ] `app/login/page.tsx` reads `getOAuthEnabledProviders()` and
      passes the list to `<SignInForm>`. The page stays RSC.
- [ ] Both buttons use design tokens only. Apple button uses a
      monogram (Apple logo via inline SVG) on `--bg-1` (white-ish)
      with a 1px `--line` border. Google button uses a monogram
      (Google "G" via inline SVG) on `--bg-1` with the same border.
      Both are full-width secondary CTAs (not the orange primary CTA)
      — the primary CTA is the email-password form below them.
- [ ] The "or" divider uses the existing P0 design — thin line on
      both sides + the word "or" in the middle. Token-only.
- [ ] `?next=` round-trip: the user clicks "Continue with Google" on
      `/login?next=/library?from=sale`, the action embeds `next` in
      the provider's `redirectTo` as `/auth/callback?next=/library?from=sale`,
      the callback exchanges the code, then redirects to
      `/library?from=sale`. Same `safeNext()` guard throughout.
- [ ] On the callback, if Supabase returns an error (e.g. the user
      denied consent on Google's side), the existing
      `/auth/callback/route.ts` redirects to `/login?error=<msg>`. The
      login page renders the error in a `role="alert"` banner.
- [ ] Account linking: when a user signs in with Google using an email
      that's already in `auth.users` (a password account), Supabase's
      `auth.email.link_accounts` setting decides the behavior. The
      spec documents the policy decision (see "Account linking policy"
      below) but does NOT change the Supabase config — that's a
      platform-level decision. STUB-042 documents the follow-up.
- [ ] No new migrations needed for the schema — we extend the
      `auth_failed_attempts.kind` check constraint to include
      `'oauth_signin'`. Migration `0020_auth_failed_attempts_oauth_signin.sql`
      follows the same DO-block pattern as 0018 + 0019.
- [ ] No new dependencies — the Supabase JS client already supports
      `signInWithOAuth()`.
- [ ] No client-side JavaScript shipped — both the buttons and the
      action are pure server. The form's `action={signInWithOAuthAction}`
      attribute triggers a standard browser POST.
- [ ] All 6 checks green: `pnpm typecheck && pnpm lint && pnpm
      check:no-todo && pnpm check:pii && pnpm check:specs && pnpm
      check:rls`.
- [ ] `pnpm build` clean — new route bundles add ≤ 1 KB to first-load
      JS (the buttons are RSC, the action is server-only).

### Customer OAuth (P1.6 Slice 2 — /signup + Apple-specific concerns) [deferred to next tick]

- [ ] Same buttons wired into `SignUpForm` on `/signup`. The "I agree
      to terms" checkbox is NOT required for OAuth signup — Google's
      consent screen is the equivalent acceptance (per the signup
      spec's deferred note).
- [ ] Apple-specific: the `signInWithOAuth({ provider: 'apple' })`
      call passes `options: { queryParams: { ... } }` to capture the
      user's name on the first sign-in (Apple only sends the name on
      the FIRST sign-in, not subsequent). The action reads the
      `user_metadata.name` after the callback and writes it to
      `profiles.display_name` if the profile doesn't already have one.
- [ ] Apple-specific: the user can choose to **hide** their email
      (Apple's "Hide My Email" feature) — the callback receives a
      relay email like `abc123@privaterelay.appleid.com`. The auth
      flow accepts this and links the account under the relay
      address. The PH09 customer-facing display name uses the
      Apple-given name (not the email).

### Account linking policy (cross-cutting)

The Supabase project setting `auth.email.link_accounts` (default
`true`) controls what happens when a user signs in with Google using
an email that already exists as a password account.

- **`true` (default, our v1 choice)**: Supabase auto-links the Google
  identity to the existing account. The user is signed in as the
  existing user; subsequent password sign-ins still work, and
  subsequent Google sign-ins also work.
- **`false`**: Supabase returns an error like "Account already exists
  with this email. Sign in with your password to link." The callback
  would need a custom UI flow (out of scope for P1.6).

**v1 ships with `true` (the default).** STUB-042 documents the
follow-up: if a customer complains about "someone signed in with my
Google account and I didn't expect that", we can flip the setting to
`false` and add a link-confirmation UI in PH09.

### Cross-cutting (always true)

- [ ] All form inputs are keyboard-navigable — the buttons are real
      `<button type="submit">` elements inside `<form>` elements; the
      existing P0.6 focus rings apply.
- [ ] Page renders in < 200ms p95 (RSC + static; the buttons are
      server-rendered, no client JS).
- [ ] No PII leak in URLs — the `next` param is the only query string
      that flows through; no email or name is echoed.
- [ ] No `TODO` / `FIXME` in the diff.

## Design reference

- Mockup: not yet built — the buttons follow the standard Google +
  Apple button patterns (white card, provider wordmark + "Continue
  with [Provider]"). Spec covers the shape; mockup parity is
  verified via the served HTML.
- Components: `Button` from `00-foundations/ui/primitives/Button`
  (existing); the OAuth buttons are bespoke but use the same
  `Button` shape for size/typography.
- Tokens: `--bg-1`, `--line`, `--text-1`, `--font-sans` — all
  existing. No new tokens needed.

## Security

- **Auth required:** no — this IS the auth surface.
- **Allowed roles:** anyone.
- **RLS policies that apply:** n/a (no DB read on the click path; the
  rate-limit helper uses the service-role client).
- **PII displayed:** none on the button itself.
- **PII in URLs:** no.
- **Audit logged:** yes — every OAuth-init writes one row to
  `admin_audit_log` (success path) and one row to
  `auth_failed_attempts` on rate-limit.
- **Rate limiting:** yes — `kind: 'oauth_signin'` with
  `perEmail: 5 / perIp: 10` per 15 min.
- **Open redirect protection:** the `?next=` param is validated by
  `safeNext()` (reused from the email flows).
- **CSRF:** the Supabase OAuth flow includes a `state` parameter that
  the callback verifies. We do NOT need to add anything.
- **Provider credential storage:** the Google client ID + secret +
  Apple Services ID + key live in the Supabase project's
  Authentication → Providers config. They are NOT in our env. Our
  env has only the boolean `OAUTH_GOOGLE_ENABLED` /
  `OAUTH_APPLE_ENABLED` toggles.

## Performance

- **Target p95:** < 200ms (page load) + < 1s (the OAuth roundtrip
  itself is dominated by the provider's consent screen, not our
  action).
- **Render strategy:** RSC + static page. The buttons are pure
  server; the action is server-only.
- **Cache:** static page, cached at edge. The action is dynamic
  (per-request) but tiny (1 Supabase call + 1 redirect).
- **Bundle size budget:** ≤ 1 KB added to client bundle. The
  buttons are RSC, the action is server-only, the form's
  `action={...}` attribute is a server-rendered HTML feature.

## Out of scope for v1

- "Sign in with GitHub" / "Microsoft" / "Facebook" — deferred to v2.
- "Sign in with passkey" / WebAuthn — v2.
- "Sign in with magic link" — v2.
- Per-provider branding customization.
- Provider-merge UI for the `auth.email.link_accounts = false` path.
- "Continue with [Provider]" analytics events — Phase 16 (Gorse
  events).

## Open questions for human

- **Supabase `auth.email.link_accounts` setting**: v1 ships with the
  default `true`. If you want a stricter "user must prove they own
  the email before linking", flip it to `false` in the Supabase
  dashboard and we'll add the link-confirmation UI in a follow-up.
  **Default: `true` (per Supabase default).**
- **Google OAuth credentials**: needs a Google Cloud project with an
  OAuth 2.0 Client ID + Secret, configured in Supabase Authentication
  → Providers → Google with the redirect URI
  `https://<your-supabase-project>.supabase.co/auth/v1/callback`. Klaas
  wires this once. STUB-042 tracks the request.
- **Apple OAuth credentials**: needs an Apple Developer account, a
  Services ID, a Key ID, and the .p8 private key file. Klaas wires
  this once. STUB-042 tracks the request.
- **Provider config in our env**: the env vars are just
  `OAUTH_GOOGLE_ENABLED=true` and `OAUTH_APPLE_ENABLED=true`. The
  credentials themselves live in the Supabase project. STUB-042
  tracks the wiring.

## Implementation notes (filled when shipped)

### P1.6 Slice 1 — this tick

**Files (1 new migration, 2 new feature files, 4 modified):**

- **NEW** `04-platform/migrations/0020_auth_failed_attempts_oauth_signin.sql` —
  extends `auth_failed_attempts.kind` check constraint to include
  `'oauth_signin'`. Same DO-block / pg_constraint scan pattern as
  0018 + 0019. IDEMPOTENT.
- **NEW** `00-foundations/auth/oauth.ts` — `OAuthProvider` union
  type + `getOAuthEnabledProviders()` pure function (reads
  `OAUTH_GOOGLE_ENABLED` + `OAUTH_APPLE_ENABLED` from env). Provider
  metadata: `{ id, label, monogram }` (monogram is a 1-char brand
  glyph for the button).
- **NEW** `02-features/auth/OAuthButtons.tsx` (RSC) +
  `OAuthButtons.module.css` — server component that renders one
  `<form action={signInWithOAuthAction}>` per enabled provider. Each
  form has a hidden `provider` field + an optional `next` field. The
  button is a real `<button type="submit">` with a monogram + label.
  The "or" divider is rendered above the buttons.
- **MODIFIED** `00-foundations/auth/rate-limit.ts` — extends
  `AttemptKind` to include `'oauth_signin'`. New LIMITS row
  `{ perEmail: 5, perIp: 10 }`. New `AUDIT_ACTION_BY_KIND` entry
  `'oauth_signin_rate_limited'`. Existing `signin` / `signup` /
  `reset_password` / `update_password` / `email_verification` keep
  their current values.
- **MODIFIED** `02-features/auth/actions.ts` — adds
  `signInWithOAuthAction(formData)`. Zod-validates
  `{ provider: z.enum(['google', 'apple']), next?: z.string() }`.
  Rate-limit gate (kind: 'oauth_signin'). Audit on success and on
  rate-limit. Calls `supabase.auth.signInWithOAuth(...)` and
  `redirect(data.url)`. Refuses to call a provider that's not in
  `getOAuthEnabledProviders()` (defense — even if someone forges a
  POST).
- **MODIFIED** `02-features/auth/AuthForms.tsx` — `SignInForm`
  accepts a new `enabledProviders` prop. Renders `<OAuthButtons />`
  above the email form (with the "or" divider). Slice 2 will wire
  the same prop into `SignUpForm`.
- **MODIFIED** `app/login/page.tsx` — calls
  `getOAuthEnabledProviders()` and passes the result to
  `<SignInForm>`. Zero client JS.
- **MODIFIED** `00-foundations/env.ts` — adds
  `OAUTH_GOOGLE_ENABLED: z.coerce.boolean().default(false)` +
  `OAUTH_APPLE_ENABLED: z.coerce.boolean().default(false)`. Defaults
  to `false` so a fresh project ships with no OAuth buttons (no
  surprise behavior).
- **MODIFIED** `00-foundations/auth/README.md` — adds the new
  `oauth.ts` entry to the file map (was already documented as
  "OAuth provider configuration (Google in v1)" but the file didn't
  exist until this tick — closes the gap).
- **MODIFIED** `01-specs/pages/login.md` — moves the "P1.6 — OAuth"
  deferred items into the "Customer login (this tick — P1.6)"
  section as "delivered"; updates the "Deferred to other phases"
  section.
- **MODIFIED** `01-specs/pages/signup.md` — same migration for
  signup's deferred items. The "P1.6 — Continue with Google does
  NOT require I agree to terms" item stays in the deferred list
  because Slice 2 (the /signup wiring) hasn't shipped yet.
- **MODIFIED** `.env.example` — adds the two new env vars with a
  short comment explaining they're display-toggles (the credentials
  live in Supabase).
- **MODIFIED** `STUBS.md` — adds **STUB-042** documenting the
  Google + Apple provider credentials that Klaas needs to wire in
  the Supabase project. The buttons are code-complete; they ship
  the moment the env vars flip to `true` and the Supabase project
  has the providers configured.
- **MODIFIED** `docs/PROGRESS.md` — P1.6 box ticked, note appended.
