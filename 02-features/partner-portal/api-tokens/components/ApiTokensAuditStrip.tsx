// 02-features/partner-portal/api-tokens/components/ApiTokensAuditStrip.tsx
//
// P12.19 — Page-level audit strip ("Last token action: 3 minutes ago
// (revoked)"). RSC. Renders nothing when there's no recent action.

import { formatTimeAgo } from '../../../account/profile/queries/formatTimeAgo'
import type { ApiTokenAuditEntry } from '../queries/getMyApiTokenAuditStrip'
import styles from './ApiTokensAuditStrip.module.css'

const ACTION_LABEL: Record<ApiTokenAuditEntry['action'], string> = {
  api_token_created: 'created',
  api_token_revoked: 'revoked',
}

export function ApiTokensAuditStrip({ entries }: { entries: ApiTokenAuditEntry[] }) {
  if (entries.length === 0) return null
  const most = entries[0]!
  return (
    <div className={styles.strip} role="status">
      <span className={styles.label}>Last token action:</span>{' '}
      <span className={styles.value}>
        {formatTimeAgo(most.at)} ({ACTION_LABEL[most.action]})
      </span>
    </div>
  )
}