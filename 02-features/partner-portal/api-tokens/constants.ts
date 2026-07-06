// 02-features/partner-portal/api-tokens/constants.ts — P12.19.
//
// Single source of truth for the partner API tokens feature's
// tunables. Mirrors the pattern of
// `02-features/partner-onboarding/lib/rate-limit.ts` +
// `02-features/partner-upload/actions/saveUploadDraft.rate-limit.ts`.
// All values are exported individually so call sites can read the
// constant by name (better stack traces + grep results than a
// positional object access).

/** Maximum length of a partner-supplied token name. Per the spec at
 *  `01-specs/pages/partner-settings-api.md` line 72 ("Token name is
 *  required (1-80 chars)"). */
export const API_TOKEN_NAME_MAX_LENGTH = 80

/** Minimum length of a partner-supplied token name. */
export const API_TOKEN_NAME_MIN_LENGTH = 1

/** Max number of ACTIVE tokens (not revoked AND not expired) per
 *  partner. Per the spec line 76. Enforced server-side at create
 *  time — a partner with 10 active tokens sees a friendly error on
 *  the 11th attempt and must revoke one first. */
export const API_TOKEN_MAX_ACTIVE_TOKENS = 10

/** Per-spec scope union. The 3 values are the v1 read-only set;
 *  write scopes are explicitly out of scope (`partner-settings-api.md`
 *  line 49 "No write-scoped tokens (v1 is read-only)"). This is the
 *  canonical type — `lib/schemas.ts` re-uses it via `z.enum(...)`. */
export type ApiTokenScope = 'read_sales' | 'read_payouts' | 'read_products'

/** Per-spec scopes (the runtime tuple). The `as const` is applied to
 *  a fresh literal array (not the type alias) so TypeScript doesn't
 *  trip on the self-reference. */
export const API_TOKEN_SCOPES = [
  'read_sales',
  'read_payouts',
  'read_products',
] as const satisfies readonly ApiTokenScope[]

/** Per-spec human-readable scope labels (rendered as chips in the UI
 *  and the create modal). Order matches `API_TOKEN_SCOPES`. */
export const API_TOKEN_SCOPE_LABELS: Readonly<Record<ApiTokenScope, string>> = {
  read_sales: 'Read sales',
  read_payouts: 'Read payouts',
  read_products: 'Read products',
}

/** Expiration options offered in the create modal. The `value` is
 *  days until the token is no longer valid; `null` means "never
 *  expires". Per the spec line 15 (expiration radio: 30d / 90d /
 *  1y / never). The `as const` is applied to the wrapping array; the
 *  union of values is derived for the schema's `expirationDays`
 *  field. */
export const API_TOKEN_EXPIRATION_OPTIONS = [
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
  { value: null, label: 'Never' },
] as const

/** Max creates per partner per hour. Per spec line 74. Defense
 *  against token-spam. The action returns a friendly "try again in
 *  N minutes" message when this trips. */
export const API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER = 5

/** Window for the create rate limit (1 hour). */
export const API_TOKEN_CREATE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

/** Max list-page loads per partner per hour. Per spec line 75. */
export const API_TOKEN_LIST_RATE_LIMIT_MAX_PER_PARTNER = 100

/** Window for the list rate limit (1 hour). */
export const API_TOKEN_LIST_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

/** How many recent audit rows to surface in the page-level audit
 *  strip (spec line 21 "Last token action: {time ago}"). Single
 *  row is enough for the strip; the modal is v2 territory. */
export const API_TOKEN_AUDIT_STRIP_LIMIT = 1

/** Status pill label + tone for the token list. A token is "active"
 *  when `revoked_at IS NULL AND (expires_at IS NULL OR expires_at >
 *  now())` — the derivation lives in `deriveApiTokenStatus` so the
 *  same rule is shared by the list + the create action. */
export const API_TOKEN_STATUS_LABEL = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
} as const

export type ApiTokenStatus = keyof typeof API_TOKEN_STATUS_LABEL