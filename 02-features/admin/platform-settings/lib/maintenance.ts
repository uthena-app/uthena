// maintenance.ts — the pure contract for P14.15 Maintenance mode.
//
// Spec: `01-specs/pages/admin-settings.md` lines 19, 64, 93, 123.
// The maintenance toggle on `/admin/settings → General` lets admins
// flip a site-wide switch. When ON, the middleware returns 503 for
// every non-admin route; admin routes (anything starting with
// `/admin/`) remain accessible.
//
// This file owns:
//   1. The constants — cookie names, TTL, typed-CONFIRM string,
//      message-length caps, default fallback message.
//   2. The Zod schemas — for the server action input + the cookie
//      payload + the DB row mapping.
//   3. The pure coercers — defensive parsers for the cookie + the DB
//      row. These never throw; bad input falls back to a safe default.
//   4. The formatters — for the audit strip + the 503 page + the admin
//      editor.
//
// All exports are pure functions / constants — no I/O, no DB, no
// React. Tested in `maintenance.test.ts`.

import { z } from 'zod'
import {
  MAINTENANCE_CONFIRM_STRING,
  MAINTENANCE_MESSAGE_DB_MAX_LENGTH,
  MAINTENANCE_MESSAGE_MAX_LENGTH,
} from '@foundations/data/schemas'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Re-export of the typed-CONFIRM string so the modal + the action +
 * the schema all reference the same constant.
 */
export const MAINTENANCE_CONFIRM = MAINTENANCE_CONFIRM_STRING

/**
 * Cookie that signals "maintenance is on" to the edge middleware.
 *
 * SEC-2 — carries the `__Host-` prefix (RFC 6265bis). The browser
 * enforces `__Host-`-prefixed cookies to be `Secure`, `Path=/`, and
 * host-only (no `Domain` attribute) — this alone blocks the
 * subdomain-injection vector the audit flagged (a cookie set on
 * `evil.uthena.com` can no longer be read as `uthena.com`'s cookie).
 * The value itself is additionally HMAC-signed (see
 * `signMaintenanceEnabledValue` / `parseMaintenanceEnabledCookie`
 * below) so a forged `=1` value is rejected even if an attacker could
 * otherwise set a same-origin cookie.
 */
export const MAINTENANCE_COOKIE_ENABLED = '__Host-uthena_maintenance_enabled'

/** Cookie carrying the admin-provided message (URL-encoded). Same
 *  `__Host-` treatment as the enabled cookie; not HMAC-signed (an
 *  attacker-controlled message string is not a privilege issue — the
 *  worst case is a forged 503 page's body text — but is still
 *  origin-locked by the `__Host-` prefix). */
export const MAINTENANCE_COOKIE_MESSAGE = '__Host-uthena_maintenance_message'

/**
 * Cookie TTL in seconds. The spec calls for a 60s cache; we use the
 * cookie's `Max-Age` as the cache horizon. After this many seconds
 * the cookie expires and the next request re-reads the DB (via the
 * page server-component, which fires after the cookie check).
 */
export const MAINTENANCE_COOKIE_TTL_SECONDS = 60

/** Maximum length of the maintenance message at the action layer. */
export const MAINTENANCE_MESSAGE_MAX = MAINTENANCE_MESSAGE_MAX_LENGTH

/** Maximum length of the maintenance message at the DB layer. */
export const MAINTENANCE_MESSAGE_DB_MAX = MAINTENANCE_MESSAGE_DB_MAX_LENGTH

/** Fallback message when the admin leaves the textarea empty. */
export const MAINTENANCE_DEFAULT_MESSAGE =
  'We are performing scheduled maintenance and will be back shortly. Thanks for your patience.'

/**
 * Path prefixes the middleware exempts from the 503 when maintenance
 * is on. `/admin/*` keeps the admin able to flip the toggle back off;
 * `/maintenance` lets the user see the message directly; `/api/health`
 * + `/_next/*` + `/favicon.ico` + `/healthz` are infrastructure (also
 * excluded via the middleware matcher).
 *
 * Exported for the middleware to import (single source of truth).
 */
export const MAINTENANCE_PATH_EXEMPT_PREFIXES = ['/admin/', '/maintenance'] as const

/**
 * Rate limit for the maintenance-mode toggle. Per spec line 126:
 * "10 maintenance-mode toggles per admin per day". The 24h window is
 * a sliding one (not a fixed calendar day) — simpler for admins.
 */
export const MAINTENANCE_TOGGLE_RATE_LIMIT_MAX = 10
export const MAINTENANCE_TOGGLE_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * Wire shape the server action accepts. Mirrors
 * `UpdateMaintenanceActionInput` from `@foundations/data/schemas` but
 * kept here so the feature module owns its full contract (the schema
 * in foundations is the canonical validator; this re-export is the
 * convenience surface for the feature-side imports).
 */
export const MaintenanceActionInputSchema = z
  .object({
    enabled: z.boolean(),
    message: z
      .string()
      .max(MAINTENANCE_MESSAGE_MAX, `Message must be ${MAINTENANCE_MESSAGE_MAX} characters or fewer.`),
    confirm: z.literal(MAINTENANCE_CONFIRM),
  })
  .strict()

/**
 * DB row shape — the four fields the maintenance feature reads/writes.
 * Matches the columns added in migration 0064.
 */
export const MaintenanceDbRowSchema = z.object({
  maintenance_mode: z.boolean(),
  maintenance_started_at: z.string().nullable(),
  maintenance_message: z.string().nullable(),
})

/** In-memory `MaintenanceState` shape — what the UI consumes. */
export const MaintenanceStateSchema = z.object({
  enabled: z.boolean(),
  started_at: z.string().nullable(),
  message: z.string(),
})
export type MaintenanceState = z.infer<typeof MaintenanceStateSchema>

// ---------------------------------------------------------------------------
// Defensive coercers
// ---------------------------------------------------------------------------

/**
 * Defensive coercion for the maintenance state read from the DB or
 * from a stale cookie. NEVER throws; bad input falls back to the
 * canonical "off + default message" state. Used by the query +
 * the middleware.
 */
export function coerceMaintenanceState(raw: unknown): MaintenanceState {
  const parsed = MaintenanceDbRowSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      enabled: false,
      started_at: null,
      message: MAINTENANCE_DEFAULT_MESSAGE,
    }
  }
  const row = parsed.data
  return {
    enabled: row.maintenance_mode,
    started_at: row.maintenance_started_at,
    // Empty / whitespace-only messages fall back to the default so the
    // 503 page never renders a blank state.
    message:
      typeof row.maintenance_message === 'string' && row.maintenance_message.trim() !== ''
        ? row.maintenance_message.trim()
        : MAINTENANCE_DEFAULT_MESSAGE,
  }
}

// ---------------------------------------------------------------------------
// SEC-2 — HMAC signing for the "enabled" cookie value.
//
// The middleware previously trusted any inbound `=1` cookie value —
// forgeable from any same-site context (or, pre-`__Host-`, from a
// subdomain). The setter now signs `1` with HMAC-SHA256 keyed on
// AUTH_SECRET (the app's existing session-signing secret — no new env
// var); the cookie value becomes `<payload>.<hex hmac>`. The verifier
// recomputes the MAC and rejects on any mismatch.
//
// Uses Web Crypto (`crypto.subtle`), NOT `node:crypto` — this module is
// imported by `middleware.ts`, which runs on the Next.js Edge runtime
// by default. The Edge runtime supports `SubtleCrypto` but not Node's
// `node:crypto` module (see Next.js Edge Runtime API reference); using
// `node:crypto` here would work in `pnpm test` (Node) but throw at the
// edge in production. `crypto.subtle` is available in both the Edge
// runtime and modern Node (global `crypto`), so this one implementation
// works everywhere the module is imported.
// ---------------------------------------------------------------------------

/** The only payload the enabled cookie ever carries pre-signing. */
const MAINTENANCE_ENABLED_PAYLOAD = '1'

/** Read AUTH_SECRET directly from process.env (not `getEnv()` — this
 *  module is imported by the Edge middleware via the barrel export,
 *  and `getEnv()` validates the FULL server env schema, which is not
 *  available/desirable on the Edge runtime). Returns `null` when unset
 *  so callers can fail closed. */
function readAuthSecret(): string | null {
  if (typeof process === 'undefined' || !process.env) return null
  const secret = process.env.AUTH_SECRET
  return typeof secret === 'string' && secret.length > 0 ? secret : null
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Compute the HMAC-SHA256 hex digest of `payload` keyed on `secret`,
 *  via Web Crypto (`crypto.subtle`) — works on both the Edge runtime
 *  and Node. `secret` is injected so tests don't depend on
 *  process.env. */
export async function hmacMaintenanceValue(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return bytesToHex(signature)
}

/**
 * Build the signed value for the `uthena_maintenance_enabled` cookie:
 * `"1.<hmac-hex>"`. Called by the setter.
 */
export async function signMaintenanceEnabledValue(secret: string): Promise<string> {
  const mac = await hmacMaintenanceValue(MAINTENANCE_ENABLED_PAYLOAD, secret)
  return `${MAINTENANCE_ENABLED_PAYLOAD}.${mac}`
}

/**
 * Parse + verify the `uthena_maintenance_enabled` cookie value. Only
 * resolves `true` when the value is the exact `"1.<hmac-hex>"` shape
 * AND the HMAC verifies against `AUTH_SECRET`. Any other value
 * (missing, empty, unsigned `"1"`, forged MAC, tampered payload) is
 * treated as off — this is the fail-closed direction (worst case is
 * maintenance mode failing to activate, never a forged cookie
 * activating it).
 *
 * Async (Web Crypto's `subtle.sign` has no synchronous form). The
 * middleware awaits this — see `middleware.ts`.
 *
 * Comparison is via a fresh HMAC recompute + string equality on hex
 * digests. This is not a hand-rolled timing-safe comparator, but the
 * leak surface is negligible here: an attacker who can already
 * observe response-time deltas at the ~microsecond level created by a
 * `===` scan over a 64-char hex string, on a cookie whose worst-case
 * exploit is toggling a maintenance page, is not the threat model
 * `node:crypto.timingSafeEqual` exists for. (`node:crypto` isn't
 * available on the Edge runtime this module runs on — see the header
 * comment above.)
 */
export async function parseMaintenanceEnabledCookie(raw: unknown): Promise<boolean> {
  if (typeof raw !== 'string' || raw === '') return false
  const secret = readAuthSecret()
  if (!secret) return false

  const dotIndex = raw.indexOf('.')
  if (dotIndex <= 0) return false
  const payload = raw.slice(0, dotIndex)
  const mac = raw.slice(dotIndex + 1)
  if (payload !== MAINTENANCE_ENABLED_PAYLOAD) return false
  if (!/^[0-9a-f]{64}$/.test(mac)) return false

  const expected = await hmacMaintenanceValue(payload, secret)
  return mac === expected
}

/**
 * Parse the `uthena_maintenance_message` cookie value. The value is
 * URL-encoded so the raw cookie string is safe for the HTTP header.
 * Returns the trimmed string or null on bad input.
 *
 * Defense in depth: rejects values that exceed the DB layer's cap
 * (1000 chars), even though the action caps at 500. If a stale
 * cookie carries a too-long value (e.g. an action's bound was raised
 * + a downgrade happened), the middleware falls back to the default
 * message instead of crashing.
 */
export function parseMaintenanceMessageCookie(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const trimmed = decoded.trim()
  if (trimmed === '') return null
  if (trimmed.length > MAINTENANCE_MESSAGE_DB_MAX) return null
  return trimmed
}

/**
 * Normalize the admin-provided message before persisting:
 *   - Trim whitespace.
 *   - Collapse internal whitespace runs of 3+ newlines down to 2
 *     (so the message stays scannable).
 *   - Cap at the action-layer limit (500 chars) defensively.
 *
 * Returns `null` when the input is empty after trimming — the DB
 * stores NULL (not the empty string) so the coercer falls back to
 * the default message on read.
 */
export function normalizeMaintenanceMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const collapsed = trimmed.replace(/\n{3,}/g, '\n\n')
  if (collapsed.length <= MAINTENANCE_MESSAGE_MAX) return collapsed
  return collapsed.slice(0, MAINTENANCE_MESSAGE_MAX)
}

/**
 * Format the maintenance message for the 503 page. Trims + collapses
 * whitespace + truncates with an ellipsis if it exceeds the
 * display-friendly cap. Returns the fallback if input is empty.
 *
 * The 503 page is server-rendered by the middleware (no DB hit), so
 * this function runs on the Edge runtime — it must stay dependency-free.
 */
export function formatMaintenanceMessage(raw: unknown, maxLen = 500): string {
  if (typeof raw !== 'string') return MAINTENANCE_DEFAULT_MESSAGE
  const trimmed = raw.trim()
  if (trimmed === '') return MAINTENANCE_DEFAULT_MESSAGE
  const collapsed = trimmed.replace(/\n{3,}/g, '\n\n')
  if (collapsed.length <= maxLen) return collapsed
  return collapsed.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '\u2026'
}

/**
 * Format a maintenance timestamp for the audit strip / 503 footer.
 * Returns `''` for null / invalid input.
 *
 * The 503 page passes this a cookie string + the fallback expects
 * the `started_at` to be an ISO-8601 string. The function is
 * defensive: garbage in → empty string out.
 */
export function formatMaintenanceTimestamp(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`
}

// ---------------------------------------------------------------------------
// Cookie build helpers (used by the server action)
// ---------------------------------------------------------------------------

/**
 * Build the cookie options for the `__Host-uthena_maintenance_enabled`
 * cookie. HTTP-only + same-site=Lax + path=/ + max-age=60s + Secure.
 *
 * SEC-2: `secure: true` is unconditional (not env-dependent) because
 * the `__Host-` name prefix REQUIRES `Secure` — browsers silently
 * refuse to set a `__Host-`-prefixed cookie without it. In local dev
 * over plain `http://localhost` this means the cookie will not be
 * set by browsers that enforce the prefix strictly (Chrome makes a
 * `localhost`-only exception; Firefox/Safari do not) — acceptable
 * because maintenance mode is an admin/production feature, and the
 * TODO-HARDENING SEC-2 fix explicitly calls for the `__Host-` prefix.
 * `getMaintenanceCookieSecure()` is kept (see below) only for any
 * other cookie in this module that does NOT use the `__Host-` prefix.
 *
 * HTTP-only because the middleware reads it from the Edge runtime
 * where there's no need for client JS to see it.
 */
export function maintenanceEnabledCookieOptions(): {
  maxAge: number
  httpOnly: true
  sameSite: 'lax'
  path: string
  secure: true
} {
  return {
    maxAge: MAINTENANCE_COOKIE_TTL_SECONDS,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: true,
  }
}

/**
 * Build the cookie options for the `__Host-uthena_maintenance_message`
 * cookie. Same shape as the enabled cookie — they're managed as a pair
 * (same `__Host-` prefix, same unconditional Secure requirement).
 */
export function maintenanceMessageCookieOptions(): {
  maxAge: number
  httpOnly: true
  sameSite: 'lax'
  path: string
  secure: true
} {
  return maintenanceEnabledCookieOptions()
}

/**
 * Resolve the `secure` flag for the maintenance cookies based on the
 * runtime environment. `secure=true` is required in production
 * (HTTPS-only); `secure=false` is needed in dev so http://localhost
 * works without browser warnings.
 *
 * Pure function — takes the env value as input so tests can stub.
 */
export function resolveMaintenanceCookieSecure(envValue: unknown): boolean {
  // Treat anything other than the literal string 'production' as
  // non-production. The env helper in Node returns `NODE_ENV` which
  // is 'production' | 'development' | 'test'.
  return envValue === 'production'
}

/**
 * Read NODE_ENV at the server-action call site. Lazy so tests that
 * import this module don't fail when NODE_ENV is unset.
 */
export function getMaintenanceCookieSecure(): boolean {
  // `process` is undefined on the Edge runtime, but the server action
  // runs on Node — so the runtime check is implicit (we're never
  // imported from the middleware).
  if (typeof process === 'undefined' || !process.env) return false
  return resolveMaintenanceCookieSecure(process.env.NODE_ENV)
}

// ---------------------------------------------------------------------------
// Rate limit (pure helpers — state lives in a separate module because
// Next.js `'use server'` files can only export async functions).
// ---------------------------------------------------------------------------

/**
 * Pure verifier for the maintenance-toggle rate limit. The action
 * keeps an in-process `Map<adminId, timestamp[]>` (sliding 24h
 * window). This helper decides whether a new attempt is allowed.
 *
 * Returns `{ allowed: true }` on success, or
 * `{ allowed: false, retryAfterSeconds }` when the limit is exceeded.
 *
 * `now` is injected for testability.
 */
export function rateLimitVerdict(
  attempts: readonly number[] | undefined,
  now: number,
  max = MAINTENANCE_TOGGLE_RATE_LIMIT_MAX,
  windowMs = MAINTENANCE_TOGGLE_RATE_LIMIT_WINDOW_MS,
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const cutoff = now - windowMs
  const recent = (attempts ?? []).filter((t) => t > cutoff)
  if (recent.length < max) return { allowed: true }
  // The 11th attempt is denied; the retry-after is the time until the
  // oldest attempt in the window expires.
  const oldest = Math.min(...recent)
  const retryAfterMs = oldest + windowMs - now
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  }
}