// 02-features/partner-portal/api-tokens/components/ApiTokensList.tsx
//
// P12.19 — RSC. Renders the partner's API tokens in a table.
// Token rows show: name, scope chips, masked token prefix,
// last_used_at, expires_at, status pill, "Revoke" button.
//
// The list itself never renders the plaintext (the plaintext lives
// only in the one-time-show modal at create time). The "Revoke"
// button opens a client-side modal — the page composes the list + a
// `<RevokeApiTokenDialog>` per row.
//
// Active rows render before revoked/expired rows (the query already
// sorts that way; this component just renders the array).

import { RevokeApiTokenDialog } from './RevokeApiTokenDialog'
import {
  API_TOKEN_SCOPE_LABELS,
  API_TOKEN_STATUS_LABEL,
} from '../constants'
import { formatTimeAgo } from '../../../account/profile/queries/formatTimeAgo'
import type { ApiTokenEntity } from '../lib/schemas'
import styles from './ApiTokensList.module.css'

export function ApiTokensList({ tokens }: { tokens: ApiTokenEntity[] }) {
  if (tokens.length === 0) {
    return (
      <div className={styles.empty} role="status">
        <p className={styles.emptyTitle}>No tokens yet.</p>
        <p className={styles.emptyBody}>
          Create one to start querying your data from external tools.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <table className={styles.table} aria-label="API tokens">
        <thead>
          <tr>
            <th scope="col" className={styles.th}>
              Name
            </th>
            <th scope="col" className={styles.th}>
              Token
            </th>
            <th scope="col" className={styles.th}>
              Scopes
            </th>
            <th scope="col" className={styles.th}>
              Last used
            </th>
            <th scope="col" className={styles.th}>
              Expires
            </th>
            <th scope="col" className={styles.th}>
              Status
            </th>
            <th scope="col" className={styles.th} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.id} data-status={t.status}>
              <td className={styles.td}>
                <div className={styles.nameCell}>
                  <span className={styles.name}>{t.name}</span>
                  <span className={styles.created}>
                    Created {formatTimeAgo(t.createdAt)}
                  </span>
                </div>
              </td>
              <td className={styles.td}>
                <code className={styles.tokenPrefix} title={t.tokenPrefix}>
                  {t.tokenPrefix}
                </code>
              </td>
              <td className={styles.td}>
                <div className={styles.scopeChips}>
                  {t.scopes.map((s) => (
                    <span key={s} className={styles.scopeChip}>
                      {API_TOKEN_SCOPE_LABELS[s]}
                    </span>
                  ))}
                </div>
              </td>
              <td className={styles.td}>{formatTimeAgo(t.lastUsedAt)}</td>
              <td className={styles.td}>
                {t.expiresAt ? formatTimeAgo(t.expiresAt) : 'Never'}
              </td>
              <td className={styles.td}>
                <span
                  className={styles.statusPill}
                  data-status={t.status}
                  aria-label={`Status: ${API_TOKEN_STATUS_LABEL[t.status]}`}
                >
                  {API_TOKEN_STATUS_LABEL[t.status]}
                </span>
              </td>
              <td className={styles.td}>
                {t.status === 'active' ? (
                  <RevokeApiTokenDialog
                    tokenId={t.id}
                    tokenName={t.name}
                    tokenPrefix={t.tokenPrefix}
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}