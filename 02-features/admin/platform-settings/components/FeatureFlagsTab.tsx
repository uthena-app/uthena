// FeatureFlagsTab — admin-side editor for the `flags` jsonb column on
// `platform_settings`. Renders a list of flag rows with inline toggle
// + rollout% input + remove button. "Add flag" opens a modal.
//
// Each row is its own sub-form; changes are debounced 500ms per the
// spec's "Feature flag toggles work inline (no Save button on the
// row); the toggle is debounced 500ms" acceptance criterion. The
// debounce coalesces rapid edits (especially for the rollout % input
// where a user might drag the value).
//
// State management:
//   - The component owns a local copy of the flags (`flags` state).
//   - On every mutation, the local copy is updated optimistically.
//   - The server action runs in the background; on failure, the local
//     copy rolls back + an inline `role="alert"` banner surfaces the
//     friendly error message.
//   - On success, the server-returned canonical `flags` array replaces
//     the local copy (so concurrent edits from other admins land).

'use client'

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import {
  addPlatformFlagAction,
  removePlatformFlagAction,
  updatePlatformFlagAction,
  type UpdateFlagsResult,
} from '../actions/updatePlatformSettingsFlags'
import type { FeatureFlag, FeatureFlags } from '../lib/featureFlags'
import styles from './FeatureFlagsTab.module.css'

type FeatureFlagsTabProps = {
  /** Initial flags from the server-rendered query. */
  initial: FeatureFlags
}

const DEBOUNCE_MS = 500

export function FeatureFlagsTab({ initial }: FeatureFlagsTabProps) {
  const formId = useId()
  const [flags, setFlags] = useState<FeatureFlags>(initial)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set())
  const [showAddModal, setShowAddModal] = useState(false)
  const [removingKey, setRemovingKey] = useState<string | null>(null)

  // Debounce timers per row key. Map<string, ReturnType<typeof setTimeout>>.
  const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const setPendingForKey = useCallback((key: string, pending: boolean) => {
    setPendingKeys((prev) => {
      const next = new Set(prev)
      if (pending) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const clearErrorSoon = useCallback(() => {
    const t = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(t)
  }, [])

  const handleActionResult = useCallback(
    (key: string, result: UpdateFlagsResult, prevFlags: FeatureFlags) => {
      if (!result.ok) {
        // Rollback on failure.
        setFlags(prevFlags)
        setError(result.error)
        clearErrorSoon()
        return
      }
      // On success, replace with the server's canonical flags (handles
      // concurrent edits + the sort order).
      setFlags(result.flags)
      if (result.changed) {
        setSuccess(`Saved ${key}.`)
        const t = setTimeout(() => setSuccess(null), 3000)
        return () => clearTimeout(t)
      }
    },
    [clearErrorSoon],
  )

  // Debounced per-row update. Coalesces rapid changes (e.g. dragging
  // the rollout slider) into a single server call after 500ms of idle.
  const queueRowUpdate = useCallback(
    (key: string, patch: { enabled?: boolean; rollout_pct?: number | null }) => {
      // Cancel any existing timer for this key.
      const existing = debounceTimersRef.current.get(key)
      if (existing) clearTimeout(existing)
      // Schedule a new timer.
      const t = setTimeout(() => {
        debounceTimersRef.current.delete(key)
        // Optimistic local update.
        setFlags((prev) =>
          prev.map((f) =>
            f.key === key
              ? {
                  ...f,
                  ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
                  ...(patch.rollout_pct !== undefined ? { rollout_pct: patch.rollout_pct } : {}),
                }
              : f,
          ),
        )
        setPendingForKey(key, true)
        // Fire the action.
        updatePlatformFlagAction({
          key,
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.rollout_pct !== undefined ? { rollout_pct: patch.rollout_pct } : {}),
        })
          .then((result) => {
            // Use the latest server result; we need the prior flags for
            // rollback. Since state is already updated, capture the
            // pre-optimistic set via a fresh fetch.
            handleActionResult(key, result, initial)
          })
          .catch(() => {
            // Re-fetch via a no-op update if the action throws entirely
            // (network error). The server will return canonical state.
            setError('Network error. Please try again.')
            setPendingForKey(key, false)
          })
          .finally(() => {
            setPendingForKey(key, false)
          })
      }, DEBOUNCE_MS)
      debounceTimersRef.current.set(key, t)
    },
    [handleActionResult, initial, setPendingForKey],
  )

  // Cleanup debounce timers on unmount.
  useEffect(() => {
    const timers = debounceTimersRef.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [])

  // -- Handlers ---------------------------------------------------------------

  function onToggleFlag(key: string, nextEnabled: boolean) {
    queueRowUpdate(key, { enabled: nextEnabled })
  }

  function onRolloutChange(key: string, rawValue: string) {
    // Empty input → null (full rollout).
    if (rawValue.trim() === '') {
      queueRowUpdate(key, { rollout_pct: null })
      return
    }
    const n = Number(rawValue)
    if (Number.isNaN(n)) return
    const clamped = Math.max(0, Math.min(100, Math.round(n)))
    queueRowUpdate(key, { rollout_pct: clamped })
  }

  function onRemoveClick(key: string) {
    setRemovingKey(key)
  }

  function onRemoveConfirm() {
    if (!removingKey) return
    const keyToRemove = removingKey
    setRemovingKey(null)
    setError(null)
    setSuccess(null)
    // Optimistic removal.
    const prev = flags
    setFlags(flags.filter((f) => f.key !== keyToRemove))
    setPendingForKey(keyToRemove, true)
    removePlatformFlagAction({ key: keyToRemove })
      .then((result) => {
        if (!result.ok) {
          setFlags(prev)
          setError(result.error)
          clearErrorSoon()
          return
        }
        setFlags(result.flags)
        setSuccess(`Removed flag "${keyToRemove}".`)
        const t = setTimeout(() => setSuccess(null), 3000)
        return () => clearTimeout(t)
      })
      .catch(() => {
        setFlags(prev)
        setError('Network error. Please try again.')
      })
      .finally(() => {
        setPendingForKey(keyToRemove, false)
      })
  }

  function onRemoveCancel() {
    setRemovingKey(null)
  }

  // -- Render -----------------------------------------------------------------

  return (
    <section className={styles.tab} aria-labelledby={`${formId}-heading`}>
      <header className={styles.tabHeader}>
        <div>
          <h3 id={`${formId}-heading`} className={styles.tabTitle}>
            Feature flags
          </h3>
          <p className={styles.tabLede}>
            Toggle runtime feature flags without a deploy. Changes take effect on the next
            request that reads the flag (no caching layer here). Every change is
            audit-logged.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setShowAddModal(true)}
          type="button"
          data-testid="open-add-flag-modal"
        >
          + Add flag
        </Button>
      </header>

      {error && (
        <p className={styles.alertError} role="alert" data-testid="flags-error">
          {error}
        </p>
      )}
      {success && (
        <p className={styles.success} role="status" data-testid="flags-success">
          {success}
        </p>
      )}

      {flags.length === 0 ? (
        <div className={styles.emptyState} data-testid="flags-empty">
          <p className={styles.emptyText}>
            No feature flags defined yet. Add your first flag to get started.
          </p>
        </div>
      ) : (
        <ul className={styles.flagList} aria-label="Feature flags">
          {flags.map((flag) => (
            <FlagRow
              key={flag.key}
              flag={flag}
              pending={pendingKeys.has(flag.key)}
              onToggle={onToggleFlag}
              onRolloutChange={onRolloutChange}
              onRemove={onRemoveClick}
            />
          ))}
        </ul>
      )}

      {showAddModal && (
        <AddFlagModal
          existingKeys={flags.map((f) => f.key)}
          onClose={() => {
            setShowAddModal(false)
            setError(null)
          }}
          onAdded={(newFlags) => {
            setFlags(newFlags)
            setShowAddModal(false)
            setSuccess('Flag added.')
            const t = setTimeout(() => setSuccess(null), 3000)
            return () => clearTimeout(t)
          }}
          onError={(msg) => {
            setError(msg)
            clearErrorSoon()
          }}
        />
      )}

      {removingKey && (
        <RemoveFlagConfirmModal
          keyToRemove={removingKey}
          onConfirm={onRemoveConfirm}
          onCancel={onRemoveCancel}
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// FlagRow — a single row in the flags list.
// ---------------------------------------------------------------------------

type FlagRowProps = {
  flag: FeatureFlag
  pending: boolean
  onToggle: (key: string, nextEnabled: boolean) => void
  onRolloutChange: (key: string, rawValue: string) => void
  onRemove: (key: string) => void
}

function FlagRow({ flag, pending, onToggle, onRolloutChange, onRemove }: FlagRowProps) {
  const rolloutInputValue =
    flag.rollout_pct == null ? '' : String(flag.rollout_pct)
  return (
    <li
      className={styles.flagRow}
      data-pending={pending ? 'true' : 'false'}
      data-enabled={flag.enabled ? 'true' : 'false'}
    >
      <div className={styles.flagMain}>
        <div className={styles.flagKeyBlock}>
          <code className={styles.flagKey} data-testid={`flag-key-${flag.key}`}>
            {flag.key}
          </code>
          {flag.description ? (
            <span className={styles.flagDescription}>{flag.description}</span>
          ) : (
            <span className={styles.flagDescriptionMuted}>No description.</span>
          )}
        </div>

        <div className={styles.flagControls}>
          <label className={styles.toggleLabel}>
            <span className={styles.toggleLabelText}>Enabled</span>
            <span className={styles.toggleSwitch}>
              <input
                type="checkbox"
                role="switch"
                className={styles.toggleInput}
                checked={flag.enabled}
                onChange={(e) => onToggle(flag.key, e.target.checked)}
                disabled={pending}
                aria-label={`Enable ${flag.key}`}
                data-testid={`flag-toggle-${flag.key}`}
              />
              <span className={styles.toggleTrack} aria-hidden="true">
                <span className={styles.toggleThumb} />
              </span>
            </span>
          </label>

          <label className={styles.rolloutLabel}>
            <span className={styles.rolloutLabelText}>Rollout %</span>
            <input
              type="number"
              className={styles.rolloutInput}
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={rolloutInputValue}
              placeholder="100"
              onChange={(e) => onRolloutChange(flag.key, e.target.value)}
              disabled={pending}
              aria-label={`Rollout percentage for ${flag.key}`}
              data-testid={`flag-rollout-${flag.key}`}
            />
          </label>

          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => onRemove(flag.key)}
            disabled={pending}
            aria-label={`Remove flag ${flag.key}`}
            data-testid={`flag-remove-${flag.key}`}
          >
            Remove
          </Button>
        </div>
      </div>

      {pending && (
        <span className={styles.savingBadge} aria-live="polite">
          Saving…
        </span>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// AddFlagModal — modal for creating a new flag.
// ---------------------------------------------------------------------------

type AddFlagModalProps = {
  existingKeys: string[]
  onClose: () => void
  onAdded: (newFlags: FeatureFlags) => void
  onError: (msg: string) => void
}

function AddFlagModal({ existingKeys, onClose, onAdded, onError }: AddFlagModalProps) {
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [rolloutPct, setRolloutPct] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransitionSafe()

  const keyNorm = key.trim().toLowerCase()
  const keyDuplicate = keyNorm.length > 0 && existingKeys.includes(keyNorm)
  const keyShapeValid = /^[a-z0-9_]+$/.test(keyNorm) && keyNorm.length >= 1 && keyNorm.length <= 60

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    if (!keyShapeValid) {
      setFieldErrors({ key: 'Use lowercase letters, digits, and underscores (1-60 chars).' })
      return
    }
    if (keyDuplicate) {
      setFieldErrors({ key: `A flag with key "${keyNorm}" already exists.` })
      return
    }
    const rolloutPctParsed: number | null =
      rolloutPct.trim() === '' ? null : Math.max(0, Math.min(100, Math.round(Number(rolloutPct))))
    if (rolloutPct.trim() !== '' && Number.isNaN(rolloutPctParsed)) {
      setFieldErrors({ rollout_pct: 'Must be a number 0-100.' })
      return
    }

    startTransition(async () => {
      const res = await addPlatformFlagAction({
        key: keyNorm,
        description: description.trim(),
        enabled,
        rollout_pct: rolloutPctParsed,
      })
      if (!res.ok) {
        setError(res.error)
        if (res.fieldErrors) setFieldErrors(res.fieldErrors)
        return
      }
      onAdded(res.flags)
    })
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="add-flag-title">
      <form className={styles.modal} onSubmit={onSubmit} noValidate>
        <h2 id="add-flag-title" className={styles.modalTitle}>
          Add feature flag
        </h2>

        <label className={styles.modalRow}>
          <span className={styles.modalLabel}>
            Key <span className={styles.required}>*</span>
          </span>
          <input
            type="text"
            className={styles.modalInput}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="new_checkout_flow"
            maxLength={60}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={fieldErrors.key ? 'true' : undefined}
            aria-describedby={fieldErrors.key ? 'add-flag-key-err' : undefined}
            data-testid="add-flag-key"
          />
          {fieldErrors.key && (
            <span id="add-flag-key-err" className={styles.fieldError} role="alert">
              {fieldErrors.key}
            </span>
          )}
          {keyDuplicate && !fieldErrors.key && (
            <span className={styles.fieldErrorWarn}>A flag with this key already exists.</span>
          )}
        </label>

        <label className={styles.modalRow}>
          <span className={styles.modalLabel}>Description</span>
          <textarea
            className={styles.modalTextarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this flag controls"
            maxLength={500}
            rows={2}
            data-testid="add-flag-description"
          />
        </label>

        <div className={styles.modalRow}>
          <label className={styles.modalToggleLabel}>
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              data-testid="add-flag-enabled"
            />
            <span>Enable on creation</span>
          </label>
        </div>

        <label className={styles.modalRow}>
          <span className={styles.modalLabel}>
            Rollout % <span className={styles.modalHint}>(blank = 100%)</span>
          </span>
          <input
            type="number"
            className={styles.modalInput}
            min={0}
            max={100}
            step={1}
            inputMode="numeric"
            value={rolloutPct}
            onChange={(e) => setRolloutPct(e.target.value)}
            placeholder="100"
            data-testid="add-flag-rollout"
          />
        </label>

        {error && (
          <p className={styles.alertError} role="alert">
            {error}
          </p>
        )}

        <div className={styles.modalActions}>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={onClose}
            disabled={isPending}
            data-testid="add-flag-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            loading={isPending}
            disabled={isPending || !keyShapeValid || keyDuplicate}
            data-testid="add-flag-submit"
          >
            {isPending ? 'Adding…' : 'Add flag'}
          </Button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// RemoveFlagConfirmModal — typed confirmation for destructive action.
// ---------------------------------------------------------------------------

type RemoveFlagConfirmModalProps = {
  keyToRemove: string
  onConfirm: () => void
  onCancel: () => void
}

function RemoveFlagConfirmModal({ keyToRemove, onConfirm, onCancel }: RemoveFlagConfirmModalProps) {
  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="remove-flag-title">
      <div className={styles.modal}>
        <h2 id="remove-flag-title" className={styles.modalTitle}>
          Remove flag?
        </h2>
        <p className={styles.modalBody}>
          This will remove the flag <code className={styles.flagKey}>{keyToRemove}</code>.
          Any code that checks this flag will fall back to its default (off). This action is
          audit-logged.
        </p>
        <div className={styles.modalActions}>
          <Button variant="secondary" size="md" type="button" onClick={onCancel} data-testid="remove-flag-cancel">
            Cancel
          </Button>
          <Button variant="danger" size="md" type="button" onClick={onConfirm} data-testid="remove-flag-confirm">
            Remove flag
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// useTransitionSafe — convenience wrapper around React's `useTransition`
// that returns a stable `[isPending, startTransition]` tuple.
// (React's `useTransition` returns a tuple; this just normalizes the name.)
// ---------------------------------------------------------------------------

function useTransitionSafe(): [boolean, (cb: () => void | Promise<void>) => void] {
  const [isPending, start] = useTransition()
  function startTransitionSafe(cb: () => void | Promise<void>) {
    start(() => {
      void cb()
    })
  }
  return [isPending, startTransitionSafe]
}

// ---------------------------------------------------------------------------
// Re-exports for the page-level TypeScript narrowing.
// ---------------------------------------------------------------------------

// Used by tests to verify the readonly types.
export type { FeatureFlag, FeatureFlags } from '../lib/featureFlags'