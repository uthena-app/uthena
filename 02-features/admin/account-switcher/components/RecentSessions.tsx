// RecentSessions — server component. Renders the last 20 impersonation
// sessions across all super_admins. Reverse chronological. Read-only —
// Slice 2 will add per-row actions (reopen, end-now) and Slice 3 will
// add a per-customer history view.

import { listRecentImpersonationSessions } from '../queries/listRecentImpersonationSessions'
import styles from './AccountSwitcher.module.css'

function formatTime(iso: string): string {
  // Local-formatted "YYYY-MM-DD HH:MM" — UTC-stable for the audit feel.
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  } catch {
    return iso
  }
}

function timeAgo(iso: string): string {
  try {
    const d = new Date(iso).getTime()
    const diff = Date.now() - d
    if (diff < 60_000) return 'just now'
    const mins = Math.floor(diff / 60_000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 30) return `${days}d ago`
    const months = Math.floor(days / 30)
    return `${months}mo ago`
  } catch {
    return ''
  }
}

export async function RecentSessions() {
  const rows = await listRecentImpersonationSessions()
  return (
    <section className={styles.recentSection} aria-labelledby="recent-sessions-h">
      <h2 id="recent-sessions-h" className={styles.sectionH}>
        Recent impersonation sessions
      </h2>
      {rows.length === 0 ? (
        <p className={styles.muted}>No impersonation sessions yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.recentTable}>
            <thead>
              <tr>
                <th scope="col">Admin</th>
                <th scope="col">Target</th>
                <th scope="col">Started</th>
                <th scope="col">Ended</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className={styles.cellStack}>
                      <span className={styles.cellName}>{r.admin_display_name}</span>
                      <span className={styles.cellSub}>{r.admin_email}</span>
                    </div>
                  </td>
                  <td>
                    <div className={styles.cellStack}>
                      <span className={styles.cellName}>{r.target_display_name}</span>
                      <span className={styles.cellSub}>{r.target_email}</span>
                    </div>
                  </td>
                  <td>
                    <div className={styles.cellStack}>
                      <span className={styles.cellTime}>{formatTime(r.started_at)}</span>
                      <span className={styles.cellSub}>{timeAgo(r.started_at)}</span>
                    </div>
                  </td>
                  <td>
                    {r.ended_at ? (
                      <span className={styles.cellTime}>{formatTime(r.ended_at)}</span>
                    ) : r.expires_at && new Date(r.expires_at).getTime() < Date.now() ? (
                      <span className={styles.expiredTag}>Expired</span>
                    ) : (
                      <span className={styles.activeTag}>Active</span>
                    )}
                  </td>
                  <td className={styles.reasonCell}>{r.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
