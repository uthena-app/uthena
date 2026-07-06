// LibraryProductSharing.tsx — the per-product sharing-prevention UI
// on /library/[slug]. RSC. Surfaces three pieces of context the user
// needs to understand the policy:
//
//   1. Current concurrent-stream count vs the per-user cap
//      (MAX_CONCURRENT_STREAMS). When the user is at the cap, the
//      stream-mint action returns a "Too many concurrent streams"
//      error; this section previews the limit so the user can
//      understand why.
//
//   2. A "View download history" link to /library/downloads. The
//      per-product detail page only shows the current stream count
//      here; the user's full per-file download/stream log lives on
//      /library/downloads (P7.7). Surfacing the link keeps the
//      sharing context in one place.
//
//   3. The rate limit (60 signed URLs per hour per user, shared
//      across downloads + streams). The cap is part of the contract
//      the user agrees to by clicking Generate link; rendering it
//      here makes the rule discoverable without needing a separate
//      policy page.
//
// Why we don't add a "force sign-out all other streams" action here:
//   - Streams expire on their own (4h TTL via url_expires_at). The
//     user just needs to wait, or close one of their other players.
//   - Forcing a remote sign-out requires invalidating Bunny CDN
//     tokens, which is out of scope for v1 (and is the slice-3
//     follow-up for P7.8, filed in STUB-P7.8).
//
// No client JS. Pure RSC. Renders even when activeStreams=0 (the
// neutral state shows the rules + the link to download history).

import Link from 'next/link'
import { MAX_CONCURRENT_STREAMS } from '@foundations/files/concurrent-streams'
import styles from './LibraryProductSharing.module.css'

export type LibraryProductSharingProps = {
  activeStreams: number
}

const RATE_LIMIT_PER_HOUR = 60
const STREAM_TTL_HOURS = 4
const DOWNLOAD_TTL_HOURS = 24

export function LibraryProductSharing({ activeStreams }: LibraryProductSharingProps) {
  const atCap = activeStreams >= MAX_CONCURRENT_STREAMS
  const remaining = Math.max(0, MAX_CONCURRENT_STREAMS - activeStreams)

  return (
    <section className={styles.section} aria-label="Sharing rules">
      <h2 className={styles.h2}>Sharing rules</h2>
      <p className={styles.hint}>
        Your files are protected by short-lived signed links. Sharing them
        outside your account can lock you out — here's the policy.
      </p>

      <div className={styles.grid}>
        {/* Concurrent-stream card */}
        <div
          className={styles.card}
          data-state={atCap ? 'cap' : 'ok'}
          aria-live="polite"
        >
          <p className={styles.cardLabel}>Concurrent streams</p>
          <p className={styles.cardValue}>
            <span className={styles.valueNum}>{activeStreams}</span>
            <span className={styles.valueSep}> of </span>
            <span className={styles.valueNum}>{MAX_CONCURRENT_STREAMS}</span>
          </p>
          <p className={styles.cardHint}>
            {atCap
              ? 'You\'re at the cap. Close one stream before starting another.'
              : `${remaining} ${remaining === 1 ? 'stream' : 'streams'} remaining before the cap.`}
          </p>
        </div>

        {/* Rate-limit card */}
        <div className={styles.card} data-state="ok">
          <p className={styles.cardLabel}>Links per hour</p>
          <p className={styles.cardValue}>
            <span className={styles.valueNum}>{RATE_LIMIT_PER_HOUR}</span>
          </p>
          <p className={styles.cardHint}>
            Across downloads + streams. Power users should plan bulk requests
            with the vault's bulk-download.
          </p>
        </div>

        {/* TTL card */}
        <div className={styles.card} data-state="ok">
          <p className={styles.cardLabel}>Link lifetime</p>
          <p className={styles.cardValue}>
            <span className={styles.valueNum}>{STREAM_TTL_HOURS}h</span>
            <span className={styles.valueSep}> / </span>
            <span className={styles.valueNum}>{DOWNLOAD_TTL_HOURS}h</span>
          </p>
          <p className={styles.cardHint}>
            Streams expire faster (4h, IP-bound). Downloads last 24h.
          </p>
        </div>
      </div>

      <p className={styles.footnote}>
        Need to audit your activity?{' '}
        <Link href="/library/downloads" className={styles.footnoteLink}>
          Open download history
        </Link>{' '}
        to see every link you generated.
      </p>
    </section>
  )
}