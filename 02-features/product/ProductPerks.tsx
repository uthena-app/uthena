// ProductPerks — the `.pinfo .perks` block at the bottom of the product
// detail page's right column. Mockup-faithful to
// `mockups/product.html` lines 101–106 and `mockups/styles/main.css`
// lines 293–295:
//
//   ✓ Earn money reselling this course
//   ✓ 100% PLR license — rebrand freely
//   ✓ Downloadable video, slides, scripts
//   ✓ Edit, modify, repackage to your needs
//
// The block is a pure server component (no interactivity): it reads
// `product.bullets` (a JSONB array of strings, migration 0013) and
// renders each entry with a teal check-circle prefix.
//
// **Three render modes** (semantically meaningful):
//   1. `bullets === null` — partner hasn't set any bullets yet.
//      Renders the 4 mockup-faithful fallback items. This is the
//      "fresh product / before the partner fills in the wizard"
//      state. Spec: `01-specs/pages/product.md` § Data this page shows.
//   2. `bullets === []` — partner explicitly cleared the list.
//      Renders nothing. This is the "no perks for this product"
//      intent — different from "hasn't been set".
//   3. `bullets.length > 0` — renders the partner's bullets, capped
//      at MAX_BULLET_COUNT items × MAX_BULLET_LENGTH chars per item.
//
// **Why a single component with fallback logic** (and not two
// components — `<ProductPerks bullets=...>` + `<ProductPerksFallback />`):
// the page just passes `product.bullets` and gets the right render
// without conditional JSX. The fallback constant lives in this file
// (next to the component that uses it) instead of a separate
// `copy/perks.ts` because the fallback IS the mockup copy — it's
// not a marketing constant, it's a rendering default. If Phase 19
// needs a different fallback, the constant can move to `copy/`
// then.
//
// **Why no `<ul>` / `<li>`:** the mockup uses `<div class="item">`
// inside `<div class="perks">`. This is a visual list but not a
// semantic one (no inherent ordering, no list-of-equivalent-items
// semantics for assistive tech that the existing inline `.lede`
// doesn't already provide). Each item is a single sentence; we
// use `<div role="list">` to preserve the implicit list semantics
// for screen readers, with `aria-label="What's included"` so the
// region has a meaningful name when scanned.

import styles from './ProductPerks.module.css'

/** Mockup-faithful 4-item fallback (lines 102–105 of mockups/product.html). */
const FALLBACK_BULLETS: readonly string[] = [
  'Earn money reselling this course',
  '100% PLR license — rebrand freely',
  'Downloadable video, slides, scripts',
  'Edit, modify, repackage to your needs',
] as const

/** Hard cap on rendered bullets — keeps the list from blowing up the layout. */
const MAX_BULLET_COUNT = 8

/** Hard cap on each bullet's length — defensively trims partner-typed content. */
const MAX_BULLET_LENGTH = 200

type Props = {
  /**
   * JSONB array of plain strings from `products.bullets` (migration 0013).
   * Null = use the mockup-faithful fallback. Empty array = render nothing.
   */
  bullets: string[] | null
}

/** Normalize one bullet: coerce to string, trim whitespace, cap length. */
function normalizeBullet(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.length > MAX_BULLET_LENGTH
    ? trimmed.slice(0, MAX_BULLET_LENGTH - 1) + '…'
    : trimmed
}

export function ProductPerks({ bullets }: Props) {
  // Resolve the effective list. Null = fallback. Empty = nothing.
  // Array = the array (normalized).
  const source: readonly unknown[] | null =
    bullets === null
      ? FALLBACK_BULLETS
      : bullets.length === 0
        ? null
        : bullets

  if (source === null) return null

  // Normalize + cap + drop empties.
  const items: string[] = []
  for (const raw of source) {
    if (items.length >= MAX_BULLET_COUNT) break
    const norm = normalizeBullet(raw)
    if (norm) items.push(norm)
  }

  if (items.length === 0) return null

  return (
    <div className={styles.perks} role="list" aria-label="What's included">
      {items.map((item, idx) => (
        <div key={idx} className={styles.item} role="listitem">
          <span className={styles.check} aria-hidden>
            ✓
          </span>
          <span className={styles.text}>{item}</span>
        </div>
      ))}
    </div>
  )
}