// EmptyState — a token-only primitive for "no data" placeholders. RSC.
// Two visual variants:
//   - "card" (default) — dashed-border surface with `--bg-elev-1` fill,
//     used as the primary list/page empty (browse, collections, home
//     featured grid).
//   - "plain" — no border, no fill, just centered text. Used inside
//     surfaces that already provide their own chrome (the search
//     overlay's modal body, the cart drawer, the sidebar's "no
//     sessions" line).
//
// Icon is decorative — wrapped in aria-hidden so screen readers get the
// title instead of "image". Action is a composition slot: caller
// passes any ReactNode (Link, Button, custom call-to-action).
//
// No business logic — pass the strings/actions in; component stays
// dumb. This matches the AGENTS.md "no business logic in primitives"
// rule.

import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

export type EmptyStateVariant = 'card' | 'plain'

export type EmptyStateProps = {
  /** Short, plain-language heading. Required. */
  title: ReactNode
  /** One-or-two-sentence explanation. Plain text or inline JSX. */
  description?: ReactNode
  /** Decorative icon — wrapped in aria-hidden by default. */
  icon?: ReactNode
  /** CTA slot. Typically a `<Link>` or `<Button>`. */
  action?: ReactNode
  /** Visual treatment. Default: 'card'. */
  variant?: EmptyStateVariant
  /** Layout-level class passthrough. */
  className?: string
  /** ARIA role override. Default: 'status' (live region polite). */
  role?: 'status' | 'region'
  /** Optional aria-label override (falls back to title when string). */
  ariaLabel?: string
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  variant = 'card',
  className,
  role = 'status',
  ariaLabel,
}: EmptyStateProps) {
  const cls = [styles.wrap, styles[`v_${variant}`], className ?? ''].filter(Boolean).join(' ')
  const label = ariaLabel ?? (typeof title === 'string' ? title : undefined)
  return (
    <div className={cls} role={role} aria-label={label} aria-live="polite">
      {icon && (
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
      )}
      <div className={styles.title}>{title}</div>
      {description && <div className={styles.body}>{description}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
