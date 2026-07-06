// /library/watch/demo — public-ish demo route that mounts the
// VideoPlayer with a sample HLS stream URL. Lets the dev team
// visually verify the player component shape (responsive, fullscreen,
// captions, playback rate, quality switcher) end-to-end without
// needing a real course + signed stream URL.
//
// The path is `/library/watch/demo` (singular, no `[lessonId]`) —
// Phase 15 P15.2 will own the actual `/library/watch/[lessonId]`
// route (lesson list + player shell + Q&A). The demo route stays as
// a development aid.
//
// Sample URL: Mux's public Big Buck Bunny HLS test stream — well-known
// stable URL that exercises ABR (multiple quality levels) so the
// quality switcher dropdown has something to render. NOT IP-bound;
// the component is agnostic to that. Production streams from
// `mintStreamUrlAction` are IP-bound + signed; the player component
// receives whatever URL the parent passes.
//
// Auth note: this route lives under `/library/...`, which is auth-
// gated by the parent layout. Demo users can sign in normally to
// reach it. When P15.2 lands, the parent layout's auth gate stays
// the same — only the inner route's data fetch changes.
//
// P7.5 Slice 1: `?t=<seconds>` URL param drives the
// `initialSeekSeconds` prop — the canonical "Resume at M:SS" UX.
// Phase 15 will pass `lesson_progress.position_seconds` instead;
// the parser + prop are the same surface. See the spec
// Implementation notes for the full design.

import { VideoPlayer } from '@features/library/client'
import { formatTime, parseResumeSeconds } from '@features/library/components/VideoPlayer.types'
import type { Metadata } from 'next'
import styles from './page.module.css'

export const metadata: Metadata = {
  title: 'Video player demo · Uthena',
  description: 'Internal demo of the responsive video player component.',
  robots: { index: false, follow: false }, // demo, not for search engines
}

// Public HLS test stream — well-known ABR sample (Mux).
const DEMO_HLS_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'

type DemoPageProps = {
  searchParams: Promise<{ t?: string }>
}

export default async function VideoPlayerDemoPage({ searchParams }: DemoPageProps) {
  const sp = await searchParams
  const resumeAt = parseResumeSeconds(sp.t)
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>P7.6 · Mobile player · P7.5 Slice 1</p>
        <h1 className={styles.title}>Video player demo</h1>
        <p className={styles.lede}>
          The responsive video player component used by every course / lesson page.
          Responsive, fullscreen, captions, playback rate (0.5×–2×), and quality switcher.
        </p>
        {resumeAt !== null ? (
          <p className={styles.resumeNote} role="status" aria-live="polite">
            Resume at <strong>{formatTime(resumeAt)}</strong> — parsed from
            <code> ?t={sp.t} </code>
          </p>
        ) : null}
      </header>

      <section className={styles.playerSection} aria-label="Demo player">
        <VideoPlayer
          src={DEMO_HLS_URL}
          poster="https://peach.blender.org/wp-content/uploads/title_anouncement.jpg"
          title="Big Buck Bunny (HLS test stream)"
          captions={{
            src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz-subs.vtt',
            lang: 'en',
            label: 'English',
          }}
          {...(resumeAt !== null ? { initialSeekSeconds: resumeAt } : {})}
        />
      </section>

      <section className={styles.help}>
        <h2 className={styles.helpH}>Resume from URL (P7.5 Slice 1)</h2>
        <p className={styles.helpText}>
          Pass <code>?t=&lt;seconds&gt;</code> to start the player at that
          offset. Examples:
        </p>
        <ul className={styles.shortcuts}>
          <li>
            <a href="?t=30">
              <code>?t=30</code>
            </a>{' '}
            — resume at 0:30
          </li>
          <li>
            <a href="?t=512">
              <code>?t=512</code>
            </a>{' '}
            — resume at 8:32
          </li>
          <li>
            <a href="?t=">
              <code>?t=</code>
            </a>{' '}
            — empty (treated as start)
          </li>
          <li>
            <a href="?t=abc">
              <code>?t=abc</code>
            </a>{' '}
            — invalid (rejected, plays from 0)
          </li>
          <li>
            <a href="?t=-1">
              <code>?t=-1</code>
            </a>{' '}
            — negative (rejected, plays from 0)
          </li>
        </ul>

        <h2 className={styles.helpH}>Keyboard shortcuts</h2>
        <ul className={styles.shortcuts}>
          <li>
            <kbd>Space</kbd> / <kbd>k</kbd> — play / pause
          </li>
          <li>
            <kbd>←</kbd> / <kbd>→</kbd> — seek ±5 seconds
          </li>
          <li>
            <kbd>j</kbd> / <kbd>l</kbd> — seek ±10 seconds
          </li>
          <li>
            <kbd>m</kbd> — mute / unmute
          </li>
          <li>
            <kbd>f</kbd> — fullscreen
          </li>
          <li>
            <kbd>c</kbd> — captions on / off
          </li>
          <li>
            <kbd>0</kbd>–<kbd>9</kbd> — jump to 0% / 10% / … / 90%
          </li>
        </ul>
        <p className={styles.note}>
          This is the development demo. The production watch surface is
          <code> /library/watch/[lessonId] </code>
          and ships in Phase 15 (P15.2 — course player shell).
        </p>
      </section>
    </div>
  )
}
