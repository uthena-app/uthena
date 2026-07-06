'use client'

// DetailsStep — Step 1 of the partner-upload wizard (P12.7 Slice 1).
//
// Renders the editable product metadata fields the spec calls out in
// line 17:
//   - title (required, ≤ 200 chars)
//   - long_description (required, ≥ 50 chars in plain-text length)
//   - category_id (required; dropdown of the partner-visible categories)
//   - kind (required; one of the six product_kind enum values)
//
// Auto-saves on every field change with a 1s debounce (spec line 79:
// "Drafts auto-save (debounced 1s) on every field change"). The save
// is fire-and-forget from the partner's POV — the only UI feedback
// is a small "Saved at HH:MM:SS" indicator + an inline error if the
// server returns `save_failed` / `rate_limited`. We deliberately do
// NOT block the user from continuing to type while the save is in
// flight; the spec accepts eventual consistency (a slow tab that
// disconnects mid-typing loses the unsaved keystrokes but the rest of
// the form is intact — that's acceptable per the spec's "Closing the
// tab and coming back: the draft is restored" criterion, which works
// because saves hit the DB within 1s of typing).
//
// Per-step payload contract (lib/saveUploadDraftSchema.ts DetailsPayload):
//   { details: { title, long_description, category_id, kind } }
// The action shallow-merges the `details` key into the row's `payload`
// jsonb, so saving Step 2 later doesn't clobber Step 1.

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { saveUploadDraftAction } from '../actions/saveUploadDraft'
import type { CategoryOption } from '@features/partner-portal/queries/listPartnerCategories'
import type { UploadDraftResult } from '../queries/getMyUploadDraft'
import styles from './DetailsStep.module.css'

const KIND_OPTIONS = [
  { value: 'video_course', label: 'Video course' },
  { value: 'ebook', label: 'eBook' },
  { value: 'template_pack', label: 'Template pack' },
  { value: 'audio_course', label: 'Audio course' },
  { value: 'bundle', label: 'Bundle' },
  { value: 'asset_pack', label: 'Asset pack' },
] as const

type Kind = (typeof KIND_OPTIONS)[number]['value']

const TITLE_MAX = 200
const DESC_MAX = 10_000
const DESC_MIN = 50
const DEBOUNCE_MS = 1000

export type DetailsStepProps = {
  /** The user's draft (or `{ exists: false }`). Hydrates the form
   *  fields when the partner comes back to a saved draft. */
  draft: UploadDraftResult
  /** Categories for the dropdown. Empty array is safe — the form
   *  renders a friendly empty state. */
  categories: readonly CategoryOption[]
}

type DetailsValue = {
  title: string
  longDescription: string
  categoryId: string
  kind: Kind
}

/** Pull the four fields out of the row's `payload.details`. Falls back
 *  to empty defaults when the row doesn't exist or the slot is absent.
 *  Defensive against partial / malformed JSON. */
function readDetailsFromDraft(draft: UploadDraftResult): DetailsValue {
  const defaults: DetailsValue = {
    title: '',
    longDescription: '',
    categoryId: '',
    kind: 'video_course',
  }
  if (!draft.exists) return defaults
  const raw = draft.payload?.details
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults
  const obj = raw as Record<string, unknown>
  return {
    title: typeof obj.title === 'string' ? obj.title : defaults.title,
    longDescription: typeof obj.long_description === 'string' ? obj.long_description : defaults.longDescription,
    categoryId:
      typeof obj.category_id === 'number' && Number.isInteger(obj.category_id)
        ? String(obj.category_id)
        : defaults.categoryId,
    kind:
      typeof obj.kind === 'string' && KIND_OPTIONS.some((k) => k.value === obj.kind)
        ? (obj.kind as Kind)
        : defaults.kind,
  }
}

export function DetailsStep({ draft, categories }: DetailsStepProps) {
  const initial = readDetailsFromDraft(draft)

  const [title, setTitle] = useState(initial.title)
  const [longDescription, setLongDescription] = useState(initial.longDescription)
  const [categoryId, setCategoryId] = useState(initial.categoryId)
  const [kind, setKind] = useState<Kind>(initial.kind)

  // Save state — `lastSavedAt` is the ISO timestamp the server returned
  // on the most recent successful save (the indicator reads this).
  // `error` is a friendly message for any non-rate-limited failure;
  // rate-limited has its own slot so we can echo the retry-after.
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(
    draft.exists ? draft.updatedAt : null,
  )
  const [error, setError] = useState<string | null>(null)
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  // The debounced save — collects the latest values in a ref so a
  // pending save that's about to fire picks up the freshest state.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<{ title: string; longDescription: string; categoryId: string; kind: Kind }>({
    title,
    longDescription,
    categoryId,
    kind,
  })

  // Keep the ref in sync on every render — useRef + state doesn't
  // trigger re-renders so we update it inline.
  latestRef.current = { title, longDescription, categoryId, kind }

  const flushSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const v = latestRef.current

    // Skip the save when the user is mid-typing — empty title or
    // unparseable category — the strict Zod schema would reject and
    // we'd flood the audit log with noise. The partner can navigate
    // away without saving and come back; the URL is the source of
    // truth until the form is well-formed.
    const catId = Number.parseInt(v.categoryId, 10)
    if (!v.title.trim() || !Number.isInteger(catId) || catId <= 0) {
      return
    }

    startTransition(async () => {
      setError(null)
      setRetryAfterSeconds(null)
      const result = await saveUploadDraftAction({
        step: 1,
        payload: {
          details: {
            title: v.title.trim(),
            long_description: v.longDescription,
            category_id: catId,
            kind: v.kind,
          },
        },
      })
      if (result.ok) {
        setLastSavedAt(result.savedAt)
      } else if (result.code === 'rate_limited') {
        setError('Saving too quickly.')
        setRetryAfterSeconds(result.retryAfterSeconds ?? 60)
      } else if (result.code === 'unauthenticated') {
        setError('Please sign in again to keep saving.')
      } else {
        setError(result.error)
      }
    })
  }, [])

  // Schedule a debounced save whenever any field changes. The 1s
  // window matches the spec line 79; we collapse bursts of typing
  // (one keystroke = 100-200 ms cadence) into a single save.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(flushSave, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [title, longDescription, categoryId, kind, flushSave])

  // Flush on unmount — if the partner types and immediately navigates
  // away, we want the last keystrokes persisted. The component is the
  // step body, so unmount only happens on route change; the cleanup
  // above also flushes if the parent re-renders with new keys.
  useEffect(() => {
    return () => {
      flushSave()
    }
  }, [flushSave])

  // Inline field validation — purely cosmetic, server-side Zod is the
  // source of truth. We surface min-length on the description so the
  // partner sees the same rule the spec mandates ("min 50 chars").
  const descUnderMin = longDescription.trim().length > 0 && longDescription.trim().length < DESC_MIN
  const descOverMax = longDescription.length > DESC_MAX

  return (
    <form className={styles.form} onSubmit={(e) => e.preventDefault()} noValidate>
      <header className={styles.formHead}>
        <h2 className={styles.formTitle}>Details</h2>
        <p className={styles.formLede}>
          Tell buyers what your course is. You can edit everything later — drafts auto-save.
        </p>
      </header>

      <div className={styles.field}>
        <label htmlFor="upload-title" className={styles.label}>
          Title <span className={styles.optional}>(required, max {TITLE_MAX} chars)</span>
        </label>
        <input
          id="upload-title"
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
          maxLength={TITLE_MAX}
          placeholder="e.g. Mastering Laravel 12 — from zero to production"
          autoComplete="off"
          spellCheck="true"
          required
        />
        <p className={styles.counter}>
          {title.length} / {TITLE_MAX}
        </p>
      </div>

      <div className={styles.field}>
        <label htmlFor="upload-desc" className={styles.label}>
          Description <span className={styles.optional}>(required, plain text, ≥ {DESC_MIN} chars)</span>
        </label>
        <textarea
          id="upload-desc"
          className={styles.textareaLg}
          value={longDescription}
          onChange={(e) => setLongDescription(e.target.value.slice(0, DESC_MAX))}
          maxLength={DESC_MAX}
          rows={10}
          placeholder="What does this course cover? Who is it for? What will buyers walk away with?"
          spellCheck="true"
          required
          aria-invalid={descUnderMin || descOverMax || undefined}
          aria-describedby={descUnderMin ? 'upload-desc-help' : undefined}
        />
        <p className={styles.counter}>
          {longDescription.length} / {DESC_MAX}
          {descUnderMin && (
            <span id="upload-desc-help" className={styles.underMin}>
              {' '}— need {DESC_MIN - longDescription.trim().length} more characters
            </span>
          )}
        </p>
      </div>

      <div className={styles.row2}>
        <div className={styles.field}>
          <label htmlFor="upload-category" className={styles.label}>
            Category <span className={styles.optional}>(required)</span>
          </label>
          <select
            id="upload-category"
            className={styles.select}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            <option value="" disabled>
              {categories.length === 0 ? 'No categories available' : 'Select a category'}
            </option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="upload-kind" className={styles.label}>
            Kind <span className={styles.optional}>(required)</span>
          </label>
          <select
            id="upload-kind"
            className={styles.select}
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            required
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <footer className={styles.foot}>
        <div className={styles.saveStatus} aria-live="polite">
          {isPending && <span className={styles.saving}>Saving…</span>}
          {!isPending && lastSavedAt && (
            <span className={styles.saved}>
              <span className={styles.dot} aria-hidden="true" />
              Saved{' '}
              <time dateTime={lastSavedAt}>
                {new Date(lastSavedAt).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </time>
            </span>
          )}
          {!isPending && !lastSavedAt && <span className={styles.unsaved}>Not saved yet</span>}
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
            {retryAfterSeconds !== null && (
              <> — retry in {retryAfterSeconds}s</>
            )}
          </p>
        )}
      </footer>
    </form>
  )
}
