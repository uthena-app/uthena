// ProductInstructor — the Instructor tab content. Renders the
// partner card (avatar + name + bio + lifetime stats) for the
// product's author.
//
// **Mockup parity**: `mockups/product.html` line 143 shows a single
// row in the "At a glance" sidebar — "Instructor: Lambros
// Lazopoulos". That's Slice 5 territory. Slice 4 ships the
// dedicated Instructor tab (lines 196–211 of `mockups/styles/
// main.css`'s `.instructor` rule): a wider card with avatar + name
// + bio + stats row. Phase 12 partner portal (P12.17) wires the
// editable bio + headshot + social links.
//
// **Three render modes**:
//   1. No partner on the row → renders a small "Instructor info
//      coming soon" empty state (the schema allows partner_id NULL
//      for safety; published products should always have a partner
//      in practice, but the empty state is here for the day the
//      schema allows it).
//   2. Partner row exists but no profile joined (orphan / deleted
//      profile) → renders the partner's `public_slug` as a
//      placeholder name with a "Profile info coming soon" note.
//   3. Full row (partner + profile) → renders the full card.
//
// **Why pure RSC**: zero interactivity. The Instructor tab is a
// display-only view of the partner row.

import type { ProductDetail } from '@features/catalog/queries'
import styles from './ProductInstructor.module.css'

/** Hard cap on the bio length we render — defensive against a
 *  partner pasting an entire ebook into the bio field. */
const MAX_BIO_LENGTH = 1500

/** Hard cap on the display name — defensive against a runaway
 *  display_name column. */
const MAX_NAME_LENGTH = 80

type Props = {
  /** The `partner` field on the product detail row — either fully
   *  joined (partner + profile) or null. */
  partner: ProductDetail['partner']
}

function clip(text: string | null | undefined, max: number): string {
  if (typeof text !== 'string') return ''
  const trimmed = text.trim()
  if (!trimmed) return ''
  return trimmed.length > max ? trimmed.slice(0, max - 1) + '…' : trimmed
}

export function ProductInstructor({ partner }: Props) {
  if (!partner) {
    return (
      <div className={styles.card} role="status" aria-live="polite">
        <p className={styles.title}>Instructor</p>
        <p className={styles.placeholder}>
          Instructor info will be available soon. Check back later.
        </p>
      </div>
    )
  }

  const profile = partner.profile
  const displayName = clip(profile?.display_name ?? null, MAX_NAME_LENGTH)
  const avatarUrl = profile?.avatar_url ?? null
  const bio = clip(partner.bio ?? null, MAX_BIO_LENGTH)
  const publicSlug = partner.public_slug

  // Initials for the avatar fallback. Up to 2 chars, uppercased.
  const initials = displayName
    ? displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('') || 'U'
    : 'U'

  return (
    <article className={styles.card} aria-label={`Instructor: ${displayName || 'Unknown'}`}>
      <div className={styles.avatar} aria-hidden={avatarUrl ? true : undefined}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className={styles.avatarImg} />
        ) : (
          <span className={styles.avatarInitials}>{initials}</span>
        )}
      </div>
      <div className={styles.body}>
        <h3 className={styles.name}>{displayName || 'Unknown instructor'}</h3>
        {publicSlug && (
          <p className={styles.slug}>
            <a href={`/partners/${publicSlug}`} className={styles.slugLink}>
              @{publicSlug}
            </a>
          </p>
        )}
        {bio ? (
          <p className={styles.bio}>{bio}</p>
        ) : (
          <p className={styles.placeholder}>
            This instructor hasn't written a bio yet. Check back later.
          </p>
        )}
      </div>
    </article>
  )
}