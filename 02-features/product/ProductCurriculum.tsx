// ProductCurriculum — the Curriculum tab content. Renders
// `products.curriculum` (JSONB column, migration 0014) as the
// mockup-faithful `.curric` block.
//
// **Three render modes** (same pattern as ProductPerks / ProductDescription):
//   1. `curriculum === null` → renders the 12-item mockup-faithful
//      fallback from `mockups/product.html` line 132. This is the
//      "fresh product, partner hasn't filled in the wizard" state —
//      visitors still see a credible curriculum.
//   2. `curriculum === []` → renders nothing (partner explicitly
//      cleared the list).
//   3. `curriculum.length > 0` → renders the partner's entries,
//      capped at MAX_ENTRIES × MAX_NAME_LENGTH chars per entry.
//
// **Why pure RSC**: zero interactivity. The Curriculum tab is just
// a list of rows; clicking doesn't navigate anywhere (Phase 15 LMS
// wires lesson detail + video player once the curriculum is
// normalized into a `lessons` table — Slice 4 ships the v1 JSONB
// view of the same data).
//
// **Why the row format is `01 / Module N — Name / 12m`**: matches
// the mockup's `.curric .row` 3-column grid exactly (`.idx` / `.nm`
// / `.dur` in CSS — the mockup's column names). The index is
// zero-padded to match `entries.length` so 1–9 modules show "01"–
// "09" but 10–24 modules show "10"–"24" (no extra zero padding —
// matches the mockup's rhythm). The duration format ("12m" / "1h
// 23m") comes from the shared `formatDuration` helper so it matches
// the At-a-glance sidebar's "4h 38m" line.

import type { CurriculumEntry } from '@features/catalog/queries'
import { formatDuration } from './formatDuration'
import styles from './ProductCurriculum.module.css'

/** Mockup-faithful 12-item fallback (line 132 of mockups/product.html). */
const FALLBACK_CURRICULUM: readonly CurriculumEntry[] = [
  { index: 1, name: 'Module 1 — The class project & brand audit', duration_seconds: 12 * 60 },
  { index: 2, name: 'Module 2 — Niche selection with AI-driven market analysis', duration_seconds: 18 * 60 },
  { index: 3, name: 'Module 3 — Voice, tone, and visual identity system', duration_seconds: 22 * 60 },
  { index: 4, name: 'Module 4 — Content production pipeline & weekly cadence', duration_seconds: 28 * 60 },
  { index: 5, name: 'Module 5 — Distribution and growth loops across 3 platforms', duration_seconds: 24 * 60 },
  { index: 6, name: 'Module 6 — Monetization stack: lead magnet to paid offer', duration_seconds: 31 * 60 },
  { index: 7, name: 'Module 7 — Email list, landing pages, and conversion', duration_seconds: 19 * 60 },
  { index: 8, name: 'Module 8 — Affiliate partnerships and revenue share', duration_seconds: 15 * 60 },
  { index: 9, name: 'Module 9 — Reseller setup, branding, and launch checklist', duration_seconds: 22 * 60 },
  { index: 10, name: 'Module 10 — Analytics, attribution, and iteration cycle', duration_seconds: 18 * 60 },
  { index: 11, name: 'Module 11 — Scaling: hiring, SOPs, and delegation', duration_seconds: 14 * 60 },
  { index: 12, name: 'Module 12 — Bonus — AI tools, prompts, and templates', duration_seconds: 9 * 60 },
] as const

/** Hard cap on rendered entries — keeps the list from blowing up the layout. */
const MAX_ENTRIES = 24

/** Hard cap on each entry's name — defensively trims partner-typed content. */
const MAX_NAME_LENGTH = 200

type Props = {
  /** JSONB array of `{index, name, duration_seconds}` from
   *  `products.curriculum` (migration 0014). Null = fallback. Empty
   *  array = nothing. Array = the array (normalized). */
  curriculum: CurriculumEntry[] | null
}

/** Normalize one entry: coerce types, trim whitespace, cap length. */
function normalizeEntry(raw: unknown, fallbackIndex: number): CurriculumEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<CurriculumEntry>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  if (!name) return null
  const cappedName =
    name.length > MAX_NAME_LENGTH
      ? name.slice(0, MAX_NAME_LENGTH - 1) + '…'
      : name
  const index = Number.isFinite(r.index) && r.index! > 0 ? Math.trunc(r.index!) : fallbackIndex
  const duration =
    typeof r.duration_seconds === 'number' && r.duration_seconds >= 0
      ? r.duration_seconds
      : 0
  return { index, name: cappedName, duration_seconds: duration }
}

/** Zero-pad an index to match the total entry count (1–9 → "01".."09", 10+ → "10".."24"). */
function padIndex(idx: number, total: number): string {
  const width = total >= 10 ? 2 : 2 // both widths are 2 (matches mockup)
  return String(idx).padStart(width, '0')
}

export function ProductCurriculum({ curriculum }: Props) {
  // Resolve the effective list. Null = fallback. Empty = nothing.
  // Array = the array (normalized).
  const source: readonly unknown[] | null =
    curriculum === null
      ? FALLBACK_CURRICULUM
      : curriculum.length === 0
        ? null
        : curriculum

  if (source === null) return null

  // Normalize + cap + drop empties.
  const entries: CurriculumEntry[] = []
  for (let i = 0; i < source.length && entries.length < MAX_ENTRIES; i++) {
    const norm = normalizeEntry(source[i], entries.length + 1)
    if (norm) entries.push(norm)
  }

  if (entries.length === 0) return null

  return (
    <div className={styles.curric} role="list" aria-label="Curriculum">
      {entries.map((entry, idx) => (
        <div key={`${entry.index}-${idx}`} className={styles.row} role="listitem">
          <span className={styles.idx}>{padIndex(entry.index, entries.length)}</span>
          <span className={styles.nm}>{entry.name}</span>
          <span className={styles.dur}>{formatDuration(entry.duration_seconds)}</span>
        </div>
      ))}
    </div>
  )
}