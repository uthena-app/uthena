// CategoryHistoryPanel.tsx — server component. Collapsible panel
// showing the last N entries from admin_audit_log for category
// changes. Uses <details>/<summary> for the collapse behavior so the
// server can render the markup and we don't need client JS for it.

import type { CategoryAuditEntry } from '../types'
import styles from './CategoryHistoryPanel.module.css'

const ACTION_LABELS: Record<string, string> = {
  'admin.category_create': 'Created',
  'admin.category_update': 'Updated',
  'admin.category_delete': 'Deleted',
  'admin.category_reorder': 'Reordered',
  // Short forms, accepted as aliases.
  category_create: 'Created',
  category_update: 'Updated',
  category_delete: 'Deleted',
  category_reorder: 'Reordered',
}

function relativeTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export function CategoryHistoryPanel({ entries }: { entries: CategoryAuditEntry[] }) {
  return (
    <details className={styles.panel}>
      <summary className={styles.summary}>
        History ({entries.length})
      </summary>
      <ul className={styles.list}>
        {entries.length === 0 && (
          <li className={styles.empty}>No category changes yet.</li>
        )}
        {entries.map((e) => (
          <li key={e.id} className={styles.row}>
            <span className={styles.action}>
              {ACTION_LABELS[e.action] ?? e.action}
            </span>
            <span className={styles.target}>
              {e.target_id ? `#${e.target_id}` : '—'}
            </span>
            <span className={styles.actor}>
              {e.actor_email || 'system'}
            </span>
            <span className={styles.time} title={e.created_at}>
              {relativeTime(e.created_at)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
