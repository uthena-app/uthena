// ErrorState — a token-only primitive for "data load failed"
// placeholders. RSC.
//
// Same shape as EmptyState but with the danger palette (--danger-soft
// tint, --danger icon border) so users can distinguish "there are no
// courses yet" (empty) from "we tried to load your orders and the DB
// returned an error" (error).
//
// This is NOT a route-level error boundary — that's
// `00-foundations/ui/ErrorBoundary.tsx`. ErrorState is for the
// "this section of data failed to load" pattern inside a list
// page.
//
// Action slot is composition-friendly: caller can pass a
// `<Button onClick={...}>Try again</Button>` (caller wraps the
// `'use client'` for the click handler), or a `<Link href="/support">`,
// or a `<form action={retryAction}>`. The primitive itself stays
// server-renderable.

import type { ReactNode } from 'react'
import styles from './ErrorState.module.css'

export type ErrorStateVariant = 'card' | 'plain'

export type ErrorStateProps = {
  /** Short heading. Required. */
  title: ReactNode
  /** Explanation of what failed + what to do next. */
  description?: ReactNode
  /** Optional inline `<code>`-style detail (e.g. short error code). */
  detail?: ReactNode
  /** Decorative icon — wrapped in aria-hidden by default. */
  icon?: ReactNode
  /** CTA slot (Try again button, support link, etc.). */
  action?: ReactNode
  /** Visual treatment. Default: 'card'. */
  variant?: ErrorStateVariant
  /** Layout-level class passthrough. */
  className?: string
  /** Optional aria-label override. */
  ariaLabel?: string
}

export function ErrorState({
  title,
  description,
  detail,
  icon,
  action,
  variant = 'card',
  className,
  ariaLabel,
}: ErrorStateProps) {
  const cls = [styles.wrap, styles[`v_${variant}`], className ?? ''].filter(Boolean).join(' ')
  const label = ariaLabel ?? (typeof title === 'string' ? title : undefined)
  return (
    <div className={cls} role="alert" aria-label={label}>
      {icon ? (
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
      ) : (
        <div className={styles.icon} aria-hidden="true">
          {/* default inline caution glyph — token-only via currentColor */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </div>
      )}
      <div className={styles.title}>{title}</div>
      {description && <div className={styles.body}>{description}</div>}
      {detail && <div className={styles.detail}>{detail}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
