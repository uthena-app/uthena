// Canonical signed-URL helpers for Bunny Storage / Stream.
//
// This is the only place in the codebase that knows the Bunny token
// format. Every other module imports `signCdnUrl` / `verifyCdnUrl` from
// here. The TTL constants (24h for downloads, 4h for streams) live here
// too — every caller references the constants, not magic numbers.
//
// The `verifyCdnUrl` helper is here so tests can round-trip the
// signature (sign → verify) and prove the implementation matches the
// spec without calling out to a real CDN.
//
// Per the cross-cutting spec (`00-foundations/files/README.md`):
//   - Downloads: 24h TTL, NOT IP-bound (legit use case: download on
//     phone, then on laptop).
//   - Streams:   4h TTL, IP-bound (a shared URL only works for the
//     issuer's IP, and only for 4h).
//
// Bunny's token format (documented at
// https://docs.bunny.net/reference/stream-security-tokens for Stream and
// https://docs.bunny.net/reference/storage-security-tokens for Storage):
//   base = <public_hostname>/<storage_path>
//   signature = HMAC_SHA256(signing_key, "<host>/<path>/<expires>[/<ip>]")
//   query = ?token=<sig>&expires=<unix>[&ip=<ip>][&<extra>...]

import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '../env'

/** TTL in seconds. Single source of truth — every caller reads from here. */
export const SIGNED_URL_TTL_SECONDS = {
  download: 24 * 60 * 60, // 24h
  stream: 4 * 60 * 60, // 4h
} as const

export type SignedUrlKind = keyof typeof SIGNED_URL_TTL_SECONDS

/** Hourly rate limit per user, shared by downloads + streams. */
export const SIGNED_URL_LIMIT_PER_HOUR = 60

/** Hour in milliseconds — the bucket size. */
export const HOUR_MS = 60 * 60 * 1000

/**
 * True when BUNNY_SIGNING_KEY + BUNNY_STORAGE_PUBLIC_HOSTNAME are both
 * set in the env. The signing key is required for every signed URL;
 * the hostname is required to build the base URL.
 */
export function isBunnyConfigured(): boolean {
  const env = getEnv()
  return Boolean(env.BUNNY_SIGNING_KEY && env.BUNNY_STORAGE_PUBLIC_HOSTNAME)
}

/**
 * Get the public CDN URL for a thumbnail / asset (no signing needed).
 * Used for non-protected assets like product thumbnails.
 */
export function getPublicCdnUrl(storagePath: string): string {
  const env = getEnv()
  if (!env.BUNNY_STORAGE_PUBLIC_HOSTNAME) {
    throw new Error('[bunny] BUNNY_STORAGE_PUBLIC_HOSTNAME missing.')
  }
  return `${env.BUNNY_STORAGE_PUBLIC_HOSTNAME}/${storagePath}`
}

/** Internal — used by both sign and verify. Pure, no env read. */
function computeSignature(
  signingKey: string,
  hostname: string,
  storagePath: string,
  expiresAt: number,
  ip: string | undefined,
): string {
  const messageParts = [hostname, storagePath, String(expiresAt)]
  if (ip) messageParts.push(ip)
  return createHmac('sha256', signingKey).update(messageParts.join('/')).digest('hex')
}

/**
 * Sign a Bunny CDN URL. Returns the full URL + the absolute expiry
 * timestamp (so the caller can write it to the audit row).
 *
 * Throws when Bunny is not configured (fail-closed — the caller should
 * `isBunnyConfigured()` first and return a friendly error).
 */
export function signCdnUrl(opts: {
  storagePath: string
  kind: SignedUrlKind
  ip?: string | undefined
  /** Extra query string appended verbatim (for HLS m3u8 etc). */
  extraQuery?: Record<string, string> | undefined
  /** Test-only — override the current time so expiry is deterministic. */
  nowMs?: number
}): { url: string; expiresAt: Date } {
  const env = getEnv()
  if (!isBunnyConfigured()) {
    throw new Error('[bunny] BUNNY_SIGNING_KEY or BUNNY_STORAGE_PUBLIC_HOSTNAME missing.')
  }
  const ttl = SIGNED_URL_TTL_SECONDS[opts.kind]
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000)
  const expiresAt = nowSec + ttl
  const signature = computeSignature(
    env.BUNNY_SIGNING_KEY!,
    env.BUNNY_STORAGE_PUBLIC_HOSTNAME!,
    opts.storagePath,
    expiresAt,
    opts.ip,
  )
  const base = `${env.BUNNY_STORAGE_PUBLIC_HOSTNAME}/${opts.storagePath}`
  const query = new URLSearchParams()
  query.set('token', signature)
  query.set('expires', String(expiresAt))
  if (opts.ip) query.set('ip', opts.ip)
  if (opts.extraQuery) {
    for (const [k, v] of Object.entries(opts.extraQuery)) query.set(k, v)
  }
  return { url: `${base}?${query.toString()}`, expiresAt: new Date(expiresAt * 1000) }
}

/**
 * Verify a signed CDN URL. Returns the kind of failure or null when
 * the signature is valid (and not expired, and the IP matches if the
 * URL was IP-bound).
 *
 * Used by the test suite to round-trip the signature. NOT currently
 * called by production code (Bunny verifies on the edge) — but it
 * lives here so:
 *   1. The test suite can prove sign + verify are consistent.
 *   2. A future signed-URL proxy / custom origin can verify locally.
 *   3. A future webhook handler (e.g. "user reported URL works for
 *      someone else") can re-verify server-side.
 */
export function verifyCdnUrl(opts: {
  url: string
  /** Current time in ms. Test-only override. */
  nowMs?: number
  /** IP the request is coming from. Required for IP-bound URLs. */
  requestIp?: string | undefined
}):
  | { ok: true; kind: SignedUrlKind; storagePath: string; expiresAt: Date }
  | {
      ok: false
      reason:
        | 'misconfigured' // signing key / hostname missing
        | 'parse_error' // URL couldn't be parsed
        | 'wrong_host' // host doesn't match env
        | 'expired' // `expires` is in the past
        | 'bad_signature' // token doesn't match
        | 'ip_mismatch' // URL was IP-bound, request IP doesn't match
    } {
  const env = getEnv()
  if (!isBunnyConfigured()) {
    return { ok: false, reason: 'misconfigured' }
  }
  let parsed: URL
  try {
    parsed = new URL(opts.url)
  } catch {
    return { ok: false, reason: 'parse_error' }
  }
  if (parsed.host !== new URL(env.BUNNY_STORAGE_PUBLIC_HOSTNAME!).host) {
    return { ok: false, reason: 'wrong_host' }
  }
  const token = parsed.searchParams.get('token')
  const expires = Number(parsed.searchParams.get('expires') ?? '')
  const boundIp = parsed.searchParams.get('ip') ?? undefined
  // expires must be a positive finite number. A missing or 0 value is
  // a parse error (someone tampered with the URL or it was malformed
  // at mint time) — not "expired", which would imply the URL was once
  // valid.
  if (!token || !Number.isFinite(expires) || expires <= 0) {
    return { ok: false, reason: 'parse_error' }
  }
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000)
  if (expires <= nowSec) {
    return { ok: false, reason: 'expired' }
  }
  const storagePath = parsed.pathname.replace(/^\//, '')
  const expected = computeSignature(
    env.BUNNY_SIGNING_KEY!,
    env.BUNNY_STORAGE_PUBLIC_HOSTNAME!,
    storagePath,
    expires,
    boundIp,
  )
  // timingSafeEqual requires equal-length buffers.
  if (expected.length !== token.length) {
    return { ok: false, reason: 'bad_signature' }
  }
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(token, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' }
  }
  // IP binding: if the URL is bound to an IP, the verifier must pass
  // the same IP. Absent boundIp = URL is NOT IP-bound = no check.
  if (boundIp !== undefined) {
    if (!opts.requestIp) {
      return { ok: false, reason: 'ip_mismatch' }
    }
    if (opts.requestIp !== boundIp) {
      return { ok: false, reason: 'ip_mismatch' }
    }
  }
  // Best-effort kind inference: download kind has 24h, stream has 4h.
  // We don't try to reverse-engineer the kind from the TTL — the
  // caller knows which it minted.
  const ttlSec = expires - nowSec
  const kind: SignedUrlKind =
    ttlSec > SIGNED_URL_TTL_SECONDS.stream ? 'download' : 'stream'
  return {
    ok: true,
    kind,
    storagePath,
    expiresAt: new Date(expires * 1000),
  }
}
