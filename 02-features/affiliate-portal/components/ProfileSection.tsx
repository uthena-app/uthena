'use client'

// ProfileSection — /affiliate/settings Profile section.
//
// Client island for the spec's "Profile" section
// (`affiliate-settings.md` §Data + §Acceptance §2-3).
//
// **What this ships:**
//   - Two editable fields: display_name (2-60 chars, char counter)
//     and bio (≤ 280 chars, char counter)
//   - Debounced inline save (300ms after last keystroke) via
//     `updateAffiliateProfileAction`
//   - "Saved" / "Saving…" / error toast states
//   - Live mini-shop preview on the right (or below on mobile)
//     — see MiniShopPreview for the mirror surface
//   - Server-side validation errors are surfaced inline; client-
//     side optimistic revert on failure (per spec line 69)
//
// **What this does NOT ship (deferred to P13.11 Slices 2+):**
//   - Locale & timezone selects (spec §Data — future slice)
//   - Avatar upload (spec line 62: lives on /account/profile)
//   - Connected accounts (Google OAuth) — future slice
//   - Sessions list — future slice (P1.8 Slice 1 surfaces it on
//     /account/settings; spec line 22 mirrors it here)

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Input } from '@foundations/ui/primitives/Button'
import { MiniShopPreview } from './MiniShopPreview'
import {
  updateAffiliateProfileAction,
  type UpdateAffiliateProfileResult,
} from '../actions/settings/updateAffiliateProfileAction'
import styles from './ProfileSection.module.css'

const SAVE_DEBOUNCE_MS = 300
const MAX_DISPLAY_NAME = 60
const MAX_BIO = 280

type ProfileSectionProps = {
  initial: {
    displayName: string
    bio: string | null
  }
  /** The affiliate's public handle (used in the MiniShopPreview URL). */
  handle: string
}

export function ProfileSection({ initial, handle }: ProfileSectionProps) {
  // Local state — separate from the server props so we can
  // debounce + revert optimistically.
  const [displayName, setDisplayName] = useState(initial.displayName)
  const [bio, setBio] = useState(initial.bio ?? '')
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const lastSavedRef = useRef<{ display_name: string; bio: string | null } | null>(null)

  const showToast = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg })
    window.setTimeout(() => setToast(null), 2400)
  }, [])

  // Debounced save — fires SAVE_DEBOUNCE_MS after the last edit.
  // The debounce is restarted on every keystroke, so a fast typist
  // never sees a partial save.
  const debounceRef = useRef<number | null>(null)
  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
    }
    const next = {
      display_name: displayName.trim(),
      bio: bio.length > 0 ? bio : null,
    }
    // Skip the first effect run (mount) — that's just hydration.
    // We only want to save when the user actually edits something.
    const last = lastSavedRef.current
    if (
      last !== null &&
      last.display_name === next.display_name &&
      last.bio === next.bio
    ) {
      return
    }
    debounceRef.current = window.setTimeout(() => {
      startTransition(async () => {
        const result: UpdateAffiliateProfileResult =
          await updateAffiliateProfileAction(next)
        if (!result.ok) {
          // Revert + surface errors
          if (last !== null) {
            setDisplayName(last.display_name)
            setBio(last.bio ?? '')
          }
          if (result.fieldErrors) {
            setFieldErrors(result.fieldErrors)
          }
          showToast('err', result.error)
          return
        }
        setFieldErrors({})
        lastSavedRef.current = next
        showToast('ok', 'Saved.')
      })
    }, SAVE_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
      }
    }
  }, [displayName, bio, showToast])

  // Local validation: display_name 2-60 chars. Surfaces inline
  // before the server round-trip. The action also validates —
  // this is defense-in-depth UX.
  const displayNameError = (() => {
    const trimmed = displayName.trim()
    if (trimmed.length < 2) return 'At least 2 characters'
    if (trimmed.length > MAX_DISPLAY_NAME) return `Max ${MAX_DISPLAY_NAME} characters`
    return undefined
  })()
  const bioError = bio.length > MAX_BIO ? `Max ${MAX_BIO} characters` : undefined

  return (
    <section className={styles.section} aria-labelledby="affiliate-profile-heading">
      <header className={styles.header}>
        <h2 id="affiliate-profile-heading" className={styles.heading}>
          Profile
        </h2>
        <p className={styles.subheading}>
          This is what visitors see on your public mini-shop.
        </p>
      </header>

      <div className={styles.grid}>
        <div className={styles.form}>
          <Input
            label="Display name"
            hint={`Public — shown on your mini-shop and product links.`}
            error={displayNameError ?? fieldErrors.display_name}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={MAX_DISPLAY_NAME + 1 /* allow over-typing for the error UI */}
            autoComplete="off"
            aria-describedby="display-name-counter"
          />
          <p id="display-name-counter" className={styles.counter}>
            {displayName.trim().length} / {MAX_DISPLAY_NAME}
          </p>

          <div className={styles.bioField}>
            <label htmlFor="affiliate-bio" className={styles.bioLabel}>
              Bio
            </label>
            <textarea
              id="affiliate-bio"
              className={styles.bioTextarea}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              maxLength={MAX_BIO + 1}
              placeholder="One sentence about what you teach or build."
              aria-describedby="bio-counter"
              aria-invalid={bioError ? 'true' : undefined}
            />
            <p id="bio-counter" className={styles.counter}>
              {bio.length} / {MAX_BIO}
            </p>
            {bioError && (
              <p className={styles.error} role="alert">
                {bioError}
              </p>
            )}
          </div>

          {isPending && (
            <p className={styles.savingState} aria-live="polite">
              Saving…
            </p>
          )}
        </div>

        <aside className={styles.previewColumn} aria-label="Live mini-shop preview">
          <p className={styles.previewLabel}>Live preview</p>
          <MiniShopPreview displayName={displayName} bio={bio} handle={handle} />
          <a
            href={`/${handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.previewLink}
          >
            Open your mini-shop ↗
          </a>
        </aside>
      </div>

      {toast && (
        <p
          className={toast.kind === 'ok' ? styles.toastOk : styles.toastErr}
          role={toast.kind === 'ok' ? 'status' : 'alert'}
          aria-live="polite"
        >
          {toast.msg}
        </p>
      )}
    </section>
  )
}