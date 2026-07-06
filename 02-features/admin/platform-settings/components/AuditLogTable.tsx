// AuditLogTable.tsx — server component; renders the audit log page
// result + pagination controls.

import Link from 'next/link'
import type { AuditLogPageResult } from '../queries/getAuditLogPage'
import styles from './AuditLogTable.module.css'

export function AuditLogTable({ page }: { page: AuditLogPageResult }) {
  const { entries, filters, hasMore, lastCursorId } = page

  function buildHref(beforeId?: number) {
    const params = new URLSearchParams()
    if (filters.actorEmailQuery) params.set('actorEmail', filters.actorEmailQuery)
    if (filters.actionQuery) params.set('action', filters.actionQuery)
    if (filters.targetKindQuery) params.set('targetKind', filters.targetKindQuery)
    if (filters.targetIdQuery) params.set('targetId', filters.targetIdQuery)
    if (filters.fromIso) params.set('from', filters.fromIso.slice(0, 16))
    if (filters.toIso) params.set('to', filters.toIso.slice(0, 16))
    if (beforeId) params.set('beforeId', String(beforeId))
    const qs = params.toString()
    return qs ? `/admin/audit-log?${qs}` : '/admin/audit-log'
  }

  if (entries.length === 0) {
    return (
      <section className={styles.empty}>
        <h2 className={styles.emptyTitle}>No matching entries</h2>
        <p className={styles.emptyHint}>
          Try adjusting your filters, or {' '}
          <Link href="/admin/audit-log" className={styles.clearLink}>
            view all entries
          </Link>
          .
        </p>
      </section>
    )
  }

  return (
    <section className={styles.root} aria-label="Audit log entries">
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className={styles.when}>
                  <time dateTime={e.createdAt}>{formatDateTimeShort(e.createdAt)}</time>
                </td>
                <td className={styles.actor}>
                  <code className={styles.mono}>{e.actorEmail}</code>
                </td>
                <td>
                  <code className={styles.actionCode}>{e.action}</code>
                </td>
                <td>
                  <span className={styles.targetKind}>{e.targetKind ?? '—'}</span>
                  {e.targetId ? <span className={styles.targetId}>#{e.targetId}</span> : null}
                </td>
                <td className={styles.metaCell}>
                  {e.metadata ? (
                    <code className={styles.metaCode}>
                      {JSON.stringify(e.metadata)}
                    </code>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className={styles.pagination} aria-label="Audit log pagination">
        {hasMore ? (
          <Link href={buildHref(lastCursorId ?? undefined)} className={styles.nextButton}>
            Older entries →
          </Link>
        ) : (
          <span className={styles.muted}>No more entries.</span>
        )}
      </nav>
    </section>
  )
}

function formatDateTimeShort(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}
