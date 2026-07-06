# Auth callback — `/auth/callback`

## What this page does

This is a **route handler**, not a user-facing page. It is the OAuth callback endpoint that Supabase Auth redirects to after a third-party identity provider (Google) completes its handshake. The route receives an authorization `code` in the query string, exchanges it for a Supabase session via `exchangeCodeForSession`, and then redirects the user to `?next=` (if valid) or `/library`.

Per Supabase Auth's documented flow, the callback is a server-side handler (`route.ts`) that runs in the Next.js request lifecycle. The user never sees this page; they only see the final destination after the redirect.

If the exchange fails (invalid code, expired code, provider error), the user is redirected to `/login?error=oauth_failed` — never to a page that reveals internal state. We log the failure (aggregate metrics, not individual events) and rate-limit by IP to prevent abuse.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| (none) | This route does not render a page. It performs a side effect (session exchange + redirect) and returns a 302 response. | — | — |

**Route handler:** `03-app/auth/callback/route.ts`. Receives `GET /auth/callback?code=<oauth_code>&next=<path>`, calls `supabase.auth.exchangeCodeForSession(code)`, then returns a 302 to `next` or `/library`.

**Why a route handler, not a page:** Supabase Auth's OAuth flow expects the redirect URI to be a server endpoint that completes the PKCE/code exchange before any HTML is rendered. A page component would not complete the exchange reliably (RSC streaming, hydration, etc.). A route handler is the documented pattern.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| OAuth code exchange (server-side) | OAuth provider redirects browser to `/auth/callback?code=...` | Server calls `exchangeCodeForSession(code)`, sets session cookies, redirects 302 to `?next=` (validated) or `/library` | any (the OAuth `code` is the credential) |
| Error fallback | OAuth provider redirects to `/auth/callback?error=...` OR `exchangeCodeForSession` throws | Redirect 302 to `/login?error=oauth_failed` | any |

## What this page does NOT do

- Does not render HTML (it's a route handler)
- Does not call any DB code beyond the Supabase Auth client (no `profiles` insert here — that's handled by the post-signup flow in `/signup` or by a DB trigger)
- Does not accept POST (OAuth uses GET, per the spec)
- Does not log every successful OAuth login to `admin_audit_log` (volume) — we log aggregate metrics and flag suspicious patterns (e.g., a single IP completing 50+ OAuth flows in 1 hour)
- Does not link accounts across providers (Supabase does this when the email matches; we don't add custom linking)
- Does not handle the email-verification link (that's `/verify-email`, a separate route)
- Does not handle the password-reset link (that's `/update-password`, a separate route)

## Acceptance criteria

- [ ] Route exists at `GET /auth/callback`
- [ ] On valid `code`: calls `exchangeCodeForSession`, sets HttpOnly+Secure+SameSite=Lax session cookies, redirects 302 to `?next=` (validated) or `/library`
- [ ] On missing `code`: redirects 302 to `/login?error=oauth_failed`
- [ ] On `exchangeCodeForSession` throwing: redirects 302 to `/login?error=oauth_failed`, logs the error
- [ ] On provider returning `?error=...`: redirects 302 to `/login?error=oauth_failed` (does not echo the provider's error message — it can leak state)
- [ ] `?next=` validation: must be a relative path starting with `/` and NOT `//` (open redirect protection, same rules as `/login`)
- [ ] If `?next=` is invalid or external, fall back to `/library`
- [ ] Rate limit: max 20 callback hits per IP per 5 minutes (prevents code-guessing and replay)
- [ ] Rate limit: max 100 callback hits per IP per hour (hard ceiling)
- [ ] Rate limit events are logged to `admin_audit_log` (action='oauth_callback_rate_limited')
- [ ] Suspicious pattern detection: if an IP completes > 5 successful OAuth flows in 10 minutes, log a warning (action='oauth_suspicious_activity') — admin reviews in the morning
- [ ] The `code` is single-use — if Supabase Auth returns "code already used", we redirect to `/login?error=oauth_failed` (this is a replay attempt)
- [ ] On success, the session cookie's `Max-Age` is set per Supabase Auth's refresh-token lifetime (30 days in v1)
- [ ] Aggregate metrics: daily count of successful OAuth logins, broken down by provider, are recorded (Prometheus counter or equivalent)
- [ ] Integration test: valid code → 302 to expected next
- [ ] Integration test: invalid code → 302 to /login?error=oauth_failed
- [ ] Integration test: external `?next=https://evil.com` → 302 to /library (open redirect)
- [ ] Integration test: `?next=//evil.com` → 302 to /library
- [ ] Integration test: rate limit triggers after 20 hits
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: N/A — this is a route handler, not a user-facing page
- Components: N/A

## Security

- **Auth required:** no at the route level — the OAuth `code` is the credential. The route establishes the auth, it does not check for it.
- **Allowed roles:** anyone with a valid (or invalid) `code` — the failure path is the same as the success path
- **RLS policies that apply:** n/a — no app-layer DB access. The Supabase Auth client handles user creation/lookup.
- **PII displayed:** no — this route returns a 302, not a page
- **PII in URLs:** the `code` is in the query string temporarily. It is single-use and short-lived (~5 min). We do not log the `code` itself anywhere.
- **Audit logged:** see acceptance criteria. We log:
  - rate-limit hits (action='oauth_callback_rate_limited', with hashed IP)
  - suspicious patterns (action='oauth_suspicious_activity', with hashed IP and counts)
  - aggregate metrics (daily counters, not row-level)
  - **NOT** every successful login (would create excessive volume; we trust Supabase Auth's own audit logs for the row-level record)
- **Rate limiting:** see acceptance criteria
- **Open redirect protection:** `?next=` is validated identically to `/login` — relative paths only, no `//`, fallback to `/library`
- **CSRF:** Supabase Auth's OAuth flow includes a `state` parameter that we validate before exchanging the code. The `state` is a one-time nonce tied to the user-agent.
- **Code replay protection:** Supabase Auth invalidates the `code` after first use. We handle "code already used" by redirecting to `/login?error=oauth_failed` and logging a warning.
- **Session security:** HttpOnly + Secure + SameSite=Lax cookies, set by Supabase Auth's client. The session is rotated on each successful OAuth flow.
- **Provider error leakage:** we never echo the provider's `?error=` value to the user or to our logs (the provider's error message can contain sensitive state)
- **Third-party scripts:** none on this route — it's a server-side handler, no client-side JS runs

## Performance

- **Target p95:** < 500ms (page load, includes `exchangeCodeForSession` roundtrip + redirect)
- **Render strategy:** route handler (no render)
- **Cache:** never cached
- **Bundle size budget:** N/A (no client bundle)

## Out of scope for v1

- Account linking UI when the same email is used across providers (Supabase handles silently; v2 may add a "link your Google account" prompt)
- Logging every successful OAuth login to `admin_audit_log` (volume; deferred until a real need is identified)
- Captcha on the callback (the rate limit is the primary defense)
- A "remember this device" cookie after OAuth
- Step-up auth (e.g., re-verify for sensitive actions) — v2

## Open questions for human

- **Suspicious pattern threshold:** I proposed > 5 successful OAuth flows per IP per 10 minutes. This is conservative; legitimate users on a shared corporate IP could trip it. My recommendation: start with 5/10min, tune based on telemetry after 30 days. Confirm or adjust.
- **Should we log every successful OAuth login to `admin_audit_log` after all?** I lean no (volume), but if security review later requires a full audit trail, we can add it. The data is already in Supabase Auth's audit logs (we just don't surface it in our admin UI). Confirm no for v1.
- **Provider error messages:** should we store the raw provider error in our logs (for debugging) but only show a generic "Sign-in failed" to the user? My recommendation: yes — log the raw error server-side, show a generic message to the user. This gives us debuggability without leaking state. Confirm.
- **Code lifetime:** Supabase Auth's default OAuth code lifetime is 5 minutes. Some providers (Apple) have shorter lifetimes. Should we configure a longer lifetime for our app? My recommendation: keep the default (5 min) for security. Confirm.

---

## Implementation notes

- **2026-06-25 (P1.9)** — Production-grade callback shipped. The pre-P1.9 handler was a 38-line placeholder that (a) had no rate limiting, (b) echoed Supabase error messages to the user, (c) defaulted to `/account` instead of `/library`, and (d) used a custom URL-parsing open-redirect guard instead of the canonical `safeNext()` helper. The P1.9 rewrite replaces it with:
  - **Migration 0022** — extends `auth_failed_attempts.kind` to include `'oauth_callback'` AND `auth_failed_attempts.reason` to include `'success'` (so the suspicious-pattern detector can count successful flows). Two DO blocks, same defensive pg_constraint scan pattern as 0018 / 0019 / 0020. IDEMPOTENT.
  - **`02-features/auth/callbackRateLimit.ts`** — new helper module (NOT in `00-foundations/auth/rate-limit.ts` because the callback needs two windows and records both successes and failures). Public surface: `recordCallbackHit()`, `checkCallbackRateLimit()`, `countRecentCallbackSuccesses()`, `auditCallbackEvent()`. Fails open on any DB error.
  - **`app/auth/callback/route.ts`** — rewritten with seven ordered steps: (1) per-IP rate-limit gate → (2) provider error suppression → (3) no-code redirect → (4) `exchangeCodeForSession` → (5) record success row → (6) suspicious-pattern detection → (7) `safeNext()` + redirect. Failure cases all redirect to `/login?error=oauth_failed&next=<safe>` — the user's intended destination is preserved across the failure. The `error_description` from the provider is logged raw server-side but NEVER echoed to the user (per spec §Security "Provider error leakage"). The `code` length is clamped to 2000 chars defensive (a 100KB code is almost certainly malicious).
  - **`app/login/page.tsx`** — added `oauth_failed` to `OAUTH_ERROR_MESSAGES` with friendly copy: "We couldn't complete sign-in. Please try again." Covers all five failure modes (rate-limited / provider error / exchange failed / no code / replay).
  - **Aggregate metric** — the spec asks for a daily count of successful OAuth logins by provider. Rather than adding a Prometheus dependency (deferred to PH18), the success row in `auth_failed_attempts` doubles as the aggregate. Admins run `SELECT date_trunc('day', created_at), count(*) FROM auth_failed_attempts WHERE kind='oauth_callback' AND reason='success' GROUP BY 1` to recover the metric. (No code change required — the row is already there.) Provider breakdown by code/identity is a future enhancement when we wire PostHog.
  - **CSRF state** — Supabase's PKCE flow validates the `state` parameter internally; invalid state surfaces as an `exchangeCodeForSession` error which we treat as `invalid_code`. No explicit state validation needed in the route handler.
  - **Defensive clamps** — `next` length capped at 2000 chars; the rate-limit window verifies both 5min and 1h per spec; no PII is logged (only hashed IP via the same `AUDIT_HASH_SALT` pattern the rest of the auth helpers use).
  - **Files touched:** `04-platform/migrations/0022_auth_failed_attempts_oauth_callback.sql` (new), `02-features/auth/callbackRateLimit.ts` (new), `app/auth/callback/route.ts` (rewrite), `app/login/page.tsx` (1 entry in OAUTH_ERROR_MESSAGES), `02-features/auth/README.md` (P1.9 section).
  - **FLAGGED CHANGES:** none — the only existing file modified is the callback route (which was a placeholder) and the login page (one new entry in an existing map).
