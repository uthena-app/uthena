// AuditStrip — server component. "Last profile update: {time ago}".
import { formatTimeAgo } from '../queries/formatTimeAgo'
import styles from './AuditStrip.module.css'

export function AuditStrip({ updatedAt }: { updatedAt: string | null }) {
  const ago = formatTimeAgo(updatedAt)
  const iso = updatedAt ? new Date(updatedAt).toISOString() : ''
  return (
    <p className={styles.strip}>
      <span className={styles.label}>Last profile update</span>
      <span className={styles.value}>{ago}</span>
      {iso && <span className={styles.iso}>{iso}</span>}
    </p>
  )
}
