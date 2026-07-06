'use client'

// 02-features/partner-portal/api-tokens/components/CreateApiTokenDialog.tsx
//
// P12.19 — Modal dialog for minting a new partner API token. Client
// island. The plaintext token is shown EXACTLY ONCE inside the
// "one-time-show" view; after the user clicks "I've saved it, hide",
// the modal closes and the plaintext is gone from React state.
//
// States:
//   1. Closed (initial — renders the trigger button)
//   2. Open + form (name + scopes + expiration + acknowledgement)
//   3. Open + one-time-show (plaintext + copy + hide CTA)
//
// The form's `acknowledgedOneTimeShow` is wired to a checkbox the
// user must tick BEFORE submitting — the server's Zod schema enforces
// `.literal(true)` so a forgotten acknowledgement is rejected at
// parse time (defense in depth — the UI already disables submit).
//
// No data is persisted to localStorage, sessionStorage, cookies, or
// the URL — the plaintext lives in React component state only and
// is dropped the moment the modal unmounts.

import { useId, useRef, useState, useTransition } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import { useToast } from '@foundations/ui/Toast'
import { createApiTokenAction } from '../actions/createApiToken'
import {
  API_TOKEN_EXPIRATION_OPTIONS,
  API_TOKEN_MAX_ACTIVE_TOKENS,
  API_TOKEN_NAME_MAX_LENGTH,
  API_TOKEN_SCOPE_LABELS,
  API_TOKEN_SCOPES,
} from '../constants'
import type { ApiTokenScope } from '../lib/schemas'
import styles from './CreateApiTokenDialog.module.css'

type View = 'closed' | 'form' | 'one-time-show'

type CreatedToken = {
  id: number
  name: string
  plaintext: string
  scopes: ApiTokenScope[]
  expiresAt: string | null
}

export function CreateApiTokenDialog({ activeCount }: { activeCount: number }) {
  const [view, setView] = useState<View>('closed')
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Record<ApiTokenScope, boolean>>({
    read_sales: false,
    read_payouts: false,
    read_products: false,
  })
  const [expirationDays, setExpirationDays] = useState<30 | 90 | 365 | null>(90)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedToken | null>(null)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()
  const dialogRef = useRef<HTMLDivElement>(null)
  const formId = useId()
  const capReached = activeCount >= API_TOKEN_MAX_ACTIVE_TOKENS

  const close = () => {
    setView('closed')
    // Schedule the wipe on the next tick so the user doesn't see the
    // plaintext flash before the modal hides.
    setTimeout(() => {
      setName('')
      setScopes({ read_sales: false, read_payouts: false, read_products: false })
      setExpirationDays(90)
      setAcknowledged(false)
      setError(null)
      setCreated(null)
    }, 0)
  }

  const openForm = () => {
    setError(null)
    setView('form')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (capReached) {
      setError(
        `Maximum ${API_TOKEN_MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`,
      )
      return
    }
    if (!acknowledged) {
      setError('Please acknowledge the one-time-show warning first.')
      return
    }
    const selectedScopes = (Object.entries(scopes) as [ApiTokenScope, boolean][])
      .filter(([, v]) => v)
      .map(([k]) => k)
    if (selectedScopes.length === 0) {
      setError('Pick at least one scope.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await createApiTokenAction({
        name: name.trim(),
        scopes: selectedScopes,
        expirationDays,
        acknowledgedOneTimeShow: true,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setCreated({
        id: res.id,
        name: res.name,
        plaintext: res.plaintext,
        scopes: res.scopes,
        expiresAt: res.expiresAt,
      })
      setView('one-time-show')
      toast.success('Token created. Copy it now — you won’t see it again.')
    })
  }

  const handleCopy = async () => {
    if (!created) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(created.plaintext)
      } else {
        // Fallback for browsers without async clipboard — build a
        // throwaway textarea, select, execCommand('copy').
        const ta = document.createElement('textarea')
        ta.value = created.plaintext
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      toast.success('Token copied to clipboard.')
    } catch {
      toast.error('Could not copy. Select the token manually.')
    }
  }

  if (view === 'closed') {
    return (
      <Button
        variant="primary"
        onClick={openForm}
        disabled={capReached}
        aria-label={
          capReached
            ? `Maximum ${API_TOKEN_MAX_ACTIVE_TOKENS} active tokens reached. Revoke one first.`
            : 'Create API token'
        }
      >
        {capReached ? `Limit reached (${API_TOKEN_MAX_ACTIVE_TOKENS})` : 'Create token'}
      </Button>
    )
  }

  if (view === 'one-time-show' && created) {
    return (
      <div
        className={styles.overlay}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-show-title`}
        onClick={(e) => {
          if (e.target === dialogRef.current) close()
        }}
        ref={dialogRef}
      >
        <div className={styles.dialog} role="document">
          <h2 id={`${formId}-show-title`} className={styles.title}>
            Token created
          </h2>
          <p className={styles.lede}>
            Copy this token now — you won’t see it again.
          </p>
          <div className={styles.tokenBox} aria-label="Plaintext token (shown once)">
            <code className={styles.tokenText}>{created.plaintext}</code>
            <button
              type="button"
              onClick={handleCopy}
              className={styles.copyBtn}
              aria-label="Copy token to clipboard"
            >
              Copy
            </button>
          </div>
          <div className={styles.metaGrid}>
            <div>
              <span className={styles.metaLabel}>Name</span>
              <span className={styles.metaValue}>{created.name}</span>
            </div>
            <div>
              <span className={styles.metaLabel}>Scopes</span>
              <span className={styles.metaValue}>
                {created.scopes.map((s) => API_TOKEN_SCOPE_LABELS[s]).join(', ')}
              </span>
            </div>
            <div>
              <span className={styles.metaLabel}>Expires</span>
              <span className={styles.metaValue}>
                {created.expiresAt
                  ? new Date(created.expiresAt).toLocaleDateString()
                  : 'Never'}
              </span>
            </div>
          </div>
          <div className={styles.actions}>
            <Button variant="primary" onClick={close}>
              I’ve saved it, hide
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // form view
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${formId}-form-title`}
      onClick={(e) => {
        if (e.target === dialogRef.current) close()
      }}
      ref={dialogRef}
    >
      <div className={styles.dialog} role="document">
        <h2 id={`${formId}-form-title`} className={styles.title}>
          Create API token
        </h2>
        <p className={styles.lede}>
          Tokens let external tools read your sales, payouts, and product data.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor={`${formId}-name`} className={styles.label}>
              Name
            </label>
            <input
              id={`${formId}-name`}
              type="text"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={API_TOKEN_NAME_MAX_LENGTH}
              placeholder="e.g. Zapier integration"
              required
              autoFocus
              aria-required="true"
            />
            <span className={styles.hint}>
              {name.length}/{API_TOKEN_NAME_MAX_LENGTH}
            </span>
          </div>

          <fieldset className={styles.field}>
            <legend className={styles.label}>Scopes</legend>
            <div className={styles.scopeList}>
              {API_TOKEN_SCOPES.map((s) => (
                <label key={s} className={styles.scopeOption}>
                  <input
                    type="checkbox"
                    checked={scopes[s]}
                    onChange={(e) =>
                      setScopes((prev) => ({ ...prev, [s]: e.target.checked }))
                    }
                  />
                  <span>{API_TOKEN_SCOPE_LABELS[s]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.field}>
            <legend className={styles.label}>Expiration</legend>
            <div className={styles.expirationList}>
              {API_TOKEN_EXPIRATION_OPTIONS.map((opt) => (
                <label key={opt.label} className={styles.expirationOption}>
                  <input
                    type="radio"
                    name={`${formId}-expiration`}
                    value={opt.label}
                    checked={expirationDays === opt.value}
                    onChange={() => setExpirationDays(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className={styles.ackRow}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              aria-required="true"
            />
            <span>
              I understand this token will be shown once. After I close this
              dialog, Uthena cannot show it again.
            </span>
          </label>

          {error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}

          <div className={styles.actions}>
            <Button variant="ghost" onClick={close} type="button">
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={isPending || !acknowledged || !name.trim()}
            >
              {isPending ? 'Creating…' : 'Create token'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}