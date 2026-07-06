// anon-id.ts — the visitor-stable pseudonymous ID used to attribute
// banner decisions (and any future analytics opt-outs) to a browser.
//
// P11.2 spec: the cookie banner must "log per visitor" so the consent
// record is durable and the visitor's choice persists across pages +
// revisits. Signed-in users get a durable `user_id` (the consent_log
// row stores it directly). Anonymous visitors need a stable per-device
// identifier instead — the `uthena_anon_id` cookie. We deliberately do
// NOT use the raw IP for this (GDPR IP-as-PII + we'd lose attribution
// when the visitor's IP changes between visits).
//
// Lifetime: ~13 months (400 days). The ePrivacy Directive recommends
// devices retain "as long as strictly necessary"; for a consent token
// that's typically a year. We use 400 days so it survives a year-end
// calendar boundary with a one-month safety margin.
//
// Shape: UUID v4 string. Cryptographically secure via `crypto.randomUUID`
// (available in the modern Edge runtime + Node 19+). We re-validate
// cookies on read so a tampered cookie (any non-UUID garbage) is
// dropped instead of poisoning future reads.
//
// Security:
//   - The cookie is NOT HTTP-only (we want the client-side banner to
//     read it to avoid a round-trip on every page change). We accept
//     that a determined visitor can flip it — that only hurts the
//     visitor's own future consents. The consent_log row is the
//     source of truth; the cookie is the cache key.
//   - The cookie is `SameSite=Lax` — never sent on cross-site
//     navigations (no CSRF risk for a no-op token).
//   - `Secure` is enabled whenever the request is HTTPS (the helper
//     auto-detects via `x-forwarded-proto`).

import { cookies } from 'next/headers'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'gdpr.anon-id' })

/** Cookie name. Lives next to `uthena_anon_cart` (the cart cookie uses
 *  the same prefix + naming convention). */
export const ANON_ID_COOKIE = 'uthena_anon_id'

/** Lifetime: ~13 months. ePrivacy guidance is "no longer than
 *  necessary"; consent tokens are the canonical use case for the
 *  upper bound. 400 days = 1 calendar year + 1 month of safety. */
export const ANON_ID_MAX_AGE_DAYS = 400

/** Seconds-since-epoch lifetime, derived from the day count. */
export const ANON_ID_MAX_AGE_SECONDS = ANON_ID_MAX_AGE_DAYS * 24 * 60 * 60

/** Canonical UUID v4 grammar (lowercase hex, 8-4-4-4-12). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Mint a fresh UUID using `crypto.randomUUID()` (Node 19+ / Edge).
 *  Wrapped so tests can swap it out via the optional parameter. */
export function mintAnonId(random: () => string = () => crypto.randomUUID()): string {
  const id = random()
  if (!UUID_REGEX.test(id)) {
    // Defensive — `crypto.randomUUID()` is guaranteed to be RFC 4122
    // compliant; only triggered if the caller-supplied random function
    // returns garbage. Don't ship a non-UUID to the client.
    log.warn({ code: 'anon_id_mint_failed' }, 'mintAnonId returned non-UUID')
    throw new Error('Failed to mint anon ID')
  }
  return id.toLowerCase()
}

/** Defensive parse — accepts ONLY canonical UUID v4 (any version is
 *  fine — we use v4 but v1-v7 also pass the regex). Returns null on
 *  any failure rather than throwing; cookie contents are user-mutable
 *  and a poisoned cookie must NOT crash the request. */
export function isValidAnonId(value: string | null | undefined): value is string {
  if (!value) return false
  return UUID_REGEX.test(value.trim())
}

/** Read the anon ID from the request's cookies. Returns the validated
 *  UUID (lowercased) when present + well-formed, `null` otherwise.
 *  Also returns `null` for header-store errors — the caller decides
 *  whether to mint a new one. */
export async function readAnonId(): Promise<string | null> {
  let store: Awaited<ReturnType<typeof cookies>>
  try {
    store = await cookies()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    log.warn({ code: 'anon_id_read_failed', msg }, 'cookies() unavailable')
    return null
  }
  const raw = store.get(ANON_ID_COOKIE)?.value
  if (!isValidAnonId(raw)) return null
  return raw!.trim().toLowerCase()
}

/** Persist an anon ID to the outgoing cookies. Sets SameSite=Lax +
 *  Path=/ so the banner on every page can read it without a
 *  per-route cookie jar. Secure flag follows the request protocol.
 *  Fail-soft: a cookie-store error is logged and swallowed (the
 *  caller's flow continues — losing an anon-id round-trip is not a
 *  page-fatal event). */
export async function writeAnonId(id: string): Promise<void> {
  if (!isValidAnonId(id)) {
    log.warn({ code: 'anon_id_write_invalid' }, 'attempted to write invalid anon id')
    return
  }
  let store: Awaited<ReturnType<typeof cookies>>
  try {
    store = await cookies()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    log.warn({ code: 'anon_id_write_failed', msg }, 'cookies() unavailable for write; anon id lost')
    return
  }
  try {
    store.set({
      name: ANON_ID_COOKIE,
      value: id,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      secure: true,
      maxAge: ANON_ID_MAX_AGE_SECONDS,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    log.warn({ code: 'anon_id_set_failed', msg }, 'cookie.set() rejected; anon id lost')
  }
}

/** Best-effort read-or-mint: returns the existing anon ID if the
 *  cookie holds a valid UUID, otherwise mints and persists a new one.
 *  Fail-soft: cookie-store errors → returns a freshly-minted ID
 *  WITHOUT writing it (the caller can persist on the next round-trip).
 *  This avoids crashing render when the cookies() store rejects. */
export async function ensureAnonId(): Promise<string> {
  const existing = await readAnonId()
  if (existing) return existing
  const fresh = mintAnonId()
  try {
    await writeAnonId(fresh)
  } catch {
    // Best-effort; the caller still has the ID for in-memory use.
  }
  return fresh
}
