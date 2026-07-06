// reserved-handles.ts — the canonical list of handles that may NOT be
// chosen by an affiliate onboarding wizard, plus the helpers that
// gate them.
//
// P13.1 — affiliate onboarding wizard. The handle the affiliate picks
// appears in the public mini-shop URL `uthena.com/[handle]`, so it
// must not collide with any top-level app route, any future reserved
// brand surface, or any existing infrastructure name. The DB
// (handle_reservations.primary key + affiliates.handle UNIQUE) only
// catches uniqueness against existing rows; the reserved-list is the
// proactive block for *future* / *external* names.
//
// Spec source: `01-specs/pages/affiliate-onboarding.md` §"Reserved
// handle list" + `01-specs/pages/_data-model.md` line 1331
// ("The reserved-handle list... lives in
// `00-foundations/auth/reserved-handles.ts` — checked at the server
// action layer, not the DB").
//
// Design contract:
//   - The list is a frozen Set — additions require a code change + a
//     migration + a release. The trade-off is intentional: a frozen
//     list is auditable, reviewable in PR, and easy to grep.
//   - The DB has the *reactive* uniqueness (`handle_reservations`
//     PRIMARY KEY + `affiliates.handle` UNIQUE). The reserved list is
//     the *proactive* block — a member of this set will NEVER resolve
//     to a successful reservation, even before the user picks it.
//   - The check is case-insensitive (handles are lowercased before the
//     call — see `normalizeHandle` below), so the Set keys are
//     lowercased at module load.
//   - The handle-regex (`HANDLE_REGEX`) is exported too so the Zod
//     schema in `02-features/affiliate-onboarding/lib/saveStepSchema.ts`
//     reuses the same source of truth (no drift between the wizard's
//     accept rule and the reservation rule).

/** The canonical handle regex — 3-30 chars, lowercase letters / digits /
 *  hyphens, no leading/trailing hyphen. Matches the spec line 21. */
export const HANDLE_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

/** The minimum + maximum handle lengths (chars), per spec line 21. */
export const HANDLE_MIN_LENGTH = 3
export const HANDLE_MAX_LENGTH = 30

/** The frozen list of reserved handles. A user picking any of these
 *  is rejected before the DB ever sees the reservation attempt.
 *
 *  Why these names (per spec + existing app routes + brand-safety):
 *
 *  - **App routes**: every top-level path under `uthena.com/*` must
 *    not collide. Sourced from `app/` directory tree + the URL-driven
 *    surfaces from P0.x. As new routes ship, this list grows.
 *  - **External surfaces**: `uthena.com` parent paths that partners
 *    + affiliates + customers might hit (e.g. `help`, `support`,
 *    `docs`, `cdn`).
 *  - **Brand + product**: `uthena`, `app`, `api`, `admin` — would be
 *    confusing if a public minishop lived there.
 *  - **HTTP / web standards**: `www`, `static`, `assets`, `favicon`
 *    — host-level concerns that could collide with infrastructure
 *    paths.
 *
 *  Edit policy: PRs that add a name MUST include the rationale + the
 *  app route / external surface it protects. */
const RESERVED_HANDLES_FROZEN = [
  // App routes (every top-level path in `app/`)
  'account',
  'admin',
  'affiliate',
  'api',
  'app',
  'auth',
  'billing',
  'blog',
  'blogs',
  'browse',
  'bundles',
  'cart',
  'cdn',
  'checkout',
  'collections',
  'contact',
  'dashboard',
  'data-sharing-opt-out',
  'delivery',
  'dmca',
  'faq',
  'help',
  'library',
  'login',
  'logout',
  'newsletter',
  'pages',
  'partner',
  'policies',
  'products',
  'refund-policy',
  'reset-password',
  'search',
  'settings',
  'setup-password',
  'signup',
  'sitemap',
  'sitemap-xml',
  'static',
  'support',
  'terms',
  'update-password',
  'verify-email',
  'verify-certificate',

  // Brand + product names (would be confusing if a minishop lived there)
  'uthena',
  'grabltd',
  'soofos',

  // HTTP / web standards + host infrastructure
  'www',
  'assets',
  'favicon',
  'robots',
  'humans',
  'security',

  // Reserved prefixes that COULD collide (prevent narrow squat)
  // Note: full-prefix blocking is the cron janitor's job; this list
  // is the explicit single-word block.
] as const

/** The frozen list, normalized to lowercase, exposed as a Set for
 *  O(1) `has()` lookups. The export is `ReadonlySet<string>` so callers
 *  cannot mutate. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set(
  RESERVED_HANDLES_FROZEN.map((h) => h.toLowerCase()),
)

/** Lowercase + trim a handle candidate. Server actions normalize the
 *  handle before the reservation INSERT so the DB's case-insensitive
 *  uniqueness in practice holds (Postgres text PK is case-sensitive
 *  by default; we lean on the lowercasing here). */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Predicate — is the candidate handle reserved? Lowercase-normalized
 *  before the lookup so the comparison is case-insensitive. Returns
 *  `false` for empty / non-string input (defensive — the Zod schema
 *  catches these earlier, but the helper stays total). */
export function isReservedHandle(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length === 0) return false
  return RESERVED_HANDLES.has(raw.trim().toLowerCase())
}

/** Predicate — is the candidate handle syntactically valid? Reuses
 *  `HANDLE_REGEX` so the wizard's accept rule and the reservation
 *  rule share one source of truth. Returns `false` for non-string
 *  input (defensive). */
export function isValidHandleShape(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  if (raw.length < HANDLE_MIN_LENGTH || raw.length > HANDLE_MAX_LENGTH) return false
  return HANDLE_REGEX.test(raw)
}

/** Reason strings returned by `validateHandle()` — used by the wizard's
 *  form to render the right inline error. */
export type HandleValidationError =
  | 'invalid_shape'
  | 'reserved'

/** Full validation pass: shape + reserved. Returns either the
 *  normalized handle (lowercased + trimmed) or a reason string the
 *  caller can map to a UI message. */
export function validateHandle(raw: unknown):
  | { ok: true; handle: string }
  | { ok: false; reason: HandleValidationError } {
  if (!isValidHandleShape(raw)) {
    return { ok: false, reason: 'invalid_shape' }
  }
  const normalized = (raw as string).trim().toLowerCase()
  if (RESERVED_HANDLES.has(normalized)) {
    return { ok: false, reason: 'reserved' }
  }
  return { ok: true, handle: normalized }
}