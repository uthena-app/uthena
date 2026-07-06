'use client'

// Product gallery — 16:9 main + up to 4 thumbnail slots. The first
// gallery image is the main by default; clicking a thumb swaps the
// main. A "video" slot is inserted at position #1 when the product
// has a preview video URL.
//
// Why a client component: the active-thumb state is local UI state.
// The initial state is server-rendered (first image active), so SSR
// still produces a meaningful first paint — a no-JS user just sees
// the first image in the main slot, with the thumbs row inert.
//
// Mockup parity: `mockups/product.html` lines 47–58. Token-only
// styles in `./ProductGallery.module.css`. The video slot is visual
// only — actual video playback wires in Phase 9 (P9.2) with Bunny
// signed stream URLs.

import { useState } from 'react'
import type { ProductImage } from '@features/catalog/queries'
import styles from './ProductGallery.module.css'

type Props = {
  /** Fallback cover URL when the product has no gallery images. */
  fallbackUrl: string | null
  /** Alt text for the fallback cover. */
  fallbackAlt: string
  /** Ordered gallery images (first by display_order is the main). */
  images: ProductImage[]
  /** True when `products.preview_video_url` is set. */
  hasPreviewVideo: boolean
}

/**
 * What the main slot is currently showing. The video state is a
 * placeholder until Phase 9 wires real video playback; the UI
 * surfaces a "▶ Preview" affordance the same way the mockup does.
 */
type MainState =
  | { kind: 'image'; url: string; alt: string }
  | { kind: 'video' }

export function ProductGallery({
  fallbackUrl,
  fallbackAlt,
  images,
  hasPreviewVideo,
}: Props) {
  // The first non-video image is the initial main. Falls back to the
  // product's thumbnail_url when no product_images rows exist.
  const firstImage = images.find((i) => i.kind === 'gallery')
  const initial: MainState = firstImage
    ? { kind: 'image', url: firstImage.url, alt: firstImage.alt || fallbackAlt }
    : fallbackUrl
      ? { kind: 'image', url: fallbackUrl, alt: fallbackAlt }
      : { kind: 'video' }

  const [main, setMain] = useState<MainState>(initial)
  const [activeSlot, setActiveSlot] = useState<number>(0)

  // Build the thumbnail row. Slot 0 is always the first gallery image
  // (or the fallback). When preview_video_url is set, slot 1 is the
  // video slot. After that, up to two more gallery images round out
  // the row (mockup-faithful 4-thumbs layout).
  const galleryImages = images.filter((i) => i.kind === 'gallery')
  const slots: Array<
    | { kind: 'image'; url: string; alt: string; onClick: () => void }
    | { kind: 'video'; onClick: () => void }
  > = []
  if (galleryImages[0] || fallbackUrl) {
    slots.push({
      kind: 'image',
      url: galleryImages[0]?.url ?? fallbackUrl ?? '',
      alt: galleryImages[0]?.alt || fallbackAlt,
      onClick: () => {
        if (galleryImages[0]) {
          setMain({
            kind: 'image',
            url: galleryImages[0].url,
            alt: galleryImages[0].alt || fallbackAlt,
          })
        } else if (fallbackUrl) {
          setMain({ kind: 'image', url: fallbackUrl, alt: fallbackAlt })
        }
        setActiveSlot(0)
      },
    })
  }
  if (hasPreviewVideo) {
    slots.push({
      kind: 'video',
      onClick: () => {
        setMain({ kind: 'video' })
        setActiveSlot(slots.length)
      },
    })
  }
  for (let i = 1; i < galleryImages.length && slots.length < 4; i++) {
    const img = galleryImages[i]
    if (!img) continue
    slots.push({
      kind: 'image',
      url: img.url,
      alt: img.alt || fallbackAlt,
      onClick: () => {
        setMain({ kind: 'image', url: img.url, alt: img.alt || fallbackAlt })
        setActiveSlot(slots.length)
      },
    })
  }

  return (
    <div className={styles.gallery}>
      <div className={styles.main}>
        {main.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={main.url} alt={main.alt} className={styles.mainImg} />
        ) : (
          <div className={styles.mainVideo} aria-label="Preview video">
            <span className={styles.playGlyph} aria-hidden>
              ▶
            </span>
            <span className={styles.playLabel}>Preview</span>
          </div>
        )}
        {hasPreviewVideo && main.kind !== 'video' && (
          <span className={styles.mainPlay} aria-hidden>
            ▶ Preview
          </span>
        )}
      </div>
      {slots.length > 1 && (
        <div className={styles.thumbs} role="tablist" aria-label="Gallery">
          {slots.map((slot, idx) => (
            <button
              key={`${slot.kind}-${idx}`}
              type="button"
              role="tab"
              aria-selected={activeSlot === idx}
              aria-label={
                slot.kind === 'image'
                  ? `Show image ${idx + 1} of ${slots.length}`
                  : 'Show preview video'
              }
              onClick={slot.onClick}
              className={`${styles.thumb} ${activeSlot === idx ? styles.thumbOn : ''} ${
                slot.kind === 'video' ? styles.thumbVideo : ''
              }`.trim()}
            >
              {slot.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={slot.url} alt="" className={styles.thumbImg} />
              ) : (
                <>
                  <span className={styles.thumbPlay} aria-hidden>
                    ▶
                  </span>
                  <span className={styles.thumbVidLabel}>PREVIEW</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
