// DownloadHistoryTable.tsx — RSC table that renders the file_downloads
// audit log for the current user. Pure server-renderable component;
// all data prep happens upstream in getDownloadHistory.
//
// Row shape (one per audit row):
//   timestamp | product · file | kind | IP (masked) | device | edge | expiry
//
// PII rendering:
//   - IP last-octet masked via maskIp (4-decimal IPv4 only; IPv6
//     passes through — same surface, same data class, same blast
//     radius as logging an email).
//   - User-agent shortened to "Browser X · OS" via shortUserAgent.
//   - Internal `ip_hash` field is NEVER selected (not even masked);
//     it's an admin-only abuse-detection hash.
//
// Edge cases:
//   - File deleted (file_id null) → "(file deleted)" placeholder.
//   - Product deleted (product_id null) → "(product deleted)" placeholder.
//   - Both deleted → "(deleted)" placeholder (rare).
//   - Empty list → the page renders the "no history" empty state
//     instead of this component (or with the empty-state copy in-line).
//   - DB error (total_in_window = -1) → still render what we have;
//     the page header explains the gap.

import Link from 'next/link'
import type { DownloadHistoryEntry } from '../queries/getDownloadHistory'
import { maskIp, shortUserAgent } from '../queries/formatIp'
import styles from './DownloadHistoryTable.module.css'

const KIND_LABEL = {
  download: 'Download',
  stream: 'Stream',
} as const

export function DownloadHistoryTable({ entries }: { entries: DownloadHistoryEntry[] }) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.colWhen}>When</th>
            <th scope="col" className={styles.colWhat}>What</th>
            <th scope="col" className={styles.colKind}>Kind</th>
            <th scope="col" className={styles.colIp}>IP</th>
            <th scope="col" className={styles.colDevice}>Device</th>
            <th scope="col" className={styles.colEdge}>Edge</th>
            <th scope="col" className={styles.colExpiry}>Expires</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <Row key={e.id} entry={e} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({ entry }: { entry: DownloadHistoryEntry }) {
  const deviceLabel = shortUserAgent(entry.user_agent)
  const ipLabel = maskIp(entry.ip_raw)
  const isExpired = new Date(entry.url_expires_at).getTime() < Date.now()

  return (
    <tr className={styles.row}>
      <td className={styles.colWhen}>
        <time dateTime={entry.created_at} className={styles.timestamp}>
          {formatAbsoluteTime(entry.created_at)}
        </time>
        <p className={styles.relative}>{formatRelative(entry.created_at)}</p>
      </td>
      <td className={styles.colWhat}>
        {entry.product_slug ? (
          <Link href={`/products/${entry.product_slug}`} className={styles.productLink}>
            {entry.product_title ?? '(product deleted)'}
          </Link>
        ) : (
          <span className={styles.deleted}>{entry.product_title ?? '(product deleted)'}</span>
        )}
        <p className={styles.file}>
          {entry.original_filename ?? '(file deleted)'}
        </p>
      </td>
      <td className={styles.colKind}>
        <span className={styles.kindPill} data-kind={entry.kind}>
          {KIND_LABEL[entry.kind]}
        </span>
      </td>
      <td className={styles.colIp}>
        <span className={styles.mono}>{ipLabel}</span>
      </td>
      <td className={styles.colDevice}>
        <span className={styles.device}>{deviceLabel}</span>
      </td>
      <td className={styles.colEdge}>
        <span className={styles.mono}>{entry.edge_location ?? '—'}</span>
      </td>
      <td className={styles.colExpiry}>
        <span className={styles.expiry} data-expired={isExpired ? 'true' : 'false'}>
          {formatAbsoluteTime(entry.url_expires_at)}
        </span>
        {isExpired && <p className={styles.expiredNote}>Expired</p>}
      </td>
    </tr>
  )
}

// ---- date helpers (pure, server-safe) ----

/**
 * "Jun 25, 2026 · 10:30 AM" — absolute timestamp, locale-stable.
 * Uses Intl.DateTimeFormat so the format respects the user's
 * default locale without a third-party library. UTC-stable so
 * server-rendered rows don't flicker when the client hydrates.
 */
function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  })
  return `${dateFmt.format(d)} · ${timeFmt.format(d)} UTC`
}

/**
 * "3 hours ago" — relative time, computed at SSR. The static string
 * won't update without a page refresh, but that's fine for an audit
 * log (the absolute timestamp is the source of truth).
 *
 * Reuses the bucket boundaries from formatTimeAgo (account/profile/queries)
 * via inline logic so this component doesn't pull a cross-feature dep.
 */
function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const ms = Date.now() - d.getTime()
  if (ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
  const yr = Math.floor(mo / 12)
  return `${yr} year${yr === 1 ? '' : 's'} ago`
}
