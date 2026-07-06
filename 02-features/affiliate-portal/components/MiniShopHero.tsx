// MiniShopHero — P13.8 public mini-shop /[handle] hero section.
//
// Mirrors the partner/affiliate dashboard header rhythm (eyebrow + h1
// + lede + status pill) but applied to the PUBLIC-facing context:
// the eyebrow is the handle, the headline is the affiliate's
// display name, the lede is the bio, and the pill is a teal
// "Verified affiliate" badge (per spec §"Verified affiliate"
// acceptance #10 — only renders when the affiliate row's status
// is 'approved').
//
// The right side of the hero surfaces 4 stat tiles: curated count,
// lifetime earned, clicks_30d, avg rating. The spec lists "product
// count, visitor count, lifetime earned, avg rating" — we render
// those four labels (with the same data the query reads; spec says
// "visitor count" but the page surfaces clicks_30d because that's
// the only visitor-shaped signal the schema has today — clicking
// 30d is close enough for the hero stat panel).
//
// RSC, zero client JS.

import { formatMoneyShort } from '@foundations/money/cents'
import type { CuratedProduct, ShopAffiliate, ShopProfile } from '../queries/getMiniShop'
import styles from './MiniShopHero.module.css'

export function MiniShopHero({
  affiliate,
  profile,
  curatedProducts,
  lifetimeEarnedCents,
  clicks30d,
  avgRating,
}: {
  affiliate: ShopAffiliate
  profile: ShopProfile
  curatedProducts: ReadonlyArray<CuratedProduct>
  lifetimeEarnedCents: number
  clicks30d: number
  avgRating: number | null
}) {
  const displayName = profile.displayName || `@${affiliate.handle}`
  const brandLabel = affiliate.brandName ?? displayName
  const heroLede = (affiliate.bio ?? '').trim() || `Curated picks by @${affiliate.handle}`

  return (
    <header className={styles.hero} aria-labelledby="minishop-hero-heading">
      <div className={styles.identity}>
        <span className={styles.eyebrow}>@{affiliate.handle}</span>
        <h1 id="minishop-hero-heading" className={styles.h1}>
          {brandLabel}
        </h1>
        <p className={styles.lede}>{heroLede}</p>
        {affiliate.status === 'approved' && (
          <span className={styles.verifiedBadge} aria-label="Verified affiliate">
            <svg
              viewBox="0 0 16 16"
              className={styles.verifiedIcon}
              aria-hidden
              focusable="false"
            >
              <path
                d="M6.5 11.5l-2.5-2.5 1.1-1.1 1.4 1.4 4.4-4.4 1.1 1.1z"
                fill="currentColor"
              />
            </svg>
            Verified affiliate
          </span>
        )}
      </div>
      <aside className={styles.stats} aria-label="Affiliate stats">
        <StatTile label="Curated products" value={String(curatedProducts.length)} />
        <StatTile
          label="Lifetime earned"
          value={formatMoneyShort(lifetimeEarnedCents)}
        />
        <StatTile
          label="Clicks (30d)"
          value={clicks30d.toLocaleString('en-US')}
        />
        <StatTile
          label="Avg rating"
          value={avgRating !== null ? avgRating.toFixed(1) : '—'}
          srHint={avgRating === null ? 'No reviews yet' : undefined}
        />
      </aside>
      {profile.avatarUrl && (
        <span className={styles.avatar} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profile.avatarUrl}
            alt=""
            className={styles.avatarImg}
            loading="eager"
            decoding="async"
          />
        </span>
      )}
    </header>
  )
}

function StatTile({
  label,
  value,
  srHint,
}: {
  label: string
  value: string
  srHint?: string | undefined
}) {
  return (
    <div className={styles.statTile}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd
        className={styles.statValue}
        aria-label={srHint ? `${value} (${srHint})` : value}
      >
        {value}
      </dd>
    </div>
  )
}
