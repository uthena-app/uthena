// LicenseBadge — small pill showing the license tier (PLR / MRR /
// Resale Rights / Personal). Maps the `order_items.license` enum
// (license_type = ('plr', 'mrr', 'rr', 'personal')) to a human label.
//
// Renders server-side as a `<span>` (no JS). Uses semantic tokens so
// the colors stay on-brand and theme-safe. The tones reuse the
// StatusBadge palette so the visual vocabulary is consistent across
// the account area.

import styles from './LicenseBadge.module.css'

const LICENSE_LABELS: Record<string, { label: string; tone: 'plr' | 'mrr' | 'rr' | 'personal' }> = {
  plr: { label: 'PLR', tone: 'plr' },
  mrr: { label: 'MRR', tone: 'mrr' },
  rr: { label: 'Resale Rights', tone: 'rr' },
  personal: { label: 'Personal', tone: 'personal' },
}

export function LicenseBadge({ license }: { license: string }) {
  const meta = LICENSE_LABELS[license] ?? { label: license, tone: 'personal' as const }
  return <span className={`${styles.badge} ${styles[meta.tone]}`}>{meta.label}</span>
}