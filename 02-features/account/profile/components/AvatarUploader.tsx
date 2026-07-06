// AvatarUploader — the file picker + browser-direct PUT to Bunny
// Storage. Lives inside /account/profile, called by ProfileForm.
//
// Flow:
//   1. User clicks "Choose image" → hidden <input type="file"> opens.
//   2. On `change`, validate mime + size CLIENT-SIDE (UX — short-
//      circuits before the round-trip). Show inline errors for the
//      wrong mime / oversize file without ever firing the action.
//   3. On valid pick, call `requestAvatarUploadAction({ mime, size })`
//      server-side to mint the signed PUT URL.
//   4. PUT the file to `uploadUrl` from the action. Show progress +
//      errors inline (role="alert").
//   5. On success, call `onUploaded(publicUrl)` — the parent form
//      updates its `avatar_url` state. The user's next Save on the
//      form commits the URL via the existing `updateProfileAction`.
//
// The component renders a token-only skeleton that matches the
// spec's "Avatar set / No avatar yet" copy and the v1.1 "upload is a
// v1.1 follow-up" hint is GONE — the live affordance is here.
//
// Cropping is intentionally out of scope for this slice (see
// STUB-077 — the slice-2 work). The cropper is a cosmetic refinement
// that needs a library decision (per the spec's open question) and
// the file ships end-to-end without it.

'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from '@foundations/files/upload-constants'
import { requestAvatarUploadAction } from '../actions/requestAvatarUpload'
import styles from './AvatarUploader.module.css'

/** Friendly type labels for the allowlisted mimes (shown in the
 *  picker hint copy). */
const ACCEPT_MIMES_HINT = AVATAR_MIME_TYPES.map((m) => {
  switch (m) {
    case 'image/jpeg':
      return 'JPEG'
    case 'image/png':
      return 'PNG'
    case 'image/webp':
      return 'WebP'
  }
}).join(', ')

/** The "accept" attribute on the file input — mime-only. The mime
 *  check in JS is the authoritative gate; this is just for the
 *  native file picker filter. */
const FILE_INPUT_ACCEPT = AVATAR_MIME_TYPES.join(',')

type Status =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'minting' }
  | { kind: 'uploading' }
  | { kind: 'success'; uploadedUrl: string }
  | { kind: 'error'; message: string }

export interface AvatarUploaderProps {
  /** The currently-displayed avatar URL (controlled by the parent
   *  form state). The component renders a thumb of this when set;
   *  clicking the thumb opens the file picker. */
  avatarUrl: string | null
  /** Called with the NEW public URL after a successful upload. The
   *  parent updates its `avatar_url` form state; the avatar isn't
   *  persisted to `profiles` until the user clicks Save on the form. */
  onUploaded: (publicUrl: string) => void
  /** Initial letters shown when `avatarUrl` is null. Matches the
   *  parent form's convention (first letter of display_name or email). */
  initials: string
}

/**
 * Reject an over-5 MiB file before any round-trip — defense in
 * depth at the client so the user isn't waiting on a network call
 * to see the error.
 */
function clientFileError(file: File): string | null {
  if (!AVATAR_MIME_TYPES.includes(file.type as (typeof AVATAR_MIME_TYPES)[number])) {
    return `Unsupported file type. Allowed: ${ACCEPT_MIMES_HINT}.`
  }
  if (file.size <= 0) {
    return 'That file appears to be empty.'
  }
  if (file.size > AVATAR_MAX_BYTES) {
    const mb = Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))
    const fileMb = (file.size / (1024 * 1024)).toFixed(1)
    return `That image is ${fileMb} MB. Please pick an image under ${mb} MB.`
  }
  return null
}

export function AvatarUploader({ avatarUrl, onUploaded, initials }: AvatarUploaderProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  // When a successful upload lands, fire the parent callback so the
  // form's `avatar_url` state updates. The status is tracked in
  // local state so we can show the success state without affecting
  // the parent rerender.
  useEffect(() => {
    if (status.kind !== 'success') return
    onUploaded(status.uploadedUrl)
    // We intentionally don't depend on onUploaded so a parent
    // re-render doesn't retrigger the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind === 'success' ? status.uploadedUrl : null])

  const onPickClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const onFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Always clear the input value so the same file can be re-selected
    // after the user cancels (the browser doesn't fire `change` for
    // a no-op re-pick otherwise).
    e.target.value = ''
    if (!file) return

    setStatus({ kind: 'validating' })

    const clientError = clientFileError(file)
    if (clientError) {
      setStatus({ kind: 'error', message: clientError })
      return
    }

    setStatus({ kind: 'minting' })
    const minted = await requestAvatarUploadAction({
      mime: file.type,
      size: file.size,
    })
    if (!minted.ok) {
      setStatus({ kind: 'error', message: minted.error })
      return
    }

    // PUT to Bunny. We use `fetch` with the browser's native upload
    // body — the URL contains the AccessKey as a query param, so no
    // CORS preflight is needed (AccessKey is a query param, not a
    // custom header). On failure we surface the status code + a
    // friendly message.
    setStatus({ kind: 'uploading' })
    try {
      const res = await fetch(minted.uploadUrl, {
        method: 'PUT',
        body: file,
        // The browser's default Content-Type for File is the file's
        // own mime — we set it explicitly for clarity. Bunny accepts
        // both.
        headers: { 'Content-Type': file.type },
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setStatus({
            kind: 'error',
            message: 'The upload was rejected by the storage server. Please try again.',
          })
        } else if (res.status === 413) {
          setStatus({
            kind: 'error',
            message: `That image is too large. Please pick an image under ${
              Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))
            } MB.`,
          })
        } else {
          setStatus({
            kind: 'error',
            message: `Upload failed (HTTP ${res.status}). Please try again.`,
          })
        }
        return
      }
      setStatus({ kind: 'success', uploadedUrl: minted.publicUrl })
    } catch {
      setStatus({
        kind: 'error',
        message: 'Upload interrupted. Check your connection and try again.',
      })
    }
  }, [])

  const inFlight =
    status.kind === 'validating' ||
    status.kind === 'minting' ||
    status.kind === 'uploading'

  const errorMessage = status.kind === 'error' ? status.message : null

  return (
    <div className={styles.row} aria-busy={inFlight}>
      <button
        type="button"
        className={styles.thumbWrap}
        onClick={onPickClick}
        aria-label={avatarUrl ? 'Change avatar' : 'Upload avatar'}
        disabled={inFlight}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className={styles.thumbImg} />
        ) : (
          <span className={styles.thumbInitials}>{initials.slice(0, 1).toUpperCase()}</span>
        )}
        {inFlight && (
          <span className={styles.thumbOverlay} aria-hidden>
            {status.kind === 'minting' && 'Preparing…'}
            {status.kind === 'uploading' && 'Uploading…'}
            {status.kind === 'validating' && 'Validating…'}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        onChange={onFileSelected}
        className={styles.fileInput}
        aria-hidden
        tabIndex={-1}
      />
      <div className={styles.actions}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onPickClick}
          disabled={inFlight}
          loading={inFlight}
        >
          {avatarUrl ? 'Replace image' : 'Choose image'}
        </Button>
        <p className={styles.help}>
          {ACCEPT_MIMES_HINT} up to {Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))} MB.
          {!avatarUrl && ' Square aspect ratio (1:1) renders best.'}
        </p>
        {errorMessage && (
          <p className={styles.error} role="alert">
            {errorMessage}
          </p>
        )}
        {status.kind === 'success' && (
          <p className={styles.success} role="status">
            Uploaded. Click <strong>Save changes</strong> below to apply.
          </p>
        )}
      </div>
    </div>
  )
}
