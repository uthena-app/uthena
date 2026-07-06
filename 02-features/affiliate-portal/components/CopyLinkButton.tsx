// CopyLinkButton.tsx — P13.5 client island for copying a link URL.
//
// Uses the modern async Clipboard API (`navigator.clipboard.writeText`)
// when available, with a graceful `document.execCommand('copy')`
// fallback for older Safari + the (rare) `file://` preview path
// where the Clipboard API is gated. After a successful copy the
// button briefly flips to a "Copied" state via the
// `[data-just-copied="true"]` attribute selector on .module.css.
//
// The button also fires `toast.success('Link copied')` via the
// platform Toast provider so screen-reader users get a live-region
// announcement (the visual flip can be missed; the toast can't).
//
// Renders a single <button>. Visibility / disabled states are
// driven by props, not internal state. The component owns:
//   - The clipboard round-trip
//   - The 1.6s "just-copied" visual flip
//   - The success toast
//
// It does NOT own:
//   - The disabled tooltip (rendered by the parent if the button
//     is disabled with a "coming in v2" tooltip etc.)
//
// Spec: 01-specs/pages/affiliate-links.md acceptance #7 ("'Copy URL'
// works on all browsers (clipboard API with fallback) and shows a
// success toast").

'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { useToast } from '@foundations/ui/Toast'
import styles from './CopyLinkButton.module.css'

const JUST_COPIED_MS = 1600

export type CopyLinkButtonProps = {
  /** The text to copy to the clipboard. */
  text: string
  /** Button label when idle (default: "Copy"). */
  label?: string
  /** Button label in the just-copied state (default: "Copied"). */
  copiedLabel?: string
  /** Toast message on success (omit to suppress toast). */
  toastMessage?: string
  /** Optional icon to render before the label. */
  icon?: ReactNode
  /** Stretch the button to fill its container width. */
  fullWidth?: boolean
  /** Disable the button (no click handler). */
  disabled?: boolean
  /** Optional accessible label override. */
  ariaLabel?: string
}

export function CopyLinkButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  toastMessage = 'Link copied',
  icon,
  fullWidth,
  disabled,
  ariaLabel,
}: CopyLinkButtonProps) {
  const [justCopied, setJustCopied] = useState(false)
  const toast = useToast()

  const handleClick = useCallback(async () => {
    if (disabled) return
    let copied = false
    try {
      // Modern path — async Clipboard API. Requires a secure context
      // (https or localhost); falls through to the legacy path otherwise.
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text)
        copied = true
      }
    } catch {
      copied = false
    }

    // Legacy fallback — `document.execCommand('copy')` against a
    // detached textarea. `execCommand` is deprecated but every
    // current browser still ships it (and it's the only path that
    // works in non-secure contexts + a couple of WebView shells).
    if (!copied) {
      try {
        if (typeof document !== 'undefined') {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.setAttribute('readonly', '')
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          ta.style.pointerEvents = 'none'
          document.body.appendChild(ta)
          ta.select()
          const ok = document.execCommand('copy')
          document.body.removeChild(ta)
          copied = ok === true
        }
      } catch {
        copied = false
      }
    }

    if (copied) {
      setJustCopied(true)
      // `toast.success` is the canonical notification path (live
      // region role=status). Fires even if the visual flip is missed.
      toast.success(toastMessage, { durationMs: JUST_COPIED_MS })
      // Schedule the visual flip reset. useState-batched timing means
      // a manual setTimeout is the right primitive here (effect-based
      // timing would re-run on every render).
      setTimeout(() => setJustCopied(false), JUST_COPIED_MS)
    } else {
      toast.error('Could not copy — please select the URL and copy manually.')
    }
  }, [text, disabled, toast, toastMessage])

  const cls = [styles.btn, fullWidth ? styles.fullWidth : ''].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={cls}
      onClick={handleClick}
      disabled={disabled}
      data-just-copied={justCopied ? 'true' : 'false'}
      aria-label={ariaLabel ?? (justCopied ? `${copiedLabel} (${text})` : `${label}: ${text}`)}
    >
      {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
      <span className={styles.btnLabel}>{justCopied ? copiedLabel : label}</span>
    </button>
  )
}
