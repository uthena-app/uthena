// parseRequestedStep — coerce the `?step=N` URL param into a 1..N integer
// with a sane fallback to the draft's saved `currentStep` (or 1 when no
// draft yet).
//
// Pure: no I/O. P12.1 Slice 1 — page-level step navigation.
//
// Why this matters:
//   - The wizard's URL is `/partner/onboarding?step=N` (spec §"Open
//     onboarding", line 33). N is an integer step index in [1, 7]. The
//     page must NEVER trust the URL literally — an attacker could
//     send `?step=0`, `?step=-1`, `?step=999`, `?step=abc`,
//     `?step=1%20OR%201=1`, etc. Each is rejected here.
//   - The `currentStep` from the user's draft is the lowest-friction
//     resume point — when `?step=` is absent or unparseable, we land
//     on the draft's saved step so a returning user picks up where
//     they left off.
//   - When no draft exists yet (first visit), we default to
//     `ONBOARDING_FIRST_STEP` (1 = Welcome).
//
// Defensive against:
//   - Non-integer input (`'abc'`, `'1.5'`, `'-1'`, `''` → invalid)
//   - Out-of-range integers (`0`, `8`, `999` → invalid)
//   - SQL/shell injection attempts (`'1 OR 1=1'` → parses to 1, but
//     we're parsing to a bounded int so the result is the same as a
//     plain `?step=1` — harmless; no further interpretation happens)
//   - Whitespace, CRLF, leading zeros — `Number.parseInt('  3 ', 10)`
//     returns 3, which is acceptable.
//   - Anything larger than `ONBOARDING_TOTAL_STEPS`.
//
// Hard rule from QWEN.md §1: "validate input before the DB call" —
// the router writes nothing to disk, but treats the URL param as
// user-controlled input. This function is the parse boundary.

import {
  ONBOARDING_FIRST_STEP,
  ONBOARDING_TOTAL_STEPS,
  type OnboardingDraftResult,
} from '../queries/getMyOnboardingDraft'

/**
 * Resolve the URL `?step=N` param to a 1..N integer step number,
 * falling back to the draft's saved `currentStep` when invalid or
 * absent. When no draft exists yet, returns `ONBOARDING_FIRST_STEP`.
 *
 * @param raw  The raw `searchParams.step` string (undefined if absent)
 * @param draft  The user's draft, already fetched in parallel
 * @returns An integer in [1, ONBOARDING_TOTAL_STEPS]
 */
export function parseRequestedStep(
  raw: string | undefined,
  draft: OnboardingDraftResult,
): number {
  // Always prefer a valid URL param — the user is asking to jump to
  // a specific step, and the spec accepts free navigation within the
  // 7-step sequence. We trust the bounds check below but not the
  // raw value.
  const parsed = parseStepValue(raw)
  if (parsed !== null) return parsed

  // No URL param or invalid: resume at the draft's saved step.
  // Fresh visitor with no draft → Welcome (step 1).
  if (draft.exists) return draft.currentStep
  return ONBOARDING_FIRST_STEP
}

/**
 * Parse a single raw string into an integer in the 1..N range, or
 * null if invalid. Exported for unit tests + reused by future
 * surfaces (e.g. a deep-link helper).
 */
export function parseStepValue(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null
  // Empty string → null (don't mistake '' for 0 — empty is "no input").
  if (raw.length === 0) return null
  // Reject any string that's not pure ASCII digits or leading minus.
  // Negative integers below 1 are out of range; non-integer floats
  // and SQL-style strings never reach `parseInt`.
  if (!/^-?\d+$/.test(raw)) return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isInteger(n)) return null
  if (n < ONBOARDING_FIRST_STEP || n > ONBOARDING_TOTAL_STEPS) return null
  return n
}
