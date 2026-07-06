// Duration formatter — pure helper. Converts seconds (the canonical
// unit on `products.total_duration_seconds` and the
// `products.curriculum[i].duration_seconds` JSONB column) into the
// compact display format the mockup uses: "12m" / "1h 23m" / "45s".
//
// Three rules:
//   1. Below 60 seconds → "Ns" (e.g. "45s").
//   2. Below 60 minutes → "Nm" (e.g. "12m").
//   3. 60+ minutes → "Nh MMm" (e.g. "1h 23m", "4h 38m"). Always pads
//      the minute slot to 2 digits when hours > 0 so the visual rhythm
//      matches the mockup's `.curric .row .dur`.
//
// Defensive against bad input: any non-finite / negative / NaN value
// returns "0m" instead of throwing or producing "NaNm".

/** Hard cap on seconds — guards against absurd values from a partner typo. */
const MAX_SECONDS = 60 * 60 * 24 * 30 // 30 days

/**
 * Format a duration in seconds as the mockup's compact "12m" / "1h 23m"
 * form. Negative / NaN / non-finite inputs become "0m". Values above
 * 30 days are clipped to "720h 0m" to keep the layout sane.
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0m'
  }
  const seconds = Math.min(Math.floor(totalSeconds), MAX_SECONDS)
  if (seconds < 60) return `${seconds}s`
  const totalMinutes = Math.floor(seconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}