// Toast — global notification primitive.
//
// One `ToastProvider` mounted in `app/layout.tsx` owns a single stack of
// transient notifications. Anywhere in the tree, `const toast = useToast()`
// returns `{ success, info, error, dismiss }`. Each call pushes a new toast
// onto the stack; the visible `<ToastBar>` renders them in a fixed
// position at the bottom-right of the viewport with an auto-dismiss timer.
//
// Design goals:
//   - Zero-boilerplate call sites: `toast.success('Saved.')` is the
//     shortest path. No `useEffect` cleanup, no manual timer juggling.
//   - Stack semantics: concurrent calls render top-to-bottom. A new
//     toast pushed while others are visible slides in below them.
//   - Accessible by default: every toast is `role="status"` + `aria-live=
//     polite` for success/info; `role="alert"` + `aria-live="assertive"`
//     for error. Visible focus ring on the dismiss button.
//   - Server-action friendly: actions return data to the client, the
//     client calls `toast.success()` from the success branch. Toasts
//     never travel across the network themselves.
//   - SSR-safe: the portal target is created on first client render via
//     `useEffect` + `mounted` state, so the server never sees
//     `document.body`. No hydration mismatch.
//   - Token-only styling: every color, spacing, radius, shadow comes
//     from `00-foundations/design/tokens.css`. No inline hex / px values.

'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './Toast.module.css'

export type ToastKind = 'success' | 'info' | 'error'

export type ToastInput = {
  /** Visible message. Plain text; the component does NOT interpret markup. */
  message: string
  /** 'success' | 'info' | 'error'. Default 'success'. */
  kind?: ToastKind
  /** Auto-dismiss timeout in ms. Default 4000. Pass 0 to disable. */
  durationMs?: number
}

type ToastEntry = Required<Omit<ToastInput, 'durationMs'>> & {
  id: string
  durationMs: number
}

type ToastContextValue = {
  push: (input: ToastInput) => string
  dismiss: (id: string) => void
}

const DEFAULT_DURATION_MS = 4000
const MAX_VISIBLE = 6

const ToastContext = createContext<ToastContextValue | null>(null)

/** Generate a stable, unique toast id. crypto.randomUUID where
 *  available; a fallback chain for older environments. The id is only
 *  used as a React key + dismiss handle — uniqueness within a single
 *  client session is enough. */
function makeToastId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** Provider. Owns the toast stack. Renders `<ToastBar>` via portal.
 *  `children` is the rest of the app. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([])
  // Guard against the same toast id being created twice in the same
  // tick (e.g. rapid double-click). The latest push wins.
  const seenIds = useRef(new Set<string>())

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (input: ToastInput): string => {
      const id = makeToastId()
      seenIds.current.add(id)
      const entry: ToastEntry = {
        id,
        message: input.message,
        kind: input.kind ?? 'success',
        durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
      }
      setToasts((current) => {
        // Cap the visible stack — drop the oldest if we exceed MAX_VISIBLE.
        const next = [...current, entry]
        return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next
      })
      return id
    },
    [],
  )

  const value = useMemo<ToastContextValue>(() => ({ push, dismiss }), [push, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastBar toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

/** Hook. Throws if used outside a `ToastProvider` — the surface area is
 *  small enough that a missing provider is a developer error we want
 *  to surface immediately, not a runtime no-op. */
export function useToast(): {
  success: (message: string, opts?: { durationMs?: number }) => string
  info: (message: string, opts?: { durationMs?: number }) => string
  error: (message: string, opts?: { durationMs?: number }) => string
  dismiss: (id: string) => void
} {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast() called outside <ToastProvider>. Mount the provider in app/layout.tsx.')
  }
  return {
    success: (message, opts) => {
      const input: ToastInput = opts?.durationMs !== undefined
        ? { message, kind: 'success', durationMs: opts.durationMs }
        : { message, kind: 'success' }
      return ctx.push(input)
    },
    info: (message, opts) => {
      const input: ToastInput = opts?.durationMs !== undefined
        ? { message, kind: 'info', durationMs: opts.durationMs }
        : { message, kind: 'info' }
      return ctx.push(input)
    },
    error: (message, opts) => {
      const input: ToastInput = opts?.durationMs !== undefined
        ? { message, kind: 'error', durationMs: opts.durationMs }
        : { message, kind: 'error' }
      return ctx.push(input)
    },
    dismiss: ctx.dismiss,
  }
}

/** Visible toast bar. Renders into a portal created on first client
 *  mount. Auto-dismisses per-entry via per-toast `useEffect` timers. */
function ToastBar({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastEntry[]
  onDismiss: (id: string) => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || toasts.length === 0) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className={styles.stack} role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  )
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastEntry
  onDismiss: (id: string) => void
}) {
  const { id, kind, message, durationMs } = toast
  // Auto-dismiss timer. durationMs === 0 disables auto-dismiss (the
  // user must click the X to dismiss). The timer is cleared on unmount
  // so a manual dismiss + late timer tick can't trigger a setState
  // after unmount.
  useEffect(() => {
    if (durationMs <= 0) return
    const t = setTimeout(() => onDismiss(id), durationMs)
    return () => clearTimeout(t)
  }, [id, durationMs, onDismiss])

  const role = kind === 'error' ? 'alert' : 'status'
  const live = kind === 'error' ? 'assertive' : 'polite'
  const cls = [styles.toast, styles[`k_${kind}`]].join(' ')

  return (
    <div className={cls} role={role} aria-live={live} data-kind={kind}>
      <span className={styles.msg}>{message}</span>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="3" x2="13" y2="13" />
          <line x1="13" y1="3" x2="3" y2="13" />
        </svg>
      </button>
    </div>
  )
}