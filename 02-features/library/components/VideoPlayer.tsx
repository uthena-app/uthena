// VideoPlayer.tsx — client island for the responsive video player.
// Self-contained, drop-in component for any RSC page that has a video
// URL (the future `/library/watch/[lessonId]` page from P15.2 passes
// the signed HLS URL from `mintStreamUrlAction`; a marketing /
// preview page passes a public MP4).
//
// What this component is NOT:
//   - It is NOT the watch-page shell (lesson list + tabs + Q&A). That's
//     P15.2.
//   - It is NOT the LMS progress-tracking surface. That's P15.4.
//   - It does NOT auto-resume from the last position — the parent
//     page passes `initialPlaybackRate` if it wants a non-default
//     rate, but seek-position is the parent's job. (Phase 15 wires
//     `timeupdate` debouncing; this component fires `onTimeUpdate`
//     so the parent can write progress.)
//
// Architecture (P7.6 — mobile player):
//   - 16:9 aspect-ratio container that fills the parent width.
//     Responsive: full-width on mobile, capped at the container's
//     max-width on desktop (the parent's job to constrain).
//   - Native `<video controls={false}>` so we render our own
//     controls. Native controls don't work in fullscreen on iOS
//     Safari and don't match the design system.
//   - HLS via hls.js (top-level import — the bundle is only loaded
//     on `/library/watch/...`, not on `/library`).
//   - Token-only CSS module (no inline colors, no magic hex).
//   - Custom overlay controls with auto-hide (3s of inactivity).
//   - Keyboard shortcuts (Space, ←/→, j/l, k, m, f, c, 0-9) wired
//     via a `keydown` listener on the container.
//   - Fullscreen via the native Fullscreen API.
//   - Captions via `<track kind="subtitles">` + `track.mode` toggle.
//   - Playback rate via `video.playbackRate` + the standard 6-preset
//     set (0.5 / 0.75 / 1 / 1.25 / 1.5 / 2).
//   - Quality switcher via the QUALITIES dropdown — for HLS sources,
//     the available presets are derived from hls.js's reported levels
//     via `buildQualityPresets`. For MP4 sources with a single
//     bitrate, the dropdown hides itself.
//
// Mobile-first design notes (why this is "mobile player" and not
// just "player"):
//   - 44×44px touch targets on every control (Apple HIG minimum).
//   - Center play/pause tap area is the entire video surface (not
//     just a button) — easier on small screens.
//   - Auto-hide delay is 3s (matches YouTube mobile, not 2s like
//     desktop players which feels too fast on touch).
//   - Captions + quality + rate dropdowns use native `<select>` (not
//     custom popovers) — the platform picker is the right UX on
//     iOS/Android, and keyboard-navigable on desktop.
//   - The volume slider is desktop-only (mobile devices use the
//     hardware volume buttons — no in-page slider is the iOS
//     convention since iOS 13).

'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import Hls from 'hls.js'
import {
  buildQualityPresets,
  DEFAULT_QUALITIES,
  formatTime,
  isHlsSrc,
  keyToAction,
  nativeHlsSupport,
  PLAYBACK_RATES,
  type VideoPlayerProps,
  type VideoPlayerQuality,
} from './VideoPlayer.types'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'library.VideoPlayer' })
import styles from './VideoPlayer.module.css'

const AUTO_HIDE_MS = 3000

export function VideoPlayer({
  src,
  poster,
  captions,
  qualities,
  title,
  autoPlay = false,
  muted = false,
  initialPlaybackRate = 1,
  initialSeekSeconds,
  className,
  onTimeUpdate,
  onEnded,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ----- UI state -----
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [mutedState, setMutedState] = useState(muted)
  const [volume, setVolume] = useState(1)
  const [captionsEnabled, setCaptionsEnabled] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(initialPlaybackRate)
  const [qualityId, setQualityId] = useState<string>('auto')
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [availableLevels, setAvailableLevels] = useState<VideoPlayerQuality[]>([])
  const [buffered, setBuffered] = useState(0)

  // ----- Derived: which quality list to show in the dropdown -----
  // For HLS sources, prefer the dynamically reported levels (from
  // hls.js's LEVELS event). For MP4 or when the HLS event hasn't
  // fired yet, fall back to the explicit `qualities` prop, then
  // to DEFAULT_QUALITIES (which collapses to a single "Auto" option
  // for MP4 with no level selection needed).
  const qualityOptions: ReadonlyArray<VideoPlayerQuality> = useMemo(() => {
    if (availableLevels.length > 1) return availableLevels
    if (qualities && qualities.length > 0) return qualities
    return DEFAULT_QUALITIES
  }, [availableLevels, qualities])

  // Whether to show the quality dropdown at all. Hide when only the
  // "Auto" option is available (single-bitrate MP4 / no levels yet).
  const showQualityDropdown = qualityOptions.length > 1

  // ----- HLS attach / detach lifecycle -----
  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    setHasError(false)
    setErrorMessage(null)
    setBuffered(0)
    setAvailableLevels([])

    // Always tear down the previous Hls instance before re-attaching.
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    const isHls = isHlsSrc(src)
    const nativeSupport = isHls ? nativeHlsSupport() : false

    if (isHls && !nativeSupport && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true })
      hlsRef.current = hls
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        setAvailableLevels(buildQualityPresets(data.levels))
      })
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        // Sync our "selected quality" state with hls.js's current level
        // — keeps the dropdown in step with the actual playback.
        // `data.level` is the index into the Hls instance's `levels`
        // array (NOT data.levels — that field doesn't exist on
        // LevelSwitchedData).
        const idx = data.level
        const lvl = hls.levels[idx]
        if (lvl?.height) setQualityId(`${lvl.height}p`)
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setHasError(true)
          setErrorMessage(
            `Streaming error: ${data.type ?? 'unknown'} — ${data.details ?? 'no detail'}`,
          )
        }
      })
    } else {
      // MP4 or natively-supported HLS (Safari) — direct attach.
      video.src = src
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [src])

  // ----- Video event listeners (state sync) -----
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)
      const dur = Number.isFinite(video.duration) ? video.duration : 0
      onTimeUpdate?.(video.currentTime, dur)
    }
    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
    }
    const onVolumeChange = () => {
      setMutedState(video.muted)
      setVolume(video.volume)
    }
    const onProgress = () => {
      if (video.buffered.length > 0) {
        // `buffered.end()` may return undefined when the TimeRanges
        // is empty (per the HTMLMediaElement spec). Guard so TS is happy
        // and we don't write NaN to state.
        const end = video.buffered.end(video.buffered.length - 1)
        if (typeof end === 'number' && Number.isFinite(end)) setBuffered(end)
      }
    }
    const onError = () => {
      setHasError(true)
      const code = video.error?.code
      const message =
        code === MediaError.MEDIA_ERR_NETWORK
          ? 'Network error — could not load video.'
          : code === MediaError.MEDIA_ERR_DECODE
            ? 'Decode error — the video file may be corrupted.'
            : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
              ? 'This video format is not supported by your browser.'
              : 'Could not play this video.'
      setErrorMessage(message)
    }
    const handleEnded = () => {
      setIsPlaying(false)
      const dur = Number.isFinite(video.duration) ? video.duration : 0
      onEnded?.(dur)
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('progress', onProgress)
    video.addEventListener('error', onError)
    video.addEventListener('ended', handleEnded)

    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('volumechange', onVolumeChange)
      video.removeEventListener('progress', onProgress)
      video.removeEventListener('error', onError)
      video.removeEventListener('ended', handleEnded)
    }
  }, [onTimeUpdate, onEnded])

  // ----- Sync controlled props back to the video element -----
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = mutedState
  }, [mutedState])

  // ----- P7.5 Slice 1: resume from initialSeekSeconds -----
  // Fires ONCE per (src, initialSeekSeconds) tuple, the first time the
  // video has a finite duration AND `initialSeekSeconds` is a valid
  // offset (≥ 0, < duration). Defensive against the video not loading
  // metadata yet, the duration being Infinity (live streams), and
  // `initialSeekSeconds` being larger than the video — in all three
  // cases the effect is a no-op so the user lands at 0.
  const seekAppliedRef = useRef<string | null>(null)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (initialSeekSeconds === undefined || initialSeekSeconds === null) return
    if (!Number.isFinite(initialSeekSeconds) || initialSeekSeconds < 0) return
    if (!Number.isFinite(duration) || duration <= 0) return
    // Guard against double-application: only seek the first time this
    // exact (src, initialSeekSeconds) pair becomes ready.
    const key = `${src}::${initialSeekSeconds}`
    if (seekAppliedRef.current === key) return
    // Clamp to duration - 0.1s so a "resume at end" doesn't land past
    // the EOF (which can stall the player on some browsers).
    const target = Math.min(initialSeekSeconds, Math.max(0, duration - 0.1))
    if (target <= 0) return // seeking to start is a no-op
    try {
      video.currentTime = target
      seekAppliedRef.current = key
      log.info(
        { src_kind: isHlsSrc(src) ? 'hls' : 'mp4', seek_to_s: target, duration_s: duration },
        'resumed playback at initialSeekSeconds',
      )
    } catch {
      // Some browsers throw if the metadata hasn't fully loaded yet —
      // safe to ignore; the next `loadedmetadata` won't fire (this is
      // the only handler we have), so we silently no-op. The parent
      // re-renders on duration change will retry if needed.
    }
  }, [src, initialSeekSeconds, duration])

  // ----- Fullscreen sync (browser-side state + ours) -----
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // ----- Auto-hide controls timer -----
  const armHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (!isPlaying) return // Always show during pause / before play
    hideTimerRef.current = setTimeout(() => setShowControls(false), AUTO_HIDE_MS)
  }, [isPlaying])

  useEffect(() => {
    armHideTimer()
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [armHideTimer, currentTime, isPlaying])

  // ----- Action handlers -----
  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }, [])

  const seekBy = useCallback((deltaSeconds: number) => {
    const video = videoRef.current
    if (!video) return
    const next = Math.max(0, Math.min(video.duration || 0, video.currentTime + deltaSeconds))
    video.currentTime = next
  }, [])

  const seekToFraction = useCallback((fraction: number) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) return
    video.currentTime = Math.max(0, Math.min(video.duration, video.duration * fraction))
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      // Fullscreen requests can fail (user denied, iframe without
      // allow attribute, browser doesn't support it). Silently no-op
      // rather than crashing the player.
    }
  }, [])

  const toggleCaptions = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.textTracks.length) return
    const next = !captionsEnabled
    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i]
      if (track) track.mode = next ? 'showing' : 'hidden'
    }
    setCaptionsEnabled(next)
  }, [captionsEnabled])

  const onQualityChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value
      setQualityId(id)
      const hls = hlsRef.current
      if (!hls) return
      if (id === 'auto') {
        hls.currentLevel = -1
        return
      }
      const preset = qualityOptions.find((q) => q.id === id)
      const targetHeight = preset?.height
      if (targetHeight) {
        const idx = hls.levels.findIndex((l) => l.height === targetHeight)
        if (idx >= 0) hls.currentLevel = idx
      }
    },
    [qualityOptions],
  )

  const onRateChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    const rate = Number(e.target.value)
    setPlaybackRate(rate)
  }, [])

  const onVolumeChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    const video = videoRef.current
    if (!video) return
    video.volume = Math.max(0, Math.min(1, v))
    if (v > 0 && video.muted) video.muted = false
  }, [])

  const onSeekInput = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) return
    video.currentTime = (Number(e.target.value) / 100) * video.duration
  }, [])

  // ----- Tap-to-toggle controls on touch / mouse -----
  const onSurfaceClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      // Don't toggle on the controls bar itself (only on the bare video
      // surface — a click on a button bubbles up and we want the button
      // to handle it, not the surface).
      const target = e.target as HTMLElement
      if (target.closest(`.${styles.controls}`) || target.closest(`.${styles.error}`)) return
      if (!showControls) {
        setShowControls(true)
      } else {
        togglePlay()
      }
    },
    [showControls, togglePlay],
  )

  const onSurfaceMouseMove = useCallback(() => {
    setShowControls(true)
  }, [])

  // ----- Keyboard shortcuts -----
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      const action = keyToAction(e.key)
      if (action === null) return
      e.preventDefault()
      if (action === 'play') togglePlay()
      else if (action === 'mute') toggleMute()
      else if (action === 'fullscreen') void toggleFullscreen()
      else if (action === 'captions') toggleCaptions()
      else if (typeof action === 'number' && action >= 0 && action <= 1) {
        seekToFraction(action)
      } else if (typeof action === 'number') {
        seekBy(action)
      }
      setShowControls(true)
    },
    [seekBy, seekToFraction, toggleCaptions, toggleFullscreen, toggleMute, togglePlay],
  )

  // ----- Render -----
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0

  return (
    <div
      ref={containerRef}
      className={[styles.wrap, showControls ? '' : styles.wrapHidden, className ?? '']
        .filter(Boolean)
        .join(' ')}
      data-fullscreen={isFullscreen}
      data-error={hasError}
      tabIndex={0}
      role="region"
      aria-label={title ?? 'Video player'}
      onKeyDown={onKeyDown}
      onClick={onSurfaceClick}
      onMouseMove={onSurfaceMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <video
        ref={videoRef}
        className={styles.video}
        poster={poster}
        playsInline
        preload="metadata"
        autoPlay={autoPlay}
        muted={muted}
        aria-label={title ?? 'Video'}
      >
        {captions ? (
          <track
            kind="subtitles"
            src={captions.src}
            srcLang={captions.lang}
            label={captions.label}
            default={false}
          />
        ) : null}
      </video>

      {/* Big play button overlay (visible when paused + initial load) */}
      {!isPlaying && !hasError ? (
        <button
          type="button"
          className={styles.bigPlay}
          aria-label="Play"
          onClick={togglePlay}
        >
          <span className={styles.bigPlayIcon} aria-hidden="true">
            ▶
          </span>
        </button>
      ) : null}

      {/* Error overlay */}
      {hasError && errorMessage ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorTitle}>Playback error</p>
          <p className={styles.errorBody}>{errorMessage}</p>
        </div>
      ) : null}

      {/* Bottom controls bar */}
      <div className={styles.controls} aria-hidden={!showControls}>
        {/* Seek bar */}
        <div className={styles.seekRow}>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={Number.isFinite(progressPct) ? progressPct : 0}
            onChange={onSeekInput}
            className={styles.seek}
            aria-label="Seek"
            style={
              {
                '--seek-progress': `${progressPct}%`,
                '--seek-buffered': `${bufferedPct}%`,
              } as React.CSSProperties
            }
          />
        </div>

        {/* Action row */}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btn}
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            data-active={isPlaying}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>

          <span className={styles.time} aria-label="Current time">
            {formatTime(currentTime)} <span className={styles.timeSep}>/</span>{' '}
            {formatTime(duration)}
          </span>

          <div className={styles.spacer} />

          {/* Captions */}
          {captions ? (
            <button
              type="button"
              className={styles.btn}
              onClick={toggleCaptions}
              aria-label={captionsEnabled ? 'Hide captions' : 'Show captions'}
              aria-pressed={captionsEnabled}
              data-active={captionsEnabled}
            >
              CC
            </button>
          ) : null}

          {/* Quality */}
          {showQualityDropdown ? (
            <select
              className={styles.select}
              value={qualityId}
              onChange={onQualityChange}
              aria-label="Video quality"
            >
              {qualityOptions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          ) : null}

          {/* Playback rate */}
          <select
            className={styles.select}
            value={String(playbackRate)}
            onChange={onRateChange}
            aria-label="Playback rate"
          >
            {PLAYBACK_RATES.map((r) => (
              <option key={r} value={String(r)}>
                {r === 1 ? '1× (Normal)' : `${r}×`}
              </option>
            ))}
          </select>

          {/* Mute + volume (desktop only — hidden via CSS on mobile) */}
          <div className={styles.volume}>
            <button
              type="button"
              className={styles.btn}
              onClick={toggleMute}
              aria-label={mutedState ? 'Unmute' : 'Mute'}
              data-active={mutedState}
            >
              {mutedState || volume === 0 ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={mutedState ? 0 : volume}
              onChange={onVolumeChange}
              className={styles.volumeSlider}
              aria-label="Volume"
            />
          </div>

          {/* Fullscreen */}
          <button
            type="button"
            className={styles.btn}
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            data-active={isFullscreen}
          >
            {isFullscreen ? '⤡' : '⤢'}
          </button>
        </div>
      </div>
    </div>
  )
}