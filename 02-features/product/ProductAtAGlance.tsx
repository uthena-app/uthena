// ProductAtAGlance — the "At a glance" sidebar (the mockup's `.brief`
// block, `mockups/product.html` lines 135–150 and `mockups/styles/
// main.css` lines 313–319). A sticky right-rail card that surfaces
// the product's at-a-glance facts: Format / Modules / License /
// Instructor / Updated, plus Add-to-cart + Preview-curriculum CTAs.
//
// **Five data rows, all sourced from the already-fetched product row**
// (no new query — every value the sidebar shows is already on the
// `getProductBySlug` payload):
//
//   - **Format** — derived from `products.kind` (e.g. "video_course"
//     → "MP4 + PDF + Figma", "ebook" → "PDF + EPUB", "template_pack"
//     → "Figma + Notion"). A `format` text column is a future
//     enhancement (P12.7 course creation wizard lets the partner
//     override the default); for v1 the kind-derived label is the
//     source of truth. The fallback for an unknown kind is "—".
//
//   - **Modules** — `products.total_lesson_count` + `formatDuration`
//     applied to `products.total_duration_seconds` (e.g. "12 modules
//     · 4h 38m"). When `total_lesson_count` is 0, the row hides the
//     module count and shows just the duration (or "—" when no
//     duration either). When the partner hasn't set either (both 0),
//     shows "—".
//
//   - **License** — derives from `products.default_license` using the
//     shared `LICENSE_LABELS` constant from `@features/cart/format`.
//     Renders "<LICENSE> included" with the license code in the teal
//     `<b>` accent (matches the mockup's `.brief .v b` rule — "PLR
//     included"). When no default license, hides the row.
//
//   - **Instructor** — short version of the `ProductInstructor` card.
//     Reads `product.partner.profile.display_name` (the same join the
//     Instructor tab reads); capped at 80 chars; falls back to
//     "Unknown instructor" when no profile row.
//
//   - **Updated** — `products.updated_at` formatted as "Month YYYY"
//     (e.g. "June 2026"). Pure formatter; UTC-stable.
//
// **Why a server component (RSC)**: zero interactivity except the
// "Preview curriculum" CTA, which is extracted to a tiny client
// island (`PreviewCurriculumButton`). Everything else is pure
// presentation of already-fetched data — no event handlers, no state.
//
// **Sticky positioning**: the sidebar uses `position: sticky;
// top: 120px;` so it stays visible as the user scrolls the tab
// panels. Matches `mockups/styles/main.css` line 313 exactly.
//
// **Why a 320 px right rail**: matches the mockup's
// `grid-template-columns: 1fr 320px` (line 297 of main.css). On
// mobile / tablet (< 1024 px) the sidebar stacks below the tabs.

import Link from 'next/link'
import { LICENSE_LABELS } from '@features/cart/format'
import { formatDuration } from './formatDuration'
import { Button } from '@foundations/ui/primitives/Button'
import { PreviewCurriculumButton } from './PreviewCurriculumButton'
import type { LicenseTier, ProductDetail } from '@features/catalog/queries'
import styles from './ProductAtAGlance.module.css'

/** Map a product kind to its at-a-glance format string. Matches the
 *  mockup's "MP4 + PDF + Figma" treatment of the `video_course` kind.
 *  Future enhancement: a `format` text column (P12.7) lets the
 *  partner override the default. */
const FORMAT_BY_KIND: Record<ProductDetail['kind'], string> = {
  video_course: 'MP4 + PDF + Figma',
  ebook: 'PDF + EPUB',
  template_pack: 'Figma + Notion',
  audio_course: 'MP3 + PDF',
  bundle: 'Mixed formats',
  asset_pack: 'ZIP — multiple files',
}

/** Human label for a product kind (used when no kind-specific format
 *  string is registered, or as a fallback). */
const KIND_LABELS: Record<ProductDetail['kind'], string> = {
  video_course: 'Video course',
  ebook: 'Ebook',
  template_pack: 'Template pack',
  audio_course: 'Audio course',
  bundle: 'Bundle',
  asset_pack: 'Asset pack',
}

/** Hard cap on the instructor display name (defensive — partner
 *  pastes don't blow up the sidebar layout). */
const MAX_NAME_LENGTH = 80

/** Pure formatter: ISO timestamp → "Month YYYY" (UTC-stable, so the
 *  value never flickers when the visitor's browser is in a different
 *  timezone). */
function formatUpdated(iso: string | null | undefined): string {
  if (typeof iso !== 'string' || !iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const month = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  const year = d.getUTCFullYear()
  return `${month} ${year}`
}

/** Render the Modules line (e.g. "12 modules · 4h 38m"). */
function formatModules(
  lessonCount: number,
  durationSeconds: number,
): string {
  const safeCount = Math.max(0, Math.trunc(lessonCount) || 0)
  const dur = formatDuration(durationSeconds)
  if (safeCount === 0 && (dur === '0m' || dur === '')) return '—'
  if (safeCount === 0) return dur
  const moduleNoun = safeCount === 1 ? 'module' : 'modules'
  if (dur === '0m' || dur === '') return `${safeCount} ${moduleNoun}`
  return `${safeCount} ${moduleNoun} · ${dur}`
}

type Props = Pick<
  ProductDetail,
  | 'id'
  | 'kind'
  | 'total_lesson_count'
  | 'total_duration_seconds'
  | 'default_license'
  | 'partner'
  | 'updated_at'
  | 'pricing'
> & {
  /**
   * P8.3 — when true, the sidebar's CTA is replaced with a "Subscribe to
   * access" link to `/pricing` instead of the placeholder "Add to cart"
   * button. Mirrors the gate the page-level `<LicenseSelector>` does in
   * the top `.pinfo` column. The sidebar CTA is a forward-looking
   * affordance today (no click handler — the real add-to-cart lives in
   * the top LicenseSelector), but rendering a misleading "Add to cart"
   * for a subscriber-only product would confuse the user. The page
   * passes `subscriberOnlyGated` computed from `product.subscriber_only`
   * + `subscriptionIncluded`.
   */
  subscriberOnlyGated?: boolean
}

export function ProductAtAGlance({
  id,
  kind,
  total_lesson_count,
  total_duration_seconds,
  default_license,
  partner,
  updated_at,
  pricing,
  subscriberOnlyGated = false,
}: Props) {
  const formatLabel = FORMAT_BY_KIND[kind] ?? KIND_LABELS[kind] ?? '—'
  const modulesLabel = formatModules(total_lesson_count, total_duration_seconds)

  // License label — "PLR included" / "MRR included" / "Personal Use
  // included". The teal `<b>` highlights the code. Hidden when no
  // default license is set.
  const licenseCode: LicenseTier | null = default_license
  const licenseLabel = licenseCode ? LICENSE_LABELS[licenseCode] ?? licenseCode.toUpperCase() : null

  // Instructor — short version of ProductInstructor. Uses the same
  // joined `partner.profile.display_name` the Instructor tab reads.
  const instructorName = (() => {
    const raw = partner?.profile?.display_name
    if (typeof raw !== 'string') return null
    const trimmed = raw.trim()
    if (!trimmed) return null
    return trimmed.length > MAX_NAME_LENGTH
      ? trimmed.slice(0, MAX_NAME_LENGTH - 1) + '…'
      : trimmed
  })()

  // Add to cart — only available when the product has at least one
  // active pricing tier. The CTA in the brief mirrors the top
  // LicenseSelector's primary action; the wizard lands in P12.6.
  const hasActivePricing = pricing.some((p) => p.is_active)

  // Updated — "June 2026" etc.
  const updatedLabel = formatUpdated(updated_at)

  return (
    <aside className={styles.brief} aria-label="At a glance">
      <h5 className={styles.h5}>At a glance</h5>

      <div className={styles.row}>
        <span className={styles.label}>Format</span>
        <div className={styles.value}>{formatLabel}</div>
      </div>

      <hr className={styles.divider} />

      <div className={styles.row}>
        <span className={styles.label}>Modules</span>
        <div className={styles.value}>{modulesLabel}</div>
      </div>

      {licenseLabel && (
        <>
          <hr className={styles.divider} />
          <div className={styles.row}>
            <span className={styles.label}>License</span>
            <div className={styles.value}>
              <b>{licenseLabel}</b> included
            </div>
          </div>
        </>
      )}

      {instructorName && (
        <>
          <hr className={styles.divider} />
          <div className={styles.row}>
            <span className={styles.label}>Instructor</span>
            <div className={styles.value}>
              {partner?.public_slug ? (
                <Link href={`/partners/${partner.public_slug}`} className={styles.link}>
                  {instructorName}
                </Link>
              ) : (
                instructorName
              )}
            </div>
          </div>
        </>
      )}

      <hr className={styles.divider} />

      <div className={styles.row}>
        <span className={styles.label}>Updated</span>
        <div className={styles.value}>{updatedLabel}</div>
      </div>

      <div className={styles.cta}>
        {subscriberOnlyGated ? (
          <Link href="/pricing" className={styles.link} aria-label="See Personal Access subscription">
            <Button variant="primary" size="lg" fullWidth iconRight={<span aria-hidden>→</span>}>
              See Personal Access
            </Button>
          </Link>
        ) : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={!hasActivePricing}
            aria-label={
              hasActivePricing
                ? `Add ${kind} to cart`
                : 'Add to cart is unavailable — no active pricing'
            }
          >
            Add to cart
          </Button>
        )}
        <PreviewCurriculumButton instanceId={`product-${id}`} />
      </div>
    </aside>
  )
}
