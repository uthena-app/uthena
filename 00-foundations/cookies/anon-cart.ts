// anon-cart.ts — HMAC-SHA256-signed cookie-backed anonymous cart (P4.2).
//
// Why a cookie (not localStorage):
// - Spec §Security calls for an HTTP-only signed cookie (1-week TTL,
//   HMAC-signed). Cookies survive across tabs, are invisible to JS
//   (smaller XSS surface), and the server can read them on every
//   RSC render + every server action call. localStorage is reachable
//   by any script and would force every read through a round-trip
//   to /api/cart, which the CartDrawer (P4.1) already does for
//   refresh but doesn't have to do for the page render.
//
// Cookie shape: `<base64url(json)>.<base64url(hmac-sha256(secret, payload))>`
//   - `base64url` keeps the cookie URL-safe (no `=` padding).
//   - HMAC-SHA256 with `timingSafeEqual` defends against timing
//     attacks on signature comparison.
//   - The secret is `process.env.ANON_CART_SECRET` in production
//     (rotated by Doppler) and falls back to a stable per-process
//     value in dev so cross-request signing works on a single
//     machine.
//
// Payload shape (short keys to keep the cookie < 1 KB for 50 lines):
//   {
//     v: 1,                    // schema version — bump on breaking change
//     c: <ISO created_at>,     // when this cookie cart was first created
//     lines: [
//       { p: <product_id>, l: <license>, q: <quantity>, a: <ISO added_at> },
//       ...
//     ]
//   }
//
// Price is NOT stored. We re-fetch live from `product_pricing` on
// every render — matches the auth cart's "join live against pricing"
// pattern, so a price change between add-to-cart and checkout
// reflects. Storing prices in a signed cookie would create a
// mismatch with the live DB and is one more surface to harden.
//
// Trust boundary: the cookie is signed but NOT encrypted (anon
// visitors don't expect privacy here — they added items themselves
// and can see them in their browser). HMAC only prevents tampering.
// If we ever need privacy, wrap the JSON in JWE before HMAC — out
// of scope for P4.2.

import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { z } from 'zod'

/** Cookie name. Stable string — never change without a migration. */
export const ANON_CART_COOKIE = 'uthena_anon_cart'

/** Cookie TTL — 30 days. Matches the auth cart's 30-day idle
 *  expiry window (P4.3): cart_items rows flip to status='expired'
 *  after 30 days of inactivity, and the anon cookie lives the same
 *  30 days before it disappears from the browser. Every cart
 *  mutation rewrites the cookie with a fresh `maxAge`, so the
 *  window slides — adding an item today resets the 30-day clock.
 *
 *  Spec called for 1 week (PH06 v1) but the cron-driven 30-day
 *  auth window is the policy; matching it keeps the warning UI
 *  honest for both branches. */
export const ANON_CART_TTL_DAYS = 30
export const ANON_CART_TTL_SECONDS = ANON_CART_TTL_DAYS * 24 * 60 * 60

/** Hard cap on lines per anon cart. Defensive against cookie-bomb
 *  attacks (a 4 KB cookie limit means anything > ~50 lines of
 *  compact JSON triggers a write failure). The cap is enforced
 *  before write + on parse. */
export const ANON_CART_MAX_LINES = 50

/** License enum — same shape as the auth `cart_items.license` column. */
export const ANON_LICENSES = ['plr', 'mrr', 'rr', 'personal'] as const
export type AnonLicense = (typeof ANON_LICENSES)[number]

/** Compact JSON shape (short keys). */
export type AnonCartLine = {
  /** product id (positive int) */
  p: number
  /** license tier */
  l: AnonLicense
  /** quantity (1..99) */
  q: number
  /** ISO added_at timestamp */
  a: string
}

export type AnonCart = {
  /** Schema version. Bump on breaking change. */
  v: 1
  /** ISO created_at — when this cookie cart was first created. */
  c: string
  /** Lines, in add order. */
  lines: AnonCartLine[]
}

/** Empty cart singleton — the canonical "nothing in cart" value. */
export const EMPTY_ANON_CART: AnonCart = Object.freeze({
  v: 1,
  c: '',
  lines: [],
}) as AnonCart

/**
 * Zod schema for the cookie payload. Used by `deserializeAnonCart`
 * to validate the parsed JSON before handing it back to callers.
 * Defends against a corrupted cookie (truncated payload, future
 * schema version, line with bad license) from leaking into the
 * `getCart()` query path.
 */
const AnonCartLineSchema = z.object({
  p: z.number().int().positive(),
  l: z.enum(ANON_LICENSES),
  q: z.number().int().min(1).max(99),
  a: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'added_at must be a valid ISO date',
  }),
})

const AnonCartSchema = z.object({
  v: z.literal(1),
  c: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'created_at must be a valid ISO date',
  }),
  lines: z.array(AnonCartLineSchema).max(ANON_CART_MAX_LINES),
})

/**
 * Return the HMAC secret. In production this comes from
 * `ANON_CART_SECRET` (Doppler). In dev we fall back to a stable
 * per-process value so cross-request signing works on a single
 * machine — the value is per-PID so two devs on the same host
 * never see each other's carts.
 *
 * The secret MUST be 32+ random bytes in production. We don't
 * enforce length here (the env is set by the operator); we just
 * need a non-empty string. HMAC-SHA256 with any non-empty secret
 * is safe against forgery as long as the secret is not public.
 */
function getSecret(): string {
  return process.env.ANON_CART_SECRET ?? `dev-anon-cart-${process.pid}`
}

/** Compute the HMAC-SHA256 signature for a base64url-encoded payload. */
function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

/** Constant-time signature compare. Returns false on length mismatch
 *  (without short-circuiting on the first byte difference). */
function verifySignature(payload: string, signature: string): boolean {
  try {
    const expected = Buffer.from(sign(payload), 'base64url')
    const actual = Buffer.from(signature, 'base64url')
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/** Serialize an AnonCart to the on-the-wire cookie string. */
export function serializeAnonCart(cart: AnonCart): string {
  const json = JSON.stringify(cart)
  const payload = Buffer.from(json, 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Parse + verify a cookie string. Returns null on any failure
 *  (missing cookie, malformed, bad signature, schema mismatch).
 *  Callers should treat null as "no anon cart" — the page renders
 *  the empty state, the action refuses the mutation with a typed
 *  error. We never throw from this function. */
export function deserializeAnonCart(raw: string | undefined | null): AnonCart | null {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot < 0 || dot === raw.length - 1) return null
  const payload = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)
  if (!verifySignature(payload, signature)) return null
  let json: string
  try {
    json = Buffer.from(payload, 'base64url').toString('utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  const result = AnonCartSchema.safeParse(parsed)
  if (!result.success) return null
  return result.data
}

/** Read the anon cart from the request cookie. Returns null if no
 *  cookie / signature invalid / schema invalid. Async because
 *  Next.js 15's `cookies()` returns a Promise. */
export async function readAnonCart(): Promise<AnonCart | null> {
  const store = await cookies()
  const raw = store.get(ANON_CART_COOKIE)?.value
  return deserializeAnonCart(raw)
}

/** Write the anon cart to the response cookie. HttpOnly + SameSite=Lax
 *  + 30d TTL. `Secure` in production so the cookie is never sent over
 *  plain HTTP. */
export async function writeAnonCart(cart: AnonCart): Promise<void> {
  const store = await cookies()
  store.set({
    name: ANON_CART_COOKIE,
    value: serializeAnonCart(cart),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ANON_CART_TTL_SECONDS,
  })
}

/** Delete the anon cart cookie. Used by the auth flow on successful
 *  signup / signin after the anon cart has been merged into the
 *  user's auth cart. */
export async function clearAnonCart(): Promise<void> {
  const store = await cookies()
  store.set({
    name: ANON_CART_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}

// ---------------------------------------------------------------------------
// Line addressing — anon-cookie lines don't have a DB `cart_items.id`, so
// we synthesize an opaque string id that round-trips through the cart
// surface (CartDrawer remove button, /cart page row). The prefix lets
// the action layer route to either the DB or the cookie.
// ---------------------------------------------------------------------------

const ANON_LINE_PREFIX = 'anon:'

/** Synthesize a stable opaque string id for an anon-cookie line.
 *  Format: `anon:<product_id>:<license>`. The drawer uses this as the
 *  `line.id`; the remove action parses it back via `parseAnonLineId`. */
export function anonLineId(productId: number, license: AnonLicense): string {
  return `${ANON_LINE_PREFIX}${productId}:${license}`
}

/** Parse an opaque line id back into the anon-cookie reference.
 *  Returns null if the id is not an anon-cookie reference (i.e. is
 *  an auth-DB bigint or a malformed string). */
export function parseAnonLineId(
  id: string | number,
): { productId: number; license: AnonLicense } | null {
  if (typeof id !== 'string') return null
  if (!id.startsWith(ANON_LINE_PREFIX)) return null
  const rest = id.slice(ANON_LINE_PREFIX.length)
  const idx = rest.indexOf(':')
  if (idx < 0) return null
  const productIdStr = rest.slice(0, idx)
  const licenseStr = rest.slice(idx + 1)
  const productId = Number(productIdStr)
  if (!Number.isInteger(productId) || productId < 1) return null
  if (!(ANON_LICENSES as readonly string[]).includes(licenseStr)) return null
  return { productId, license: licenseStr as AnonLicense }
}

/** Type guard for the prefix. Use when you need to branch on
 *  "is this an anon-cookie reference vs an auth-DB id" without
 *  parsing the rest of the id. */
export function isAnonLineId(id: string | number): id is string {
  return typeof id === 'string' && id.startsWith(ANON_LINE_PREFIX)
}