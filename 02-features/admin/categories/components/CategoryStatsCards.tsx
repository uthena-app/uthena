// CategoryStatsCards.tsx — server component. Renders the 5 stat
// cards at the top of the /admin/categories page.

import type { CategoryStats } from '../types'
import styles from './CategoryStatsCards.module.css'

function formatCurrencyCents(cents: number): string {
  if (!Number.isFinite(cents)) return '$0'
  const dollars = Math.round(cents / 100)
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`
  return `$${dollars.toLocaleString('en-US')}`
}

export function CategoryStatsCards({ stats }: { stats: CategoryStats }) {
  return (
    <div className={styles.grid}>
      <StatCard label="Total categories" value={stats.total.toLocaleString('en-US')} />
      <StatCard label="Top-level" value={stats.topLevel.toLocaleString('en-US')} />
      <StatCard label="Sub-categories" value={stats.sub.toLocaleString('en-US')} />
      <StatCard label="Products in tree" value={stats.totalProducts.toLocaleString('en-US')} />
      <StatCard label="Revenue (30d)" value={formatCurrencyCents(stats.totalRevenue30d)} />
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.card}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  )
}
