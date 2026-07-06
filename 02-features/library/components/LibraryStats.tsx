// LibraryStats.tsx — server component. Renders the 2 stat tiles at
// the top of the /library page header.
//
// P7.1 Slice 1: shows the 2 stats that have real data sources today
// (total courses the user owns, total downloadable files across those
// courses). The other 2 stat tiles called out in the spec (total watch
// seconds, total certificates) are gated on Phase 15 — the `progress`
// and `certificates` tables exist (PH09) but the per-user aggregates
// for these need the Phase 15 read surfaces to be designed. Once Phase
// 15 lands, the 2 tiles reappear in the same grid (no layout shift —
// the grid is 4-col on desktop, 2x2 on mobile, so the gap is honest).
//
// The tiles use the same compact shape as `CategoryStatsCards` and
// `LedgerSummary`'s StatCard: 11px uppercase label, 24px value, hairline
// border, no shadow. Token-only CSS — no inline colors.

import styles from './LibraryStats.module.css'

export type LibraryStatsData = {
  total_courses: number
  total_files: number
}

export function LibraryStats({ stats }: { stats: LibraryStatsData }) {
  return (
    <dl className={styles.grid} aria-label="Library at a glance">
      <StatTile label="Courses" value={stats.total_courses} />
      <StatTile label="Files" value={stats.total_files} />
    </dl>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  const display = Number.isFinite(value) ? value.toLocaleString('en-US') : '0'
  return (
    <div className={styles.tile}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{display}</dd>
    </div>
  )
}