// 02-features/partner-portal/api-tokens/lib/schemas.ts — P12.19.
//
// Zod schemas for the partner API tokens feature.
//
// Two surfaces:
//   1. Wire-format inputs for the server actions
//      (CreateApiTokenInput + RevokeApiTokenInput).
//   2. Display-shape readers — the `ApiTokenEntitySchema` is what the
//      query maps raw rows into (defensive parsing for the list page).
//
// All schemas are `.strict()` at the top level — a stale client
// sending extra fields is rejected at the parse boundary.
//
// Why a local module instead of `00-foundations/data/schemas.ts`:
// the action inputs are partner-specific (the api tokens surface is
// a partner-portal concern, not a foundation concern) and the
// display-shape reader mirrors the existing
// `getMyPartnerProfile.test.ts` defensive-mapping pattern. Keeping
// them close to the action makes the contract visible.

import { z } from 'zod'
import {
  API_TOKEN_NAME_MAX_LENGTH,
  API_TOKEN_NAME_MIN_LENGTH,
  API_TOKEN_SCOPES,
  type ApiTokenScope,
} from '../constants'

// Re-export the type so existing callers that imported
// `ApiTokenScope` from `lib/schemas` keep working.
export type { ApiTokenScope } from '../constants'

/** Create flow — partner-supplied fields for a new token. The
 *  `name` + `scopes` + `expirationDays` trio comes from the modal;
 *  the plaintext + hash + token_prefix are server-side generated and
 *  returned separately (not in the input). */
export const CreateApiTokenInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(API_TOKEN_NAME_MIN_LENGTH, 'Name is required')
      .max(
        API_TOKEN_NAME_MAX_LENGTH,
        `Name must be ${API_TOKEN_NAME_MAX_LENGTH} characters or fewer`,
      ),
    scopes: z
      .array(z.enum(API_TOKEN_SCOPES))
      .min(1, 'Pick at least one scope')
      .max(API_TOKEN_SCOPES.length),
    /**
     * Days until expiration. `null` means "never expires". Mirrors
     * the radio options in the create modal. The server derives
     * `expires_at = created_at + expirationDays * 86400 seconds`.
     */
    expirationDays: z
      .union([z.literal(30), z.literal(90), z.literal(365), z.null()])
      .nullable(),
    /** Typed confirmation that the partner has read the one-time-show
     *  warning. The create modal sets this to true on submit so the
     *  server never accidentally returns the plaintext without the
     *  partner acknowledging the warning. */
    acknowledgedOneTimeShow: z.literal(true),
  })
  .strict()

export type CreateApiTokenInput = z.infer<typeof CreateApiTokenInputSchema>

/** Revoke flow — minimal input. The partner must type the literal
 *  string "REVOKE" before the action runs (matches the spec line 77
 *  "Revoke requires typed confirmation"). */
export const RevokeApiTokenInputSchema = z
  .object({
    tokenId: z
      .string()
      .regex(/^[0-9]+$/, 'Invalid token id')
      .transform((s) => Number(s)),
    confirmation: z.literal('REVOKE'),
  })
  .strict()

export type RevokeApiTokenInput = z.infer<typeof RevokeApiTokenInputSchema>

/**
 * Display-shape reader for one `api_tokens` row, as consumed by the
 * page list. The query maps the raw row into this shape (never
 * selects `token_hash` — see `getMyApiTokens.ts` for the PII-safe
 * select).
 *
 * Status derivation: a row is `active` when `revoked_at IS NULL AND
 * (expires_at IS NULL OR expires_at > now())`. Revoked and expired
 * are derived from `revoked_at` + `expires_at` respectively. The
 * computed `status` field is what the UI renders.
 */
export const ApiTokenEntitySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)),
  tokenPrefix: z.string(), // e.g. "uth_pat_a1b2c3d4***" — UI display only
  createdAt: z.string(), // ISO
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  /** Derived status — see module header. */
  status: z.enum(['active', 'revoked', 'expired']),
})

export type ApiTokenEntity = z.infer<typeof ApiTokenEntitySchema>