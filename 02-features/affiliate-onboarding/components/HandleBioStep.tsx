'use client'

// HandleBioStep — Step 2 body for the affiliate onboarding wizard.
//
// P13.1 Slice 1 — the critical client island that captures the
// user's chosen handle + bio. The handle is the canonical public
// minishop URL segment (`uthena.com/[handle]`), so the save
// triggers a race-safe reservation in `handle_reservations` (the
// DB PRIMARY KEY is the arbiter; SQLSTATE 23505 maps to a friendly
// "this handle is already taken" message via `handleConflict: true`).
//
// Form fields (per spec §"Data this page shows" + §Acceptance criteria):
//   - handle (required, 3-30 lowercase chars / digits / hyphens; Zod +
//     reserved-list check)
//   - bio (optional, max 280 chars)
//
// What's deferred (filed in STUBS.md per AGENTS.md rule 4):
//   - Avatar upload (Bunny signed PUT + ClamAV scan + a real
//     `avatar_storage_path` round-trip). Slice 2+. The field below
//     reads + writes the path so future slices can plug in cleanly.
//   - Real-time debounced availability check (300ms debounced +
//     5/sec rate-limited preview call). Slice 2+. The form below
//     validates shape on submit and shows server-side conflict
//     errors after the save lands — same UX, just without the
//     preview shimmer.
//
// Why a client component (not an RSC):
//   - The form needs `useTransition` for optimistic loading + the
//     toast provider for success / error feedback + `router.refresh()`
//     after the save so the shell re-renders with the new draft.

import { useId, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@foundations/ui/primitives/Button'
import { useToast } from '@foundations/ui/Toast'
import { saveStepAction } from '../actions/saveStep'
import type {
  AffiliateOnboardingDraftResult,
  AffiliateOnboardingStep,
} from '../queries/getMyOnboardingDraft'
import { HANDLE_MAX_LENGTH, HANDLE_MIN_LENGTH } from '@foundations/auth/reserved-handles'
import styles from './HandleBioStep.module.css'

export type HandleBioStepProps = {
  draft: AffiliateOnboardingDraftResult
}

const STEP: AffiliateOnboardingStep = 'handle_bio'
const NEXT_STEP: AffiliateOnboardingStep = 'payout'

/** Defensive coercion of the draft's `handle_bio` jsonb column into
 *  the form's expected shape. The DB returns unknown; we narrow it
 *  to strings with explicit fallbacks. */
function readDraftFormState(draft: AffiliateOnboardingDraftResult): {
  handle: string
  bio: string
} {
  if (!draft.exists) return { handle: '', bio: '' }
  const raw = draft.handleBio
  const handle = typeof raw['handle'] === 'string' ? raw['handle'] : ''
  const bio = typeof raw['bio'] === 'string' ? raw['bio'] : ''
  return { handle, bio }
}

/** Cheap shape validation client-side — the canonical Zod schema
 *  runs server-side in `saveStepAction`. We mirror the regex +
 *  length here so the user sees errors immediately. The reserved-
 *  list check + the Zod `strict()` enforcement happen server-side. */
function validateClientShape(handle: string): string | null {
  if (handle.length === 0) return 'Pick a handle to continue.'
  if (handle.length < HANDLE_MIN_LENGTH) {
    return `Handle must be at least ${HANDLE_MIN_LENGTH} characters.`
  }
  if (handle.length > HANDLE_MAX_LENGTH) {
    return `Handle must be ${HANDLE_MAX_LENGTH} characters or fewer.`
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(handle)) {
    return 'Use lowercase letters, digits, or hyphens. Cannot start or end with a hyphen.'
  }
  return null
}

export function HandleBioStep({ draft }: HandleBioStepProps) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const initial = useMemo(() => readDraftFormState(draft), [draft])
  const [handle, setHandle] = useState(initial.handle)
  const [bio, setBio] = useState(initial.bio)
  const [serverError, setServerError] = useState<string | null>(null)

  const formId = useId()
  const handleInputId = `${formId}-handle`
  const bioInputId = `${formId}-bio`
  const handleHintId = `${formId}-handle-hint`
  const bioHintId = `${formId}-bio-hint`

  const clientError =
    handle.length > 0 ? validateClientShape(handle) : null

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setServerError(null)
    const shapeError = validateClientShape(handle)
    if (shapeError) {
      setServerError(shapeError)
      return
    }
    startTransition(async () => {
      const result = await saveStepAction({
        step: STEP,
        payload: { handle, bio: bio.length > 0 ? bio : undefined },
      })
      if (result.ok) {
        toast.success('Handle reserved. Welcome to your mini-shop URL!')
        router.push(`/affiliate/onboarding?step=${NEXT_STEP}`)
        router.refresh()
      } else if (result.code === 'handle_conflict') {
        setServerError(result.error)
      } else if (result.code === 'handle_reserved') {
        setServerError(result.error)
      } else if (result.code === 'rate_limited') {
        toast.error(
          result.retryAfterSeconds
            ? `Saving too quickly. Try again in ${result.retryAfterSeconds}s.`
            : 'Saving too quickly. Please wait a moment.',
        )
      } else if (result.code === 'unauthenticated') {
        toast.error('Please sign in again to continue.')
      } else {
        setServerError(result.error)
      }
    })
  }

  return (
    <form id={formId} className={styles.wrap} onSubmit={handleSubmit} noValidate>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Step 2 of 6</p>
        <h2 className={styles.h2}>Pick your handle</h2>
        <p className={styles.lede}>
          Your handle becomes the URL of your public mini-shop —{' '}
          <code className={styles.code}>uthena.com/{handle || 'your-name'}</code>. Lowercase letters,
          digits, and hyphens only.
        </p>
      </header>

      <div className={styles.field}>
        <label htmlFor={handleInputId} className={styles.label}>
          Handle <span className={styles.required} aria-hidden="true">*</span>
        </label>
        <input
          id={handleInputId}
          name="handle"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          aria-required="true"
          aria-describedby={handleHintId}
          aria-invalid={Boolean(serverError) || Boolean(clientError)}
          maxLength={HANDLE_MAX_LENGTH}
          minLength={HANDLE_MIN_LENGTH}
          placeholder="your-name"
          value={handle}
          onChange={(e) => {
            setServerError(null)
            setHandle(e.target.value.trim().toLowerCase())
          }}
          className={styles.input}
          data-invalid={Boolean(serverError) || Boolean(clientError) || undefined}
        />
        <p id={handleHintId} className={styles.hint}>
          3-30 chars. We reserve it the moment you save so no one else can take it.
        </p>
      </div>

      <div className={styles.field}>
        <label htmlFor={bioInputId} className={styles.label}>
          Short bio
          <span className={styles.optional}> — optional</span>
        </label>
        <textarea
          id={bioInputId}
          name="bio"
          rows={3}
          maxLength={280}
          aria-describedby={bioHintId}
          placeholder="1-2 sentences about who you are and what you promote."
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className={styles.textarea}
        />
        <p id={bioHintId} className={styles.hint}>
          {bio.length}/280
        </p>
      </div>

      {(clientError || serverError) && (
        <p className={styles.error} role="alert">
          {serverError ?? clientError}
        </p>
      )}

      <footer className={styles.footer}>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={isPending || Boolean(clientError)}
          aria-busy={isPending}
        >
          {isPending ? 'Reserving…' : 'Reserve handle & continue'}
        </Button>
      </footer>
    </form>
  )
}