// cartExpiration.ts — P4.3 cart expiration policy.
//
// The cart's idle window is 30 days. After 30 days without any
// mutation (no add / qty change / license change / remove / clear),
// the auth cart's DB rows flip to status='expired' (via the daily
// `cron/expire-carts.ts` job) and the anon-cookie cart simply
// disappears (its HTTP maxAge is now 30 days, also bumped in P4.3).
//
// The warning window is the last 5 days of that 30-day window
// (i.e., 25-30 days idle). During the warning window, the UI shows
// a non-blocking banner on /cart + CartDrawer: "Your cart will
// expire in N days." A daily cron at day 25 should also send a
// recovery email — that half is deferred to Phase 17 (STUB-048)
// because it needs the SES adapter + an email template.
//
// The functions here are pure date math — no DB, no I/O, no
// server-only APIs. They are used by both the auth branch
// (server-side query, RSC render) and the anon branch (cookie-based
// last_activity computation) so the same warning + expiry logic
// applies to both surfaces. The banner component (RSC + client
// islands via CartDrawer) imports these helpers, so the module
// must NOT be marked `server-only`.

import type { AnonCart } from '@foundations/cookies/anon-cart'

/** Idle days before the cart is considered expired.
 *  Matches the cron job's `updated_at < now() - 30 days` rule. */
export const CART_IDLE_DAYS_BEFORE_EXPIRY = 30

/** Days before expiry that trigger the warning banner.
 *  With 30-day expiry + 5-day warn window, the banner shows at
 *  25-30 days idle. */
export const CART_WARN_DAYS_BEFORE_EXPIRY = 5

/** Idle days before the cart is flagged as "abandoned" (a recovery
 *  state — the cart gets the cart_abandoned event emitted + the
 *  Phase 17 recovery email fired, if/when the SES adapter ships).
 *
 *  This sits exactly at the start of the warning window: once a cart
 *  crosses the 25-day idle line, it's in the recovery state until
 *  the expire-carts cron flushes it at day 30. The constant is the
 *  single source of truth shared by the abandonment-detection cron
 *  (`04-platform/ci/scripts/cron/detect-abandoned-carts.ts`) and any
 *  UI surface that wants to render the recovery state differently
 *  from the plain warn banner (none do in v1, but the seam is here).
 *
 *  Math: equal to `CART_IDLE_DAYS_BEFORE_EXPIRY - CART_WARN_DAYS_BEFORE_EXPIRY`.
 *  Exported as the literal 25 (not the derived expression) so future
 *  changes to the expiry / warn windows don't silently shift the
 *  abandonment threshold by surprise — each value is owned by a
 *  single product decision. */
export const CART_IDLE_DAYS_BEFORE_ABANDONMENT = 25

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Status of the cart relative to the 30-day idle expiry policy.
 *  - `daysUntilExpiry` is a non-negative integer (days remaining
 *    until the cart crosses the 30-day idle line).
 *  - `isExpired` is true when lastActivity is at or beyond the
 *    30-day mark. The cron already flipped auth rows by then;
 *    anon cookies have already expired by then.
 *  - `isInWarnWindow` is true when `daysUntilExpiry <= 5` AND
 *    `!isExpired` — i.e. the 25-30 day idle range. The UI shows
 *    the warning banner in this window.
 *  - `isFresh` is true when `daysUntilExpiry > 5` AND `!isExpired`
 *    — the cart has been active recently and no banner is shown.
 */
export type CartExpirationStatus =
  | {
      kind: 'fresh'
      daysUntilExpiry: number
    }
  | {
      kind: 'warn'
      daysUntilExpiry: number
    }
  | {
      kind: 'expired'
      daysSinceExpiry: number
    }

/** Compute the cart's expiration status given the last-activity
 *  timestamp. `now` defaults to the current real time; tests pass
 *  a fixed value to keep the math deterministic. The function is
 *  pure: same inputs always produce the same output.
 *
 *  Returns `null` when `lastActivityIso` is missing or unparseable
 *  — callers should treat null as "no activity, no banner" (e.g.
 *  the cart is empty, no rows to expire). */
export function getCartExpirationStatus(
  lastActivityIso: string | null | undefined,
  now: Date = new Date(),
): CartExpirationStatus | null {
  if (!lastActivityIso) return null
  const lastActivityMs = Date.parse(lastActivityIso)
  if (Number.isNaN(lastActivityMs)) return null
  const idleMs = now.getTime() - lastActivityMs
  if (idleMs < 0) {
    // Clock skew or future-dated row — treat as brand-new.
    return { kind: 'fresh', daysUntilExpiry: CART_IDLE_DAYS_BEFORE_EXPIRY }
  }
  const idleDays = idleMs / MS_PER_DAY
  // The boundary is STRICTLY past 30 days — a row at exactly the
  // 30-day mark still has the full day to act (the cron's
  // `lt('updated_at', now - 30 days)` is also strict-less-than,
  // so the row wouldn't be flipped by the next daily run either).
  if (idleDays > CART_IDLE_DAYS_BEFORE_EXPIRY) {
    return {
      kind: 'expired',
      daysSinceExpiry: Math.floor(idleDays - CART_IDLE_DAYS_BEFORE_EXPIRY),
    }
  }
  const daysUntilExpiry = Math.ceil(CART_IDLE_DAYS_BEFORE_EXPIRY - idleDays)
  if (daysUntilExpiry <= CART_WARN_DAYS_BEFORE_EXPIRY) {
    return { kind: 'warn', daysUntilExpiry }
  }
  return { kind: 'fresh', daysUntilExpiry }
}

/** Last-activity timestamp for the anon-cookie cart.
 *  - If the cookie has any lines, returns the MAX of `line.a` —
 *    the most recent add (which is what the user thinks of as
 *    "last activity"; qty/license/remove edits to the cookie also
 *    rewrite the cookie but don't change the per-line `a`).
 *  - If the cookie has no lines but exists (created_at present),
 *    returns `c` (the cookie cart's birth).
 *  - If the cookie is null/empty, returns null — the cart isn't
 *    really there to expire.
 *
 *  The auth cart's equivalent lives in
 *  `02-features/cart/queries/getCartLastActivity.ts` and queries
 *  `MAX(cart_items.updated_at)` for active rows.
 */
export function getAnonCartLastActivity(cookie: AnonCart | null): string | null {
  if (!cookie) return null
  if (cookie.lines.length === 0) {
    return cookie.c ? cookie.c : null
  }
  // The length check above guarantees the first element exists; the
  // non-null assertions are TS narrowing for `noUncheckedIndexedAccess`.
  const first = cookie.lines[0]!
  let max = first.a
  for (let i = 1; i < cookie.lines.length; i++) {
    const next = cookie.lines[i]!.a
    if (Date.parse(next) > Date.parse(max)) max = next
  }
  return max
}

/** Human-readable message for the warning banner. The drawer
 *  and /cart page both render this verbatim — no per-surface
 *  formatting variants.
 *
 *  - 5 days: "Your cart will expire in 5 days."
 *  - 2 days: "Your cart will expire in 2 days."
 *  - 1 day : "Your cart will expire tomorrow."
 *  - 0 days: "Your cart will expire today." (edge case: last
 *            activity at exactly the 30-day mark)
 *  - any other case shouldn't be shown (UI gates on isInWarnWindow)
 *    but we still return a sane fallback. */
export function formatExpiryWarning(daysUntilExpiry: number): string {
  if (daysUntilExpiry <= 0) return 'Your cart will expire today.'
  if (daysUntilExpiry === 1) return 'Your cart will expire tomorrow.'
  return `Your cart will expire in ${daysUntilExpiry} days.`
}

/** True when the status is in the warning window (5 days or
 *  fewer until expiry). The UI uses this to decide whether to
 *  render the banner. Exposed as a small helper so the call site
 *  doesn't have to switch on the discriminated union shape. */
export function isInCartExpirationWarnWindow(status: CartExpirationStatus | null): boolean {
  return status?.kind === 'warn'
}

/** True when the cart is past the 30-day idle mark. Used by tests
 *  + admin tooling; the cart surface filters out expired rows
 *  before render so the UI never sees this state in practice. */
export function isCartExpired(status: CartExpirationStatus | null): boolean {
  return status?.kind === 'expired'
}

/**
 * True when the cart's last activity has crossed the abandonment
 * threshold (25 idle days). The abandonment-detection cron
 * (`04-platform/ci/scripts/cron/detect-abandoned-carts.ts`) uses
 * this to decide which `cart_items` rows to flip from
 * `status='active'` to `status='abandoned'`.
 *
 * Distinct from the `warn` state in `getCartExpirationStatus`:
 *   - `warn` (25-30 days idle) is a UI signal — the warning banner
 *     renders above the cart line list.
 *   - `abandoned` (the cron-managed DB state) is a server-side
 *     signal — the row gets the recovery email + an analytics event,
 *     and stays in that status until the expire-carts cron flushes
 *     it to `'expired'` at day 30.
 *
 * Both states share the same boundary (25 days idle) but mean
 * different things to different systems. This helper exposes the
 * 25-day threshold as a pure boolean so the cron can use it without
 * caring about the UI-side discriminated union.
 *
 * Returns `false` (not throws) when `lastActivityIso` is null,
 * undefined, empty, or unparseable — the cron's filter `.lt('updated_at', cutoff)`
 * already excludes rows without `updated_at`, but a defensive false
 * here means future callers can't accidentally treat missing data
 * as "abandoned". The matching helper `isPastAbandonmentThreshold`
 * is intentionally permissive about non-Date inputs (returns false
 * for `null` / `undefined` / `''` / unparseable strings).
 */
export function isPastAbandonmentThreshold(
  lastActivityIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastActivityIso) return false
  const lastActivityMs = Date.parse(lastActivityIso)
  if (Number.isNaN(lastActivityMs)) return false
  const idleDays = (now.getTime() - lastActivityMs) / MS_PER_DAY
  // Strict greater-than matches the cron's `.lt('updated_at', cutoff)`
  // boundary: a row at exactly 25 days idle is NOT yet past the
  // threshold (the cron wouldn't pick it up either, since its
  // `cutoff = now - 25 days` and `.lt` is strictly-less-than).
  return idleDays > CART_IDLE_DAYS_BEFORE_ABANDONMENT
}