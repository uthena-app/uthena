'use client'

// MiniShopPreview — /affiliate/settings live preview card.
//
// **Spec requirement:** the affiliate surface must show "this is
// what your mini-shop looks like" as the user edits their bio +
// display_name. The card sits on the right (or below on mobile)
// of the ProfileSection and updates on every keystroke.
//
// **Implementation choice:** per `affiliate-settings.md` §Open
// Questions §2, the recommendation is "styled approximation"
// (lighter, ~2KB client JS, no extra query). Re-rendering the
// real `<MiniShopHero>` would require (a) shipping the full
// mini-shop component tree to the settings page, (b) re-fetching
// the affiliate's product list, and (c) ignoring all the
// unrelated sections (TrustStrip, FeaturedPick, etc.) that the
// Profile edits don't affect.
//
// **Defensive fallbacks (match the public MiniShopHero):**
//   - displayName empty / whitespace-only → render `@handle`
//   - bio empty / whitespace-only → render "Curated picks by
//     @handle" (the public hero's placeholder copy)
//   - always render the "Verified affiliate" pill (matches the
//     public hero's verified badge — gated on `status = approved`
//     on the public side; the settings preview assumes the
//     affiliate is on the verified surface)
//
// **A11y:** the preview is a *decorative mirror* of the editable
// fields. Screen readers should skip it (aria-hidden on the
// root) so they don't read duplicate content.

import styles from './MiniShopPreview.module.css'

type MiniShopPreviewProps = {
  displayName: string
  bio: string
  /** The affiliate's public handle (shown in the eyebrow + used
   *  in fallback copy). */
  handle: string
}

export function MiniShopPreview({ displayName, bio, handle }: MiniShopPreviewProps) {
  // Trim once so the fallbacks and the rendered values share the
  // same trim semantics as the public MiniShopHero.
  const trimmedName = displayName.trim()
  const trimmedBio = bio.trim()
  const nameDisplay = trimmedName.length > 0 ? trimmedName : `@${handle}`
  const bioDisplay =
    trimmedBio.length > 0
      ? trimmedBio
      : `Curated picks by @${handle}`

  return (
    <div
      className={styles.preview}
      aria-hidden="true"
      aria-label="Mini-shop preview"
    >
      <div className={styles.heroCard}>
        <p className={styles.eyebrow}>@{handle}</p>
        <p className={styles.name}>{nameDisplay}</p>
        <p className={styles.bio}>{bioDisplay}</p>
        <span className={styles.verified}>Verified affiliate</span>
      </div>
    </div>
  )
}