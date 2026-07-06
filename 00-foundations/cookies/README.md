# 00-foundations/cookies/

Shared cookie helpers. The server-side cookie pattern in this repo uses Next.js's `cookies()` from `next/headers`, which is request-scoped (reads in server components + server actions, writes in server actions + route handlers).

## Files

- **`anon-cart.ts`** — HMAC-SHA256-signed anonymous cart cookie (P4.2). `AnonCart` type + `readAnonCart()` / `writeAnonCart()` / `clearAnonCart()` + `anonLineId()` / `parseAnonLineId()` / `isAnonLineId()` helpers. Pure cookie path is one HTTP-only + SameSite=Lax cookie, 14-day TTL, ~1 KB max payload, ~50-line cap. Live pricing is re-fetched on every render via `02-features/cart/queries/resolveAnonCart.ts` — the cookie carries `(product_id, license, qty, added_at)` only, never prices.
- **`anon-cart.test.ts`** — unit tests for the cookie module: round-trip, tampered signature / payload, wrong version, bad license, qty out of range, > max lines, anon line id parse round-trip + every failure case.

## Why a cookie (not localStorage)

The cart spec §Security calls for an HTTP-only signed cookie. Cookies survive across tabs, are invisible to JS (smaller XSS surface), and the server can read them on every RSC render + every server action call — no round-trip to `/api/cart` for the page render. localStorage is reachable by any script and would force every read through the client → server boundary.

## Cookie shape

```
<base64url(json)>.<base64url(hmac-sha256(secret, payload))>
```

- `base64url` keeps the cookie URL-safe (no `=` padding).
- HMAC-SHA256 with `timingSafeEqual` defends against timing attacks.
- Secret: `process.env.ANON_CART_SECRET` in production (Doppler, 32+ random bytes). In dev it falls back to a stable per-process value so cross-request signing works on a single machine.

## Schema

```ts
type AnonCartLine = {
  p: number          // product_id
  l: 'plr'|'mrr'|'rr'|'personal'
  q: number          // quantity, 1..99
  a: string          // ISO added_at
}

type AnonCart = {
  v: 1               // schema version — bump on breaking change
  c: string          // ISO created_at
  lines: AnonCartLine[]
}
```

Short keys keep the cookie under 1 KB for 50 lines. The cap is enforced on write AND on parse (Zod schema in `deserializeAnonCart`).

## Adding a new signed cookie

Use the same shape as `anon-cart.ts`:

1. Define a Zod schema (the parser is the contract — anything outside the schema is rejected as null).
2. Implement `serializeX(raw)` + `deserializeX(serialized)` as pure functions (no `cookies()`).
3. Add the `readX()` / `writeX()` / `clearX()` async wrappers using `cookies()` from `next/headers`.
4. Set `httpOnly: true`, `sameSite: 'lax'`, `secure: NODE_ENV === 'production'`, `path: '/'`.
5. Add the env var to `00-foundations/env.ts` if it requires one (e.g. `process.env.X_SECRET`).
6. Unit tests covering: round-trip, tampered signature, tampered payload, schema rejection (bad version, bad enum, out-of-range), and a `clearX()` lifecycle check (cookie is removed from the response headers).

Don't ship a signed cookie without the parse-time schema validation. The HMAC only prevents tampering; the schema prevents a corrupted cookie from leaking into the rest of the app.

## Defense in depth

The cookie is **signed but NOT encrypted**. Anon visitors don't expect privacy here — they added the items themselves and can see them in their browser. HMAC only prevents tampering. If we ever need privacy (e.g. for a saved-search cookie), wrap the JSON in JWE before HMAC — out of scope for P4.2.

## Testing

Run from the repo root:

```bash
pnpm test anon-cart       # just the anon-cart cookie tests
pnpm test cookies         # all cookie module tests
```

The cookie module is pure logic — no DB, no network. The Next.js `cookies()` API is exercised by the integration tests in `02-features/cart/tests/` (deferred to a later tick when the test DB is wired).