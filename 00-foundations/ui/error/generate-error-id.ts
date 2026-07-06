// generateErrorId — the opaque ERR-{id} reference shown on every
// error boundary (app/error.tsx, app/global-error.tsx, and per-route
// error.tsx files). The id is human-quotable support correlation key
// — it does NOT carry PII, and is intentionally NOT the Sentry event
// id (which is 32-char hex and could be confused with user_id).
//
// Per error-500.md §Security:
//   - 10-char base-32 string (32^10 ≈ 1.1e15 IDs → negligible collision
//     probability at any plausible error volume)
//   - Alphabet excludes `0`, `1`, `I`, `O` for human-readability when
//     quoted by phone or in a support ticket
//   - Uses Web Crypto when available (modern browsers + Node 19+ +
//     Cloudflare Workers); falls back to Math.random() so the page
//     still renders on legacy runtimes — the ID is opaque either way,
//     but the crypto path is preferred
//
// The shape `ERR-{id}` is what the user sees on screen and in the
// mailto subject. Keep it stable across error boundaries so support
// staff only need to learn one format.

// Base-32 alphabet without `0`, `1`, `I`, `O`. Same alphabet as the
// spec (error-500.md §Security) — 32^10 ≈ 1.1e15 possible IDs.
export const ERR_ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Length of the random suffix on ERR-{id}. 10 chars per the spec. */
export const ERR_ID_LENGTH = 10

/** Generate a 10-char base-32 error ID. Uses Web Crypto when available;
 *  falls back to Math.random for old runtimes (the ID is opaque anyway,
 *  but the crypto path is preferred — collision resistance is better
 *  than what Math.random provides). */
export function generateErrorId(): string {
  const bytes = new Uint8Array(ERR_ID_LENGTH)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let id = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0
    id += ERR_ID_ALPHABET[b % ERR_ID_ALPHABET.length]
  }
  return id
}

/** Build the full `ERR-{id}` reference shown to the user. Memoize the
 *  result via `useState` initializer at the call site so the ID is
 *  stable across retries (re-mounting the boundary would otherwise
 *  show a different ID for the same error). */
export function makeErrorReference(): string {
  return `ERR-${generateErrorId()}`
}