// AboutCard — P13.8 public mini-shop "About the curator" section.
//
// Renders the affiliate's longer bio + a small stats card. Per spec
// at affiliate-minishop.md:18, the section reads:
//   - bio (longer version)
//   - stats (lifetime earned, followers, joined date, verified badge)
//
// "Followers" isn't a real concept today (no follow system per
// the v1 scope in the spec line 33), so we render 3 stats instead
// of 4: lifetime earned, joined date, verified. The followers
// stat slot is intentionally dropped — it would always show "—"
// or "0" today, which is the dishonest UX the spec is trying to
// avoid (per the same "no follow system (v2)" line).
//
// RSC, zero client JS.

import { formatMoneyShort } from '@foundations/money/cents'
import type { ShopAffiliate, ShopProfile } from '../queries/getMiniShop'
import styles from './AboutCard.module.css'

export function AboutCard({
  affiliate,
  profile,
  lifetimeEarnedCents,
}: {
  affiliate: ShopAffiliate
  profile: ShopProfile
  lifetimeEarnedCents: number
}) {
  const displayName = profile.displayName || `@${affiliate.handle}`
  const bio = (affiliate.bio ?? '').trim()
  const joined = formatJoinedDate(affiliate.createdAt ?? affiliate.approvedAt)

  return (
    <aside
      className={styles.card}
      aria-labelledby="minishop-about-heading"
    >
      <span className={styles.eyebrow}>About the curator</span>
      <h2 id="minishop-about-heading" className={styles.h2}>
        {displayName}
      </h2>
      {bio ? (
        <p className={styles.bio}>{bio}</p>
      ) : (
        <p className={styles.bioMuted}>
          This curator hasn't added a bio yet.
        </p>
      )}
      <dl className={styles.stats}>
        <div className={styles.statRow}>
          <dt className={styles.statLabel}>Lifetime earned</dt>
          <dd className={styles.statValue}>
            {formatMoneyShort(lifetimeEarnedCents)}
          </dd>
        </div>
        <div className={styles.statRow}>
          <dt className={styles.statLabel}>Joined</dt>
          <dd className={styles.statValue}>{joined}</dd>
        </div>
        <div className={styles.statRow}>
          <dt className={styles.statLabel}>Status</dt>
          <dd className={styles.statValue}>
            {affiliate.status === 'approved' ? (
              <span className={styles.verifiedChip}>
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden
                  focusable="false"
                  className={styles.verifiedChipIcon}
                >
                  <path
                    d="M6.5 11.5l-2.5-2.5 1.1-1.1 1.4 1.4 4.4-4.4 1.1 1.1z"
                    fill="currentColor"
                  />
                </svg>
                Verified affiliate
              </span>
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>
    </aside>
  )
}

function formatJoinedDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const month = d.toLocaleString('en-US', { month: 'long' })
  const year = d.getUTCFullYear()
  if (year <= 0) return '—'
  return `${month} ${year}`
}
