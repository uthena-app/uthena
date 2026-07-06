// AllLinksTable.tsx — P13.6 all-links table for /affiliate/links.
//
// Renders one row per `AffiliateLinkRow`. In v1 the affiliate has
// exactly one (the default global link), so the table is mostly
// a 1-row preview — but the column set + action column +
// status-filter UI are forward-compatible with v2's multi-link
// surface (per the spec: "the v1 schema must already support
// per-product links so the v2 build is just a UI change, not a
// migration").
//
// **Action column in v1** (per acceptance #5 / STUB-110):
//   - Copy URL  → CopyLinkButton (real)
//   - QR code   → disabled, "Coming in v2" tooltip (Slice 3)
//   - Disable   → disabled, "Coming in v2" tooltip (Slice 2)
//   - Delete    → disabled, "Coming in v2" tooltip (Slice 2)
//
// **Status filter** (P13.6 / spec acceptance #6) — a 3-state client
// filter (active / disabled / all) that re-filters the table
// client-side via the `?status=` URL param. The URL is the source
// of truth (Back/Forward works, links share, the filter survives
// a hard refresh). Default-strip pattern keeps the canonical URL
// at `/affiliate/links` when status='active'.
//
// **Render strategy**: client island (the page is force-dynamic
// anyway; the table is small data — ≤ a few rows per affiliate at
// v1, low-hundreds at v2). Making the table client avoids the
// RSC-re-fetch-on-URL-change round trip that the spec explicitly
// rules out.

'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { SITE_ORIGIN } from '@foundations/metadata/buildPageMetadata'
import { formatTimeAgo } from '@features/account/profile/queries/formatTimeAgo'
import { CopyLinkButton } from './CopyLinkButton'
import type { AffiliateLinkRow } from '../queries/getMyAffiliateLinks'
import styles from './AllLinksTable.module.css'

/** The 3 valid filter values. `active` is the default (matches the
 *  spec table — the filter dropdown defaults to "Active"). */
type StatusFilter = 'active' | 'disabled' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'all', label: 'All' },
]

/** Pure: parse a `?status=` value. Anything not in the canonical
 *  3-value set falls back to the default `'active'`. */
export function parseStatusFilter(raw: string | null | undefined): StatusFilter {
  if (raw === 'disabled') return 'disabled'
  if (raw === 'all') return 'all'
  return 'active'
}

/** Pure: apply the filter to a links array. Soft-deleted rows are
 *  already filtered out upstream by the query (WHERE deleted_at IS
 *  NULL), so the filter only operates on the disabledAt dimension. */
export function applyStatusFilter(
  links: readonly AffiliateLinkRow[],
  status: StatusFilter,
): AffiliateLinkRow[] {
  if (status === 'all') return links.slice()
  if (status === 'active') return links.filter((l) => l.disabledAt == null)
  return links.filter((l) => l.disabledAt != null)
}

export function AllLinksTable({ links }: { links: readonly AffiliateLinkRow[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const current = parseStatusFilter(params.get('status'))
  const filtered = applyStatusFilter(links, current)
  const filterIsActive = current !== 'active'

  function setStatus(next: StatusFilter) {
    if (next === current) return
    const sp = new URLSearchParams()
    // Default-strip: omit ?status= when at the default ('active').
    // Same pattern as P0.16 BrowseSort + P7.7 DownloadHistoryFilters.
    if (next !== 'active') sp.set('status', next)
    const qs = sp.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <section className={styles.shell} aria-label="All your affiliate links">
      <header className={styles.shellHeader}>
        <div className={styles.shellHeading}>
          <p className={styles.shellEyebrow}>All links</p>
          <h2 className={styles.shellTitle}>Your links</h2>
          <p className={styles.shellSub}>
            In v1 you have one global link. Per-product links ship in v2 (the
            Create link button at the top of the page).
          </p>
        </div>
        <fieldset className={styles.statusFieldset} aria-label="Filter links by status">
          <legend className={styles.statusLegend}>Status</legend>
          <div className={styles.statusChips}>
            {STATUS_OPTIONS.map((opt) => {
              const active = current === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  className={styles.statusChip}
                  data-active={active}
                  aria-pressed={active}
                  aria-label={`Filter: ${opt.label}`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </fieldset>
      </header>

      {filterIsActive && (
        <p className={styles.filterSummary} role="status" aria-live="polite">
          Showing {filtered.length} of {links.length} link{links.length === 1 ? '' : 's'}.{' '}
          <button
            type="button"
            className={styles.filterClear}
            onClick={() => setStatus('active')}
          >
            Show active
          </button>
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Target</th>
              <th scope="col" className={styles.hideBelow1280}>
                UTM tags
              </th>
              <th scope="col" className={styles.numCell}>
                Clicks
              </th>
              <th scope="col" className={styles.numCell}>
                Conversions
              </th>
              <th scope="col" className={`${styles.numCell} ${styles.hideBelow1024}`}>
                Conv. rate
              </th>
              <th scope="col">Status</th>
              <th scope="col" className={styles.hideBelow1280}>
                Created
              </th>
              <th scope="col" className={styles.hideBelow1024}>
                Last clicked
              </th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className={styles.tableEmpty}>
                  {links.length === 0
                    ? 'No links yet.'
                    : `No links match the "${current}" filter.`}
                </td>
              </tr>
            ) : (
              filtered.map((link) => <AllLinksRow key={link.id} link={link} />)
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function AllLinksRow({ link }: { link: AffiliateLinkRow }) {
  const shareUrl = `${SITE_ORIGIN}/?ref=${encodeURIComponent(link.code)}`
  const hasUtm =
    Boolean(link.utmSource) || Boolean(link.utmMedium) || Boolean(link.utmCampaign)
  const statusKey: 'active' | 'disabled' = link.disabledAt ? 'disabled' : 'active'
  const statusLabel = statusKey === 'disabled' ? 'Disabled' : 'Active'
  const convRateText =
    link.clicksAllTime > 0
      ? `${Math.round((link.conversionsAllTime / link.clicksAllTime) * 100)}%`
      : '—'

  return (
    <tr data-link-id={link.id} data-status={statusKey}>
      <td>
        <span className={styles.code}>{link.code}</span>
      </td>
      <td>
        <LinkOrDim target={link.destinationPath} />
      </td>
      <td className={styles.hideBelow1280}>
        {hasUtm ? (
          <span className={styles.utmGrid}>
            {link.utmSource && (
              <span>
                <span className={styles.utmKey}>src</span>
                {link.utmSource}
              </span>
            )}
            {link.utmMedium && (
              <span>
                <span className={styles.utmKey}>med</span>
                {link.utmMedium}
              </span>
            )}
            {link.utmCampaign && (
              <span>
                <span className={styles.utmKey}>cmp</span>
                {link.utmCampaign}
              </span>
            )}
          </span>
        ) : (
          <span className={styles.utmNone}>—</span>
        )}
      </td>
      <td className={styles.numCell}>
        {Math.trunc(link.clicksAllTime).toLocaleString('en-US')}
        <span className={styles.numCellLabel}>all</span>
        <br />
        {Math.trunc(link.clicks30d).toLocaleString('en-US')}
        <span className={styles.numCellLabel}>30d</span>
      </td>
      <td className={styles.numCell}>
        {Math.trunc(link.conversionsAllTime).toLocaleString('en-US')}
        <span className={styles.numCellLabel}>all</span>
        <br />
        {Math.trunc(link.conversions30d).toLocaleString('en-US')}
        <span className={styles.numCellLabel}>30d</span>
      </td>
      <td className={`${styles.numCell} ${styles.hideBelow1024}`}>
        <span className={styles.numRate}>{convRateText}</span>
      </td>
      <td>
        <span className={styles.statusPill} data-status={statusKey}>
          <span aria-hidden="true">●</span>
          {statusLabel}
        </span>
      </td>
      <td className={`${styles.dateCell} ${styles.hideBelow1280}`}>
        {formatTimeAgo(link.createdAt)}
      </td>
      <td className={`${styles.dateCell} ${styles.hideBelow1024}`}>
        {link.lastClickedAt ? formatTimeAgo(link.lastClickedAt) : '—'}
      </td>
      <td>
        <div className={styles.actionsCell}>
          <CopyLinkButton
            text={shareUrl}
            label="Copy"
            toastMessage="Link copied"
            icon={<CopyIcon />}
          />
          <button
            type="button"
            className={styles.actionBtn}
            disabled
            title="Copy as QR — coming in v2."
            aria-label="Copy as QR (coming in v2)"
          >
            QR
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            disabled
            title="Disable — coming in v2."
            aria-label="Disable link (coming in v2)"
          >
            Disable
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            disabled
            title="Delete — coming in v2."
            aria-label="Delete link (coming in v2)"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

/** The link's `destination_path` is always either `/` (the root),
 *  `/[handle]` (the affiliate's minishop — P13.8 territory), or
 *  `/products/[slug]` (per-product links — v2). For v1 the only
 *  active destination is `/` so the helper renders a dim path
 *  with the right preview shape. */
function LinkOrDim({ target }: { target: string }) {
  if (target === '/' || target === '') {
    return <span className={`${styles.target} ${styles.targetDim}`}>Homepage</span>
  }
  return <span className={styles.target}>{target}</span>
}

/** Tiny inline SVG icon — no client JS, zero file weight. Used by
 *  the CopyLinkButton action variant. */
function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M2 11V2.5A1.5 1.5 0 0 1 3.5 1H11" />
    </svg>
  )
}
