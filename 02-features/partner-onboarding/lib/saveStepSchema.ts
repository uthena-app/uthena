// saveStepSchema — pure Zod schemas + types for the saveStepAction
// server action (P12.2).
//
// Split from `actions/saveStep.ts` because Next.js `'use server'`
// files can ONLY export async functions. The pure schema + types
// + the per-step payload dispatcher live here so the call site is
// stable as slices 2-7 plug in their own Zod refinements.
//
// The contract:
//   - `SaveStepInput` validates the wire input — step ∈ [1, 7] +
//     optional `payload` object. Used by the action + tests.
//   - `payloadForStep(step)` returns the per-step Zod schema for the
//     payload body. Today every step accepts any object. Slices 2-7
//     tighten these in place (the function signature stays the same
//     so `saveStepAction` never needs to change).

import { z } from 'zod'
import {
  ONBOARDING_FIRST_STEP,
  ONBOARDING_TOTAL_STEPS,
} from '../queries/getMyOnboardingDraft'

/** Wire-input schema for `saveStep`. The step number is in the
 *  canonical 1..7 range; the payload is an object (its shape is
 *  step-specific, validated by `payloadForStep` if a slice ships a
 *  richer schema). Allowing `payload` to be optional lets the
 *  Welcome step save with no body (it has no fields). */
export const SaveStepInput = z.object({
  step: z
    .number()
    .int()
    .min(ONBOARDING_FIRST_STEP)
    .max(ONBOARDING_TOTAL_STEPS),
  payload: z.record(z.unknown()).optional(),
})

export type SaveStepInputT = z.infer<typeof SaveStepInput>

/** Action result. Typed union so callers can branch on
 *  `ok: false` without parsing stringly-typed errors. */
export type SaveStepResult =
  | { ok: true; savedAt: string; currentStep: number }
  | { ok: false; error: string; code: 'unauthenticated' | 'rate_limited' | 'invalid_input' | 'save_failed'; retryAfterSeconds?: number }

/** Pure helper: pick the Zod schema for the per-step payload.
 *  Today every step allows any object — slices 2-7 will tighten
 *  these in place. The helper exists now so the call site is
 *  stable across slices (no refactor of `saveStepAction` needed). */
export function payloadForStep(_step: number): z.ZodTypeAny {
  // Open shape: any object. Future slices tighten with Zod refinements
  // such as `bio` ≤ 500 chars, `paypal_email` matching an RFC-5322
  // regex, etc. We refuse `null` to keep the merge well-typed.
  return z.record(z.unknown()).optional()
}