// VideoPlayer.types.ts — shared types + pure helpers for the
// VideoPlayer client island. Kept separate from the React component so
// the helpers can be unit-tested without rendering React (P7.6 —
// mobile player).
//
// Why split the helpers out:
//   - formatTime / parseTime / isHlsSrc / nativeHlsSupport are pure
//     and stable — they deserve their own module so a future admin /
//     embed / preview surface can import them without pulling the
//     13 KB of client React + hls.js wiring.
//   - The types are the contract between the parent (the future
//     `/library/watch/[lessonId]` page from P15.2) and the player
//     island. Keeping them in one file makes the contract greppable.
//
// No 'use client' here — this module is pure data + functions. Safe to
// import from RSC + tests + future Storybook without setup.

/**
 * Quality preset (HLS level or fallback UI option).
 *
 * The `id` is opaque to the consumer — `hls.js` returns numeric level
 * indexes from its `levels` array; the player maps them to these
 * presets via the `height` field. `id === 'auto'` is the default —
 * hls.js picks the level based on bandwidth.
 */
export type VideoPlayerQuality = {
  /** 'auto' = let hls.js pick; otherwise the level id to pin to. */
  id: string
  /** Display label, e.g. "Auto" / "720p" / "1080p". */
  label: string
  /** HLS level height (px) — used to match the player's preset list to hls.js's reported levels. */
  height?: number
}

/**
 * Captions track (WebVTT).
 *
 * `label` is the human-readable language name shown in the captions
 * button tooltip + the native `<track>` element's `label` attribute
 * (the latter is what screen readers + the browser's captions menu
 * surfaces to the user).
 */
export type VideoPlayerCaptions = {
  src: string
  lang: string
  label: string
}

/**
 * Props for the `<VideoPlayer>` client island.
 *
 * Minimal contract: `src` is required, everything else is optional.
 * The component is mountable in any RSC page that has a video URL
 * (the future `/library/watch/[lessonId]` page passes the signed HLS
 * URL from `mintStreamUrlAction`; a marketing / preview page passes
 * a public MP4).
 */
export type VideoPlayerProps = {
  /** Video URL — MP4 (progressive) or HLS (.m3u8). */
  src: string
  /** Poster image URL — shown before play starts. */
  poster?: string
  /** Optional captions track (WebVTT). */
  captions?: VideoPlayerCaptions
  /**
   * Optional quality preset list. When omitted, the player shows a
   * single "Auto" option (correct behavior for MP4 sources that
   * have only one bitrate). When provided, each preset's `height`
   * is matched against hls.js's reported levels.
   */
  qualities?: VideoPlayerQuality[]
  /** Accessible name for the `<video>` element (used as aria-label). */
  title?: string
  /** Auto-play on mount. Default false — most browsers block autoplay anyway. */
  autoPlay?: boolean
  /** Start muted (required by some browsers' autoplay policies). */
  muted?: boolean
  /** Initial playback rate. Default 1. */
  initialPlaybackRate?: number
  /**
   * Optional initial seek position (seconds). When provided, the player
   * jumps to this offset once the video's metadata is loaded — the
   * canonical "Resume at 8:32" UX. Must be a finite, non-negative
   * number; the parent should pass the result of `parseResumeSeconds`
   * rather than raw URL input so a tampered `?t=` can't seek to
   * arbitrary positions or NaN-out the player. Default: undefined
   * (start at 0).
   */
  initialSeekSeconds?: number
  /**
   * Optional progress callback. Called on `timeupdate` (browser fires
   * every 250ms during playback). Receives (positionSeconds, durationSeconds).
   * Used by LMS to debounce-save progress every 5 seconds.
   */
  onTimeUpdate?: (positionSeconds: number, durationSeconds: number) => void
  /**
   * Optional ended callback. Called when `ended` fires.
   * Used by LMS to mark the lesson complete.
   */
  onEnded?: (durationSeconds: number) => void
  /** Optional class on the outer container. */
  className?: string
}

/**
 * Internal state of the player — exported for the test file so unit
 * tests can exercise the pure helpers without spinning up React.
 */
export type VideoPlayerState = {
  isPlaying: boolean
  currentTime: number
  duration: number
  muted: boolean
  volume: number
  captionsEnabled: boolean
  playbackRate: number
  qualityId: string
  showControls: boolean
  isFullscreen: boolean
  hasError: boolean
  errorMessage: string | null
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                       */
/* ------------------------------------------------------------------ */

/** True when the URL ends in `.m3u8` (case-insensitive). */
export function isHlsSrc(src: string): boolean {
  return /\.m3u8(\?|$)/i.test(src)
}

/**
 * Format seconds as `M:SS` or `H:MM:SS`.
 *
 * Defensive against bad input: `NaN` / `Infinity` / `null` /
 * `undefined` / negative → "0:00". Stable for input < 1 hour:
 * always 2 digits on the seconds; minutes can be 1+ digits. For
 * input >= 1 hour, adds a 2-digit hours prefix.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = s.toString().padStart(2, '0')
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${ss}`
  }
  return `${m}:${ss}`
}

/**
 * Default playback-rate presets. The set is intentionally narrow —
 * 0.5x for re-watching dense sections, 2x for skimming.
 *
 * `Object.freeze` (not just `as const`) so the array is genuinely
 * immutable at runtime — a defensive guard against a future caller
 * doing `PLAYBACK_RATES.push(3)` somewhere.
 */
export const PLAYBACK_RATES: ReadonlyArray<number> = Object.freeze([
  0.5,
  0.75,
  1,
  1.25,
  1.5,
  2,
] as const)

/**
 * Default quality presets — the "Auto" sentinel plus the standard
 * YouTube-style tiers. Callers can pass their own shorter list.
 */
export const DEFAULT_QUALITIES: ReadonlyArray<VideoPlayerQuality> = [
  { id: 'auto', label: 'Auto' },
  { id: '1080p', label: '1080p', height: 1080 },
  { id: '720p', label: '720p', height: 720 },
  { id: '480p', label: '480p', height: 480 },
  { id: '360p', label: '360p', height: 360 },
] as const

/**
 * Detect native HLS support via the `<video>` element's
 * `canPlayType` API. Safari + iOS Safari return `'probably'` /
 * `'maybe'`; Chrome / Firefox / Edge return `''`.
 *
 * Defensive — never throws. Falls back to "no native support" when
 * no DOM is available (e.g. server-side import).
 */
export function nativeHlsSupport(): boolean {
  if (typeof document === 'undefined') return false
  const v = document.createElement('video')
  return Boolean(v.canPlayType('application/vnd.apple.mpegurl'))
}

/**
 * Build the HLS quality preset list from hls.js's reported levels.
 * The "Auto" sentinel is always prepended. Levels with `height === 0`
 * (audio-only / unknown) are skipped — they would render as "Auto p"
 * and confuse users.
 */
export function buildQualityPresets(
  levels: ReadonlyArray<{ height?: number; bitrate?: number }>,
): VideoPlayerQuality[] {
  const presets: VideoPlayerQuality[] = [{ id: 'auto', label: 'Auto' }]
  const seen = new Set<number>()
  for (const lvl of levels) {
    const h = lvl.height ?? 0
    if (h <= 0 || seen.has(h)) continue
    seen.add(h)
    presets.push({ id: `${h}p`, label: `${h}p`, height: h })
  }
  // Sort non-auto presets by height descending so 1080p > 720p > 480p.
  presets.sort((a, b) => {
    if (a.id === 'auto') return -1
    if (b.id === 'auto') return 1
    return (b.height ?? 0) - (a.height ?? 0)
  })
  return presets
}

/**
 * Compute the keyboard-seek step for a given key. Returns the seconds
 * to jump (positive = forward, negative = back) or `null` if the key
 * is not handled.
 *
 * Handled keys:
 *   - ArrowLeft / ArrowRight → ±5s
 *   - j / J / l / L → ±10s (YouTube-style)
 *   - k / K → toggle play/pause
 *   - m / M → toggle mute
 *   - f / F → toggle fullscreen
 *   - c / C → toggle captions
 *   - 0..9 → jump to 0% / 10% / ... / 90% (0 alone = 0%)
 *
 * Modifier-held keys (ctrl/alt/meta) are ignored so browser shortcuts
 * (Ctrl+R reload, etc.) still work.
 */
export type KeySeekResult = number | 'play' | 'mute' | 'fullscreen' | 'captions' | null
export function keyToAction(key: string): KeySeekResult {
  // Skip if any modifier is held — browser shortcuts stay intact.
  if (key.length > 1) {
    // Multi-char keys: ArrowLeft / ArrowRight only.
    if (key === 'ArrowLeft') return -5
    if (key === 'ArrowRight') return 5
    return null
  }
  const k = key.toLowerCase()
  if (k === ' ') return 'play'
  if (k === 'k') return 'play'
  if (k === 'j') return -10
  if (k === 'l') return 10
  if (k === 'm') return 'mute'
  if (k === 'f') return 'fullscreen'
  if (k === 'c') return 'captions'
  if (k >= '0' && k <= '9') {
    return k === '0' ? 0 : Number(k) / 10 // 1..9 = 10%..90%
  }
  return null
}

/**
 * P7.5 — Resume-from-URL helper.
 *
 * Parse the `?t=<seconds>` URL param (the YouTube / Vimeo convention)
 * into a validated seek offset for `<VideoPlayer initialSeekSeconds>`.
 *
 * Accepts:
 *   - `'0'`, `'42'`, `'512.5'` → finite seconds ≥ 0
 *   - URL-encoded forms (`'%2D1'` for `'-1'`, `%2B` for `+`)
 *
 * Rejects (returns `null`):
 *   - Missing / undefined / null / empty string
 *   - Non-numeric strings ('abc', '5min', '8m32s')
 *   - Negative seconds (would mean "seek before the start")
 *   - Non-finite values (NaN, Infinity)
 *   - Scientific-notation overflow past `Number.MAX_SAFE_INTEGER`
 *     (mirrors the rest of the URL-param hardening pattern in the
 *     account surface — see `parseOrderId` / `parseRefundId`)
 *
 * Cap (12 hours = 43,200 seconds) — the longest video on the catalog
 * is well under 4h, but a tampered `?t=999999999` should not produce
 * a NaN / Infinity that the player's `loadedmetadata` handler can't
 * reason about. The cap mirrors the spec's "watch-page < 1.5s p95 for
 * first frame" budget — videos that exceed it are a data-shape bug,
 * not a normal catalog entry.
 *
 * Defensive against any input the URL layer might surface: the
 * caller can pass `searchParams.get('t')` directly without pre-checks.
 */
export const RESUME_SECONDS_MAX = 12 * 60 * 60 // 43,200 seconds

export function parseResumeSeconds(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  // Tight numeric check: optional minus + digits + optional fractional.
  // Rejects scientific notation, hex, leading whitespace, signed values.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0 || n > RESUME_SECONDS_MAX) return null
  // Floor to whole seconds — fractional seek targets don't make sense
  // for resume (the saved position is always whole-second). Returns
  // 0 for `parseResumeSeconds('0')` so the parent doesn't have to
  // special-case zero (it just passes 0 to the player, which seeks
  // to start, which is a no-op).
  return Math.floor(n)
}