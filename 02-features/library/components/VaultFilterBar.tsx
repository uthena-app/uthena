// VaultFilterBar.tsx — client island for the /library file vault
// filter strip (P7.9). Three filter dimensions:
//
//   - product : 'all' | <numeric product_id>
//   - kind    : 'all' | <FileKind — video, slides, transcript, ...>
//   - since   : 'all' | '30' | '90' | '365' (days back from now)
//
// The component owns the URL state — pushes a new URL when a chip is
// clicked, syncs from the URL on mount, and stays in sync on Back/Forward
// via the useEffect on `params`. The page (RSC) reads the URL params on
// every render and re-runs filterVaultFiles + groupVaultFilesByProduct.
//
// Why a client island instead of <Link>s?
//   - Three filter dimensions × per-chip active-state logic is ~150
//     lines of state. Lifting to RSC would require a searchParams round-
//     trip on every chip click; a client island + router.push is faster
//     and the URL remains the source of truth.
//   - Same pattern as DownloadHistoryFilterBar (P7.7) and BrowseSortSelect
//     (P0.16) — proven in this codebase, no need to invent.
//
// Product chip group is dynamic — the RSC passes `availableProducts`
// derived from the user's vault rows so the chip group only shows
// products the user actually owns (defense in depth: even if the URL
// contains a product_id the user doesn't own, the filter returns []).

'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FILE_KINDS, type FileKind } from '@foundations/data/enums'
import styles from './VaultFilterBar.module.css'

export type VaultProductOption = { id: number; title: string }

type KindFilter = FileKind | 'all'
type SinceFilter = 'all' | '30' | '90' | '365'

const KIND_LABEL: Record<FileKind, string> = {
  video: 'Video',
  slides: 'Slides',
  transcript: 'Transcript',
  graphics: 'Graphics',
  audio: 'Audio',
  document: 'Document',
  archive: 'Archive',
  other: 'Other',
}

const SINCE_OPTIONS: ReadonlyArray<{ value: SinceFilter; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last year' },
]

export type VaultFilterBarProps = {
  availableProducts: VaultProductOption[]
  /** Current filters parsed from the URL by the RSC. */
  current: {
    productId: number | null
    kind: KindFilter
    sinceDays: SinceFilter
  }
}

export function VaultFilterBar({ availableProducts, current }: VaultFilterBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const [productId, setProductId] = useState<number | null>(current.productId)
  const [kind, setKind] = useState<KindFilter>(current.kind)
  const [sinceDays, setSinceDays] = useState<SinceFilter>(current.sinceDays)

  // Sync state when the URL changes externally (Back/Forward, hard nav,
  // the page's "Clear all filters" link). useEffect is keyed on the
  // params string so it only runs when the URL actually changes — not
  // on every render.
  useEffect(() => {
    setProductId(parseProductId(params.get('product')))
    setKind(parseKind(params.get('kind')))
    setSinceDays(parseSince(params.get('since')))
  }, [params])

  function push(next: { productId: number | null; kind: KindFilter; sinceDays: SinceFilter }) {
    const search = new URLSearchParams()
    // Default-strip: omit the param when it's at the default. Keeps the
    // canonical URL clean (`/library` instead of
    // `/library?product=all&kind=all&since=all`).
    if (next.productId != null) search.set('product', String(next.productId))
    if (next.kind !== 'all') search.set('kind', next.kind)
    if (next.sinceDays !== 'all') search.set('since', next.sinceDays)
    const qs = search.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  function onProductClick(id: number | null) {
    if (id === productId) return
    setProductId(id)
    push({ productId: id, kind, sinceDays })
  }

  function onKindClick(value: KindFilter) {
    if (value === kind) return
    setKind(value)
    push({ productId, kind: value, sinceDays })
  }

  function onSinceClick(value: SinceFilter) {
    if (value === sinceDays) return
    setSinceDays(value)
    push({ productId, kind, sinceDays: value })
  }

  const productIsAll = productId == null

  return (
    <div className={styles.wrap} role="toolbar" aria-label="File vault filters">
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Product</legend>
        <div className={styles.chips}>
          <button
            type="button"
            onClick={() => onProductClick(null)}
            className={styles.chip}
            data-active={productIsAll}
            aria-pressed={productIsAll}
          >
            All
          </button>
          {availableProducts.map((p) => {
            const active = productId === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onProductClick(p.id)}
                className={styles.chip}
                data-active={active}
                aria-pressed={active}
              >
                {p.title}
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Format</legend>
        <div className={styles.chips}>
          <button
            type="button"
            onClick={() => onKindClick('all')}
            className={styles.chip}
            data-active={kind === 'all'}
            aria-pressed={kind === 'all'}
          >
            All
          </button>
          {FILE_KINDS.map((k) => {
            const active = kind === k
            return (
              <button
                key={k}
                type="button"
                onClick={() => onKindClick(k)}
                className={styles.chip}
                data-active={active}
                aria-pressed={active}
              >
                {KIND_LABEL[k]}
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Date added</legend>
        <div className={styles.chips}>
          {SINCE_OPTIONS.map((opt) => {
            const active = sinceDays === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSinceClick(opt.value)}
                className={styles.chip}
                data-active={active}
                aria-pressed={active}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}

function parseProductId(raw: string | null): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null
  return n
}

function parseKind(raw: string | null): KindFilter {
  if (raw && (FILE_KINDS as readonly string[]).includes(raw)) return raw as FileKind
  return 'all'
}

function parseSince(raw: string | null): SinceFilter {
  if (raw === '30' || raw === '90' || raw === '365') return raw
  return 'all'
}