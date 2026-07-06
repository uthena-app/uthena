# 00-foundations/auth/

Auth, sessions, and role-based access control. Every page that needs auth uses the helpers from this folder.

## Files

- **`guards.ts`** — server-side guards. `getSessionUser()` (returns null for anon), `requireUser(returnTo?)` (redirects to `/login` if anon), `requireRole(allowed, returnTo?)` (redirects to `/login` if anon or `/403` if wrong role), `requireAdmin()`, `requirePartner()`, `requireAffiliate()`, `requireSelfOrAdmin(resourceUserId, returnTo?)`. The `returnTo` parameter is run through `safeNext()` so the redirect target can't be open-redirect-hijacked. See the JSDoc on each helper for the precise contract. Unit tests live in `guards.test.ts` (P2.1).
- **`safe-next.ts`** — pure open-redirect guard. `safeNext(raw)` returns a sanitized relative path or null. Rules: must start with `/`, must NOT start with `//`, must NOT contain `\`, must NOT be `/:something://`, must NOT contain `%2f%2f`. Lifted here from `02-features/auth/redirect.ts` in P2.1 — it's used by 6+ callers across the codebase and the guards layer shouldn't depend on a feature. Unit tests live in `safe-next.test.ts`.
- **`oauth.ts`** — OAuth provider configuration (P1.6 — Google + Apple). Exposes `getOAuthEnabledProviders()` (env-gated list) and `isOAuthProviderEnabled(id)`. The provider credentials (client ID + secret) live in the Supabase project, NOT in this env.
- **`rate-limit.ts`** — per-IP and per-email rate limiting for auth events. DB-backed (Supabase `auth_failed_attempts` table), 15-min sliding window. Covers signin / signup / reset_password / update_password / email_verification / oauth_signin.
- **`reserved-handles.ts`** — the canonical list of handles that may NOT be chosen by an affiliate onboarding wizard, plus the shape-validation helpers (P13.1). The list is a frozen `ReadonlySet<string>`; the DB has the reactive uniqueness (`handle_reservations` PRIMARY KEY + `affiliates.handle` UNIQUE), this module is the proactive block for names that would collide with app routes or brand surfaces. Exports `HANDLE_REGEX` + `HANDLE_MIN_LENGTH` + `HANDLE_MAX_LENGTH` (the wizard's accept rule), `RESERVED_HANDLES` (the Set), `normalizeHandle(raw)` (lowercase + trim), `isReservedHandle(raw)` + `isValidHandleShape(raw)` (predicates), and `validateHandle(raw)` (combined shape + reserved with a typed reason). Unit tests live in `reserved-handles.test.ts`.

## guards.ts — the access control primitives

```ts
const user = await requireUser('/library');     // redirects to /login if anon
const partner = await requirePartner();          // redirects to /login or /403
const admin = await requireAdmin();              // redirects to /login or /403
const affil = await requireAffiliate();          // redirects to /login or /403
const order = await requireSelfOrAdmin(order.user_id); // self OR admin/super_admin
const maybeUser = await getSessionUser();        // null if anon — never throws
```

When a guard fails, it calls `redirect()` from `next/navigation`. That throws a `NEXT_REDIRECT` error internally which Next.js converts to an HTTP 307. Code after the guard is unreachable; TypeScript knows because `redirect()` is typed `never`.

`requireRole(['admin', 'super_admin'])` is the source of truth for "who can do X." The shorthand helpers (`requireAdmin`, `requirePartner`, `requireAffiliate`) are thin wrappers for the common cases; use the explicit `requireRole()` for everything else (e.g. super-admin-only routes).

## getSessionUser — the only way to know who's logged in

```ts
// Server Component (RSC) — branch on null for anon vs. logged-in
const user = await getSessionUser()
const greeting = user ? `Hello, ${user.display_name}` : 'Hello, guest'

// Server Action — never use supabase.auth.getUser() directly,
// always go through this helper
const user = await getSessionUser()
if (!user) return { error: 'Not signed in' }
```

**Never** read `auth.users` directly. **Never** use `supabase.auth.getUser()` in a component or action. Always go through `getSessionUser()`.

## safe-next.ts — defeating open-redirect attacks

```ts
safeNext('/library?from=sale')     // '/library?from=sale'  (passed through)
safeNext('https://evil.com')        // null                    (rejected — absolute)
safeNext('//evil.com')              // null                    (rejected — protocol-relative)
safeNext('/javascript:alert(1)')    // null                    (rejected — fake scheme)
safeNext('/%2f%2fevil.com')         // null                    (rejected — encoded bypass)
safeNext('/\\evil.com')             // null                    (rejected — backslash trick)
```

Used by every redirect target that takes user input — login `?next=`, signup `?next=`, reset-password `?next=`, OAuth callback `?next=`, AND `requireUser(returnTo)` / `requireRole(returnTo)` / `requireSelfOrAdmin(returnTo)`. Defending the guard layer closes the open-redirect vector in every gated route, not just the auth flow pages.

## Testing

The auth guards and `safeNext` are unit-tested with vitest (P2.1). Run:

```bash
pnpm test                  # all unit tests
pnpm test guards           # just the guard tests
pnpm test safe-next        # just the safeNext tests
```

Tests mock `next/navigation` (so `redirect()` is observable) and `@foundations/data/supabase` (so `getServerSupabase()` returns a controllable fake client). No real DB or network calls — these are pure logic tests that run in milliseconds.

## Adding a new auth flow

If you need a new auth-related behavior (e.g. magic link login in v2, 2FA, passwordless), the implementation goes in `00-foundations/auth/`. Add a new file, document it in this README, and add the corresponding unit test next to it.

Don't add magic strings, hardcoded URLs, or token secrets to components. All auth state lives in this folder.
