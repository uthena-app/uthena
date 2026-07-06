// DmcaAgentCard.tsx — the data-driven DMCA designated-agent contact
// card. Renders the agent's name + email + mailing address + optional
// phone, sourced from `platform_settings.dmca_agent` via
// `getDmcaAgent()` (P10.4).
//
// When the row is missing or malformed, the card renders a friendly
// fallback ("not yet configured") instead of an empty container — this
// is the seed-data state on a freshly-provisioned environment before
// the migration's seed row landed, OR the fail-closed response to a
// DB error.
//
// RSC. No client JS. The email address renders as a `mailto:` link;
// the mailing address renders as plain text (per § 512(c), a postal
// address is required — copy/paste is fine).

import type { DmcaAgentContact } from '../queries/getDmcaAgent'
import styles from './DmcaAgentCard.module.css'

export function DmcaAgentCard({ agent }: { agent: DmcaAgentContact | null }) {
  if (!agent) {
    return (
      <aside className={styles.fallback} aria-live="polite">
        <strong>DMCA designated agent contact is not yet configured.</strong>
        <span className={styles.fallbackHint}>
          An administrator can set it from <code>/admin/dmca-agent</code>.
          Until then, please email{' '}
          <a className={styles.link} href="mailto:legal@uthena.com">
            legal@uthena.com
          </a>
          .
        </span>
      </aside>
    )
  }

  // Escape double-quotes in the mailto subject just in case a future
  // admin pastes a name that contains one — RFC 6068 says `"` is not
  // a valid character inside the mailto URL and must be percent-encoded.
  const mailtoSubject = encodeURIComponent('DMCA Notice')
  const mailtoHref = `mailto:${agent.email}?subject=${mailtoSubject}`

  return (
    <aside className={styles.card} aria-label="DMCA designated agent">
      <p className={styles.heading}>Designated Agent</p>
      <p className={styles.name}>{agent.name}</p>
      <p className={styles.row}>
        <span className={styles.label}>Email</span>
        <span className={styles.value}>
          <a className={styles.link} href={mailtoHref}>
            {agent.email}
          </a>
        </span>
      </p>
      <p className={styles.row}>
        <span className={styles.label}>Mailing address</span>
        <span className={styles.value}>{agent.mailing_address}</span>
      </p>
      {agent.phone ? (
        <p className={styles.row}>
          <span className={styles.label}>Phone</span>
          <span className={styles.value}>{agent.phone}</span>
        </p>
      ) : null}
    </aside>
  )
}