// Skeleton — token-only loading placeholder. RSC.
//
// Four variants:
//   - "text"  : rounded bar, 12px tall by default. Renders N stacked
//               bars when `count` is provided (last one is 60% width
//               to suggest a paragraph tail).
//   - "rect"  : custom-shaped rectangle (use width/height for image/
//               thumbnail placeholders).
//   - "avatar": circle at the requested size (default 40px).
//   - "card"  : composite placeholder (rect on top + 2 text lines),
//               used for product / card grids.
//
// All variants pulse via the shared `--bg-elev-2` fill + opacity
// keyframe; honors `prefers-reduced-motion: reduce`.
//
// No client JS shipped — pure presentational. Used by Suspense
// fallbacks + per-route `loading.tsx` + inline loaders in client
// components (search overlay).

import type { CSSProperties } from 'react'
import styles from './Skeleton.module.css'

export type SkeletonVariant = 'text' | 'rect' | 'avatar' | 'card'

export type SkeletonProps = {
  /** Shape preset. Default: 'text'. */
  variant?: SkeletonVariant
  /** Pixel width. Falls through to CSS defaults per variant. */
  width?: number | string
  /** Pixel height. Falls through to CSS defaults per variant. */
  height?: number | string
  /** Number of stacked text bars (only used by variant='text'). Default: 1. */
  count?: number
  /** Border-radius override (px). Useful for non-card rectangles. */
  radius?: number | string
  /** Layout-level class passthrough. */
  className?: string
  /** Inline style passthrough (applied AFTER the variant defaults). */
  style?: CSSProperties
  /** ARIA label for screen readers. Default: 'Loading…'. */
  ariaLabel?: string
}

function toCssSize(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined
  return typeof v === 'number' ? `${v}px` : v
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  count = 1,
  radius,
  className,
  style,
  ariaLabel = 'Loading\u2026',
}: SkeletonProps) {
  // "text" with count>1 stacks N bars (last one is shorter).
  if (variant === 'text' && count > 1) {
    const items = Array.from({ length: count }, (_, i) => i)
    return (
      <span className={[styles.stack, className ?? ''].filter(Boolean).join(' ')} role="status" aria-label={ariaLabel}>
        {items.map((i) => (
          <span
            key={i}
            className={[styles.bar, styles.bar_text, i === count - 1 ? styles.bar_textTail : ''].filter(Boolean).join(' ')}
            aria-hidden="true"
          />
        ))}
      </span>
    )
  }

  const cls = [styles.bar, styles[`v_${variant}`], className ?? ''].filter(Boolean).join(' ')

  const computed: CSSProperties = {
    ...(width !== undefined ? { width: toCssSize(width) } : {}),
    ...(height !== undefined ? { height: toCssSize(height) } : {}),
    ...(radius !== undefined ? { borderRadius: toCssSize(radius) } : {}),
    ...(style ?? {}),
  }

  return <span className={cls} role="status" aria-label={ariaLabel} style={computed} aria-hidden="true" />
}
