// DefaultLinkHero.tsx — P13.5 default-link hero card.
//
// Displays the affiliate's ONE default global link (and only link in
// v1) as the dominant card at the top of /affiliate/links. The
// surface breaks down into three regions:
//
//   1. Header — eyebrow + heading + lede + a "Create link" CTA
//      rendered disabled with a "Coming in v2" tooltip
//      (per acceptance #4 — the spec ships the button as a
//      disabled placeholder so the v2 build is purely UI).
//   2. URL block — mono `<code>` of the full `uthena.com/?ref=[code]`
//      URL + a `<CopyLinkButton>` that flips to "Copied" + fires a
//      success toast on click (per acceptance #7).
//   3. Stats strip — 4 inline metric cells (clicks all-time,
//      conversions all-time, conversion rate, last clicked at)
//      using the same label/value rhythm as KpiCards but as a
//      compact strip.
//
// **Empty state** — when no link row exists yet (legacy data, the
// affiliate has never visited /affiliate), renders a centered
// "Your default link is being generated" card with a Refresh
// button that calls the `ensureDefaultLinkAction` server action
// (per acceptance #2 + the spec's "ensureDefaultLink() creates
// it idempotently" requirement). The button is a real interactive
// client island (`'use client'`) routed through a small form
// action wrapping the server action.
//
// RSC when a link row exists. The RefreshButton below IS a client
// island — Next.js handles the boundary automatically because the
// component imports `RefreshDefaultLinkButton`.

import { SITE_ORIGIN } from '@foundations/metadata/buildPageMetadata'
import { formatTimeAgo } from '@features/account/profile/queries/formatTimeAgo'
import type { AffiliateLinkRow } from '../queries/getMyAffiliateLinks'
import { CopyLinkButton } from './CopyLinkButton'
import { RefreshDefaultLinkButton } from './RefreshDefaultLinkButton'
import styles from './DefaultLinkHero.module.css'

const EMPTY_MESSAGE =
  'If this page shows every time, your dashboard may not have been visited yet. Visit /affiliate once to generate your default link.'

export type DefaultLinkHeroProps = {
  /** The affiliate's ONE default link row. Null → empty state. */
  link: AffiliateLinkRow | null
}

/** Build the publicly-shared URL for the link — `SITE_ORIGIN/?ref=<code>`.
 *  The destination is always the root; once the visitor lands, the
 *  `?ref=` cookie sets attribution for the entire browsing session.
 *  This matches the spec section "Featured link (v1)" format string
 *  `uthena.com/?ref=[code]`. */
function buildShareUrl(code: string): string {
  return `${SITE_ORIGIN}/?ref=${encodeURIComponent(code)}`
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  return Math.trunc(n).toLocaleString('en-US')
}

/** Conditionally render the conversion rate as a percent string,
 *  or `—` when no clicks. Matches the spec acceptance #3 contract. */
function formatConversionRate(clicks: number, conversions: number): string {
  if (clicks <= 0) return '—'
  const pct = (conversions / clicks) * 100
  if (pct === 0) return '0%'
  if (Number.isInteger(pct) || pct >= 100) {
    return `${Math.round(pct)}%`
  }
  return `${pct.toFixed(1)}%`
}

export function DefaultLinkHero({ link }: DefaultLinkHeroProps) {
  if (!link) {
    return (
      <section className={styles.empty} aria-label="Default link not yet generated">
        <p className={styles.emptyEyebrow}>Pending setup</p>
        <h2 className={styles.emptyHeading}>Your default link is being generated</h2>
        <p className={styles.emptyBody}>{EMPTY_MESSAGE}</p>
        <RefreshDefaultLinkButton />
      </section>
    )
  }

  const shareUrl = buildShareUrl(link.code)

  return (
    <section className={styles.card} aria-label="Your default affiliate link">
      <div className={styles.header}>
        <div className={styles.headingBlock}>
          <p className={styles.eyebrow}>Your default link</p>
          <h2 className={styles.heading}>Share this link to earn</h2>
          <p className={styles.sub}>
            Every visitor who lands on Uthena with{' '}
            <code className={styles.urlCode}>?ref={link.code}</code>{' '}
            is attributed to you for 30 days. Conversions on any product count.
          </p>
        </div>
        {/* The disabled "Create link" CTA — pure presentational element
            per acceptance #4. The button is intentionally NOT
            interactive (no <button> + role/toggle pattern) because the
            spec says clicking it should do nothing. The visible focus
            ring is a v1 affordance for keyboard users who tab through;
            no `onClick`, no form submission. A native title + an
            inline focus/hover tooltip surface the v2 message. */}
        <div className={styles.ctaWrap}>
          <button
            type="button"
            className={styles.cta}
            disabled
            aria-disabled="true"
            title="Per-product links are coming in v2. Your global link above is the only link in v1."
          >
            <span aria-hidden="true">+</span>
            <span>Create link</span>
            <span className={styles.ctaBadge}>v2</span>
          </button>
          <span className={styles.ctaTooltip} role="tooltip">
            Per-product links are coming in v2. Your global link above is the only link in v1.
          </span>
        </div>
      </div>

      <div className={styles.urlRow}>
        <code className={styles.urlBox} aria-label="Affiliate link URL">
          {shareUrl}
        </code>
        <CopyLinkButton
          text={shareUrl}
          toastMessage={`Link copied — share ${link.code} anywhere.`}
        />
      </div>

      <div className={styles.statsStrip} role="group" aria-label="Default link metrics">
        <div className={styles.statCell}>
          <p className={styles.statLabel}>Clicks</p>
          <p className={styles.statValue}>{formatNumber(link.clicksAllTime)}</p>
          <p className={styles.statSub}>{formatNumber(link.clicks30d)} in last 30d</p>
        </div>
        <div className={styles.statCell}>
          <p className={styles.statLabel}>Conversions</p>
          <p className={styles.statValue}>{formatNumber(link.conversionsAllTime)}</p>
          <p className={styles.statSub}>{formatNumber(link.conversions30d)} in last 30d</p>
        </div>
        <div className={styles.statCell}>
          <p className={styles.statLabel}>Conversion rate</p>
          <p className={styles.statValue}>
            {link.clicksAllTime > 0 ? (
              formatConversionRate(link.clicksAllTime, link.conversionsAllTime)
            ) : (
              <span className={styles.muted}>—</span>
            )}
          </p>
          <p className={styles.statSub}>
            {link.conversionsAllTime} / {link.clicksAllTime} clicks
          </p>
        </div>
        <div className={styles.statCell}>
          <p className={styles.statLabel}>Last clicked</p>
          <p className={styles.statValue}>
            {link.lastClickedAt ? formatTimeAgo(link.lastClickedAt) : <span className={styles.muted}>—</span>}
          </p>
          <p className={styles.statSub}>{link.createdAt ? formatTimeAgo(link.createdAt) : '—'}</p>
        </div>
      </div>
    </section>
  )
}

