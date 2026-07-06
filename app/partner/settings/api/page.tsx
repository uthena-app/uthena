// /partner/settings/api — RSC. Partner-facing API token management.
//
// P12.19 ships the full Slice 1 surface end-to-end:
//   - Partner-only via `requirePartner()`.
//   - Reads the partner's tokens + the audit strip in parallel.
//   - Composes the `<ApiTokensList>` + `<CreateApiTokenDialog>` +
//     `<ApiTokensAuditStrip>`.
//   - `noindex` via `sensitivePageMetadata` (matches the other
//     partner-settings surfaces).

import type { Metadata } from 'next'
import { requirePartner } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import { PartnerShell } from '@features/partner-portal/PartnerShell'
import { getMyApiTokens } from '@features/partner-portal/api-tokens/queries/getMyApiTokens'
import { getMyApiTokenAuditStrip } from '@features/partner-portal/api-tokens/queries/getMyApiTokenAuditStrip'
import { ApiTokensList } from '@features/partner-portal/api-tokens/components/ApiTokensList'
import { CreateApiTokenDialog } from '@features/partner-portal/api-tokens/components/CreateApiTokenDialog'
import { ApiTokensAuditStrip } from '@features/partner-portal/api-tokens/components/ApiTokensAuditStrip'
import { API_TOKEN_MAX_ACTIVE_TOKENS } from '@features/partner-portal/api-tokens/constants'
import styles from './api.module.css'

export const metadata: Metadata = sensitivePageMetadata({
  title: 'API & webhooks · Partner settings',
  description: 'Manage your Uthena partner API tokens.',
  path: '/partner/settings/api',
})

export default async function PartnerApiTokensPage() {
  const user = await requirePartner()

  const [tokens, auditStrip] = await Promise.all([
    getMyApiTokens(),
    getMyApiTokenAuditStrip(),
  ])

  const activeCount = tokens.filter((t) => t.status === 'active').length

  return (
    <PartnerShell>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <div className={styles.headerRow}>
            <div>
              <h1 className={styles.h1}>API &amp; webhooks</h1>
              <p className={styles.lede}>
                Tokens let you read your own data from external tools — Zapier,
                spreadsheets, dashboards. We never show the token twice.
              </p>
            </div>
            <CreateApiTokenDialog activeCount={activeCount} />
          </div>
          <div className={styles.stats}>
            <span className={styles.stat}>
              <span className={styles.statValue}>{activeCount}</span>
              <span className={styles.statLabel}>
                {' '}
                / {API_TOKEN_MAX_ACTIVE_TOKENS} active
              </span>
            </span>
          </div>
        </header>

        <ApiTokensList tokens={tokens} />

        <ApiTokensAuditStrip entries={auditStrip} />

        <p className={styles.footnote} id="api-docs-note">
          Need a different scope or higher rate limit? Email{' '}
          <a className={styles.emailLink} href={`mailto:${user.email}`}>
            support
          </a>{' '}
          and we’ll help. (Webhooks are coming — track via the changelog.)
        </p>
      </div>
    </PartnerShell>
  )
}