// AnalyticsRangePicker.tsx — the date-range picker for /admin/analytics.
// Slice 1 ships 4 presets (30d / 60d / 90d / 365d). The custom
// date-range form lands in Slice 2 (STUB-127).
//
// Each preset is a plain <Link> to the same page with a different
// ?preset= URL param — no client JS needed. The active preset is
// styled with the accent color via [data-active].

import Link from 'next/link'
import { ANALYTICS_RANGE_DAYS, ANALYTICS_RANGE_PRESETS, type AnalyticsRangePreset } from '../types'
import styles from './AnalyticsRangePicker.module.css'

export type AnalyticsRangePickerProps = {
  activePreset: AnalyticsRangePreset
}

export function AnalyticsRangePicker({ activePreset }: AnalyticsRangePickerProps) {
  return (
    <nav
      className={styles.bar}
      aria-label="Analytics date range"
    >
      <span className={styles.label}>Range</span>
      <div className={styles.presets}>
        {ANALYTICS_RANGE_PRESETS.map((preset) => (
          <Link
            key={preset}
            href={`/admin/analytics?preset=${preset}`}
            className={styles.preset}
            data-active={preset === activePreset ? 'true' : 'false'}
            aria-current={preset === activePreset ? 'page' : undefined}
          >
            {ANALYTICS_RANGE_DAYS[preset]}d
          </Link>
        ))}
      </div>
    </nav>
  )
}