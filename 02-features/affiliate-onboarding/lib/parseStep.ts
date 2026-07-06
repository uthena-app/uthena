// parseStep.ts — coerce the `?step=<name>` URL param into a valid
// affiliate-onboarding step with a sane fallback to the draft's
// saved `currentStep` (or `FIRST_STEP` when no draft yet).
//
// P13.1 Slice 1 — page-level step navigation.
//
// Why this matters:
//   - The wizard's URL is `/affiliate/onboarding?step=<name>` (spec
//     §"Open onboarding"). The step name is one of the named enum
//     values: `welcome` | `handle_bio` | `payout` | `promo_methods`
//     | `agreement` | `submit`. The page must NEVER trust the URL
//     literally — an attacker could send `?step=../admin`,
//     `?step=javascript:alert(1)`, `?step=` (empty), etc. Each is
//     rejected here.
//   - The `currentStep` from the user's draft is the lowest-friction
//     resume point — when `?step=` is absent or unparseable, we land
//     on the draft's saved step so a returning user picks up where
//     they left off.
//   - When no draft exists yet (first visit), we default to
//     `FIRST_STEP` (`welcome`).
//
// Defensive against:
//   - Unknown step names (`?step=foo` → invalid → fallback to draft).
//   - Empty / whitespace-only input.
//   - CRLF / control characters / RTL-override / zero-width tricks.
//   - Unicode-digit confusables (e.g. Cyrillic `о` for `o`).
//   - URL-encoded bypass attempts (the parser runs on the already-
//     decoded string, so `%0A` arrives as `\n` and is rejected).
//   - SQL/shell injection attempts (the result is one of 6 enum values;
//     no further interpretation happens downstream).
//
// Hard rule from QWEN.md §1: "validate input before the DB call" —
// the router writes nothing to disk, but treats the URL param as
// user-controlled input. This function is the parse boundary.

import {
  FIRST_STEP,
  ALL_STEPS,
  type AffiliateOnboardingDraftResult,
  type AffiliateOnboardingStep,
} from '../queries/getMyOnboardingDraft'

/** Resolve the URL `?step=<name>` param to a valid named step,
 *  falling back to the draft's saved `currentStep` when invalid
 *  or absent. When no draft exists yet, returns `FIRST_STEP`. */
export function parseRequestedStep(
  raw: string | undefined,
  draft: AffiliateOnboardingDraftResult,
): AffiliateOnboardingStep {
  const parsed = parseStepValue(raw)
  if (parsed !== null) return parsed

  // No URL param or invalid: resume at the draft's saved step.
  // Fresh visitor with no draft → Welcome.
  if (draft.exists) return draft.currentStep
  return FIRST_STEP
}

/** Parse a single raw string into a valid named step, or null if
 *  invalid. Exported for unit tests + reused by future surfaces
 *  (e.g. a deep-link helper). */
export function parseStepValue(
  raw: string | undefined | null,
): AffiliateOnboardingStep | null {
  if (raw === undefined || raw === null) return null
  if (raw.length === 0) return null

  // Length guard — every enum value is short. Anything > 32 chars is
  // not a real step name (the longest is 'promo_methods' = 13).
  if (raw.length > 32) return null

  // ASCII-only (no Unicode-digit confusables, no RTL-override tricks).
  if (!/^[a-z_]+$/.test(raw)) return null

  if (ALL_STEPS.has(raw as AffiliateOnboardingStep)) {
    return raw as AffiliateOnboardingStep
  }
  return null
}