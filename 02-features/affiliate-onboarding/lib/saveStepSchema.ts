// saveStepSchema.ts — Zod schemas + typed results for the
// affiliate-onboarding saveStep server action.
//
// P13.1 Slice 1 — the contract that the server action enforces on
// every step save. The wizard has 6 steps; each writes to its OWN
// jsonb column on `affiliate_onboarding_drafts`:
//
//   welcome         → no payload (Step 1 is copy + Start button)
//   handle_bio      → { handle, bio?, avatar_storage_path? }
//   payout          → { paypal_email, paypal_email_confirm }
//   promo_methods   → { methods: ('twitter'|'youtube'|'blog'|
//                                'email_list'|'tiktok'|'linkedin'|
//                                'other')[], other_text? }
//   agreement       → { affiliate_terms_accepted, tos_accepted,
//                       accepted_at? }
//   submit          → no payload (server-side submit server action
//                     lands in Slice 2+)
//
// The saveStep server action picks the schema for the requested step
// via `payloadForStep()`. Steps with no payload (welcome, submit)
// accept `undefined` so the wizard can advance from step 1 without
// form data.
//
// All schemas are `.strict()` (top-level defense-in-depth — no
// unknown keys), match the spec's exact field names, and reject
// every value that wouldn't survive a JSON.stringify/parse
// round-trip. The handle is also reserved-list checked at the
// server action layer (after Zod parses the wire shape), reusing
// the canonical helpers from `00-foundations/auth/reserved-handles.ts`.

import { z } from 'zod'

// ----- Per-step payload schemas ------------------------------------------

/** Step 2 (handle_bio). The handle is the canonical public minishop URL
 *  segment; the bio is free-form prose; the avatar_storage_path is
 *  deferred to Slice 2 (when the Bunny upload pipeline lands). */
export const HandleBioPayload = z
  .object({
    handle: z
      .string()
      .min(3, 'Handle must be at least 3 characters.')
      .max(30, 'Handle must be 30 characters or fewer.')
      .regex(
        /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/,
        'Handle must be lowercase letters, digits, and hyphens; cannot start or end with a hyphen.',
      ),
    bio: z
      .string()
      .max(280, 'Bio must be 280 characters or fewer.')
      .optional(),
    // avatar_storage_path is deferred — Slice 2 adds the Bunny upload.
    // We accept it on the wire (so the eventual UI can save it) but
    // the action doesn't yet write it to Bunny or surface it.
    avatar_storage_path: z.string().max(512).optional(),
  })
  .strict()

/** Step 3 (payout). The PayPal email is verified client-side + the
 *  server re-checks equality on save (per spec acceptance criterion
 *  "PayPal email confirmation field must match the first entry
 *  (server-side check, not just client)"). */
export const PayoutPayload = z
  .object({
    paypal_email: z
      .string()
      .email('Enter a valid PayPal email.'),
    paypal_email_confirm: z
      .string()
      .email('Enter a valid PayPal email.'),
  })
  .strict()
  .refine((v) => v.paypal_email.toLowerCase() === v.paypal_email_confirm.toLowerCase(), {
    message: 'PayPal emails do not match.',
    path: ['paypal_email_confirm'],
  })

/** The 7 spec-allowed promo methods. `other` requires `other_text`;
 *  every other method does not. */
const PROMO_METHOD_VALUES = [
  'twitter',
  'youtube',
  'blog',
  'email_list',
  'tiktok',
  'linkedin',
  'other',
] as const

export type PromoMethod = (typeof PROMO_METHOD_VALUES)[number]

/** Step 4 (promo_methods). Per spec: "At least one optional — no
 *  enforcement, all checkboxes may be unchecked (this step is purely
 *  informational)". We DO NOT add a min(1) refine. */
export const PromoMethodsPayload = z
  .object({
    methods: z
      .array(z.enum(PROMO_METHOD_VALUES))
      .max(7, 'At most 7 methods.')
      .default([]),
    other_text: z.string().max(200, 'Other text must be 200 characters or fewer.').optional(),
  })
  .strict()

/** Step 5 (agreement). Both checkboxes must be true to enable Submit
 *  on step 6; the server action refuses the save otherwise. */
export const AgreementPayload = z
  .object({
    affiliate_terms_accepted: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the Affiliate Terms.' }),
    }),
    tos_accepted: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the Terms of Service.' }),
    }),
    // Optional timestamp set by the client at acceptance time; the
    // server overwrites it with `now()` for the canonical record.
    accepted_at: z.string().datetime().optional(),
  })
  .strict()

/** Map: step id → payload schema. Steps with no payload (welcome,
 *  submit) are explicitly mapped to a no-op schema so the action
 *  can always call `payloadForStep(step).safeParse(...)`. */
export const PAYLOAD_SCHEMAS = {
  welcome: z.undefined().optional(),
  handle_bio: HandleBioPayload,
  payout: PayoutPayload,
  promo_methods: PromoMethodsPayload,
  agreement: AgreementPayload,
  submit: z.undefined().optional(),
} as const

export type PayloadForStep<K extends keyof typeof PAYLOAD_SCHEMAS> = z.infer<
  (typeof PAYLOAD_SCHEMAS)[K]
>

// ----- saveStep wire schema ----------------------------------------------

/** The wire-format input the server action accepts.
 *  Accepts either a plain object (client-component path) or a
 *  FormData with a `step` field + a JSON-encoded `payload` string
 *  (progressive-enhancement path — no-JS users can still submit
 *  the wizard). */
export const SaveStepInput = z.object({
  step: z.enum([
    'welcome',
    'handle_bio',
    'payout',
    'promo_methods',
    'agreement',
    'submit',
  ]),
  payload: z.unknown().optional(),
})

export type SaveStepInputT = z.infer<typeof SaveStepInput>

/** Typed result the server action returns. The client branches on
 *  `ok`; on `ok: false` it surfaces `error` to the user.
 *
 *  The `handleConflict: true` flag is the unique handle-reservation
 *  conflict surface — the wizard keeps the user on step 2 and shows
 *  a friendly "this handle is taken" message. */
export type SaveStepResult =
  | {
      ok: true
      savedAt: string
      currentStep: SaveStepInputT['step']
    }
  | {
      ok: false
      error: string
      code:
        | 'unauthenticated'
        | 'rate_limited'
        | 'invalid_input'
        | 'submitted'
        | 'save_failed'
        | 'handle_conflict'
        | 'handle_reserved'
      retryAfterSeconds?: number
      handleConflict?: boolean
    }

/** Pick the right payload schema for the requested step. Steps
 *  without payloads accept `undefined` (or no payload key) so the
 *  wizard can advance from step 1 → step 2 (welcome → handle_bio)
 *  without requiring form data. */
export function payloadForStep<K extends keyof typeof PAYLOAD_SCHEMAS>(
  step: K,
): (typeof PAYLOAD_SCHEMAS)[K] {
  return PAYLOAD_SCHEMAS[step]
}