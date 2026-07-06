// Password strength meter — shared helper used by SignUpForm + UpdatePasswordForm.
// Pure JS, no client-only deps, so this module has no `'use client'` directive
// and can be imported by both client components.

/**
 * Compute a coarse password strength (0..4) from the rules already
 * enforced by the server-side Zod schema. Cheap, deterministic, no
 * dictionary dependency. Returns a tuple of [score, label]:
 *
 *   0 → too short (< 10 chars)        → "too short"
 *   1 → length OK but missing variety → "weak"
 *   2 → length + 2 variety classes    → "ok"
 *   3 → length + 3 variety classes    → "good"
 *   4 → length + 3 classes + ≥ 14 chars → "strong"
 *
 * The labels match the meter colors: gray (0) → red (1) → amber (2)
 * → teal (3) → green (4). When the password is empty, returns null
 * so the meter can stay hidden (no premature feedback on first load).
 */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } | null {
  if (!pw) return null
  const length = pw.length
  if (length < 10) return { score: 0, label: 'too short' }
  const hasUpper = /[A-Z]/.test(pw)
  const hasLower = /[a-z]/.test(pw)
  const hasDigit = /[0-9]/.test(pw)
  const hasSymbol = /[^A-Za-z0-9]/.test(pw)
  const variety = [hasUpper, hasLower, hasDigit, hasSymbol].filter(Boolean).length
  if (variety >= 4 && length >= 14) return { score: 4, label: 'strong' }
  if (variety >= 3) return { score: 3, label: 'good' }
  if (variety >= 2) return { score: 2, label: 'ok' }
  return { score: 1, label: 'weak' }
}
