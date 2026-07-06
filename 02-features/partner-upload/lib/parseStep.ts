// parseRequestedStep — coerce the `?step=N` URL param into a 1..N
// integer with a sane fallback to the draft's saved `currentStep`
// (or 1 when no draft yet).
//
// Pure: no I/O. P12.7 Slice 1 — page-level step navigation.
//
// Mirrors `02-features/partner-onboarding/lib/parseStep.ts` so the
// wizard's URL contract is consistent across partner surfaces:
//   /partner/upload                    → step = draft.currentStep or 1
//   /partner/upload?step=N             → step = N (within 1..5)
//   /partner/upload?step=N (invalid)   → step = draft.currentStep or 1
//
// Defensive against:
//   - Non-integer input (`'abc'`, `'1.5'`, `'-1'`, `''` → invalid)
//   - Out-of-range integers (`0`, `6`, `999` → invalid)
//   - SQL/shell injection attempts (`'1 OR 1=1'` → parses to 1, but
//     we're parsing to a bounded int so the result is the same as a
//     plain `?step=1` — harmless; no further interpretation happens)
//   - Whitespace, CRLF, leading zeros — `Number.parseInt('  3 ', 10)`
//     returns 3, which is acceptable.

import {
  UPLOAD_FIRST_STEP,
  UPLOAD_LAST_STEP,
  type UploadDraftResult,
} from '../queries/getMyUploadDraft'

/**
 * Resolve the URL `?step=N` param to a 1..N integer step number,
 * falling back to the draft's saved `currentStep` when invalid or
 * absent. When no draft exists yet, returns `UPLOAD_FIRST_STEP`.
 *
 * @param raw  The raw `searchParams.step` string (undefined if absent)
 * @param draft  The user's draft, already fetched in parallel
 * @returns An integer in [1, 5]
 */
export function parseRequestedUploadStep(
  raw: string | undefined,
  draft: UploadDraftResult,
): number {
  const parsed = parseUploadStepValue(raw)
  if (parsed !== null) return parsed

  // No URL param or invalid: resume at the draft's saved step.
  // Fresh visitor with no draft → Details (step 1).
  if (draft.exists) return draft.currentStep
  return UPLOAD_FIRST_STEP
}

/**
 * Parse a single raw string into an integer in the 1..5 range, or
 * null if invalid. Exported for unit tests + reused by future
 * surfaces (e.g. a deep-link helper).
 */
export function parseUploadStepValue(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null
  if (raw.length === 0) return null
  if (!/^-?\d+$/.test(raw)) return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isInteger(n)) return null
  if (n < UPLOAD_FIRST_STEP || n > UPLOAD_LAST_STEP) return null
  return n
}
