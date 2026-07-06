// RefundProofUploader — drag-and-drop / click-to-pick file input
// that uploads a refund-proof file to Bunny Storage via the same
// browser-direct PUT pattern as the avatar uploader (P9.2). Lives
// inside `/account/orders/[id]/refund`, called by RefundForm.
//
// Flow:
//   1. User clicks the drop zone OR drag-and-drops a file.
//   2. On pick, validate mime + size CLIENT-SIDE (UX — short-
//      circuits before the round-trip). Show inline errors for the
//      wrong mime / oversize file without ever firing the action.
//   3. On valid pick, call `requestRefundProofUploadAction({ mime,
//      size, filename })` server-side to mint the signed PUT URL
//      + receive the server-sanitized filename.
//   4. PUT the file to `uploadUrl` from the action. Show progress
//      + errors inline (role="alert").
//   5. On success, call `onUploaded({ storagePath, sanitizedFilename })`.
//      The parent form stores these in state and includes them as
//      `proof_path` + `proof_filename` when the user submits.
//
// The component renders a token-only drop zone that matches the
// spec's mockup intent (a single bordered surface with the file
// type + size hint). The drop zone is keyboard-accessible (Enter /
// Space activates the file picker) and the `aria-describedby`
// surfaces the hint to screen readers.
//
// ClamAV scanning of the uploaded proof is intentionally NOT done
// at upload time (the spec accepts this — see
// `01-specs/pages/account-refund.md` §Security line 102). The
// existing ClamAV pipeline (`00-foundations/files/scan.ts`) is a
// partner-upload-zone concern (where the bytes are reused by
// hundreds of buyers); refund proofs are admin-only and the blast
// radius of a malicious proof is "the admin who opens it", which
// is the same blast radius as the admin opening any email
// attachment. v1 is fail-open here; a future cron can scan the
// `refund-proofs/` prefix without code changes at this surface.

'use client'

import { useCallback, useId, useRef, useState } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import {
  REFUND_PROOF_MAX_BYTES,
  REFUND_PROOF_MIME_TYPES,
} from '@foundations/files/refund-proof-upload-constants'
import { requestRefundProofUploadAction } from '../actions/requestRefundProofUpload'
import styles from './RefundProofUploader.module.css'

/** Friendly type labels for the allowlisted mimes (shown in the
 *  picker hint copy). */
const ACCEPT_MIMES_HINT = REFUND_PROOF_MIME_TYPES.map((m) => {
  switch (m) {
    case 'image/jpeg':
      return 'JPEG'
    case 'image/png':
      return 'PNG'
    case 'application/pdf':
      return 'PDF'
  }
}).join(', ')

/** The "accept" attribute on the file input — mime-only. The mime
 *  check in JS is the authoritative gate; this is just for the
 *  native file picker filter. */
const FILE_INPUT_ACCEPT = REFUND_PROOF_MIME_TYPES.join(',')

const MAX_BYTES = REFUND_PROOF_MAX_BYTES
const MAX_MB = Math.floor(MAX_BYTES / (1024 * 1024))

export interface RefundProofUploadResult {
  /** Bunny Storage path — `refund-proofs/{userId}/{uuid}.{ext}`. The
   *  refund form passes this to `createRefundRequestAction` as
   *  `proof_path`. */
  storagePath: string
  /** Server-sanitized filename (a-zA-Z0-9._-, capped). The refund
   *  form passes this to `createRefundRequestAction` as
   *  `proof_filename`. */
  sanitizedFilename: string
}

type Status =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'minting' }
  | { kind: 'uploading' }
  | { kind: 'success'; storagePath: string; sanitizedFilename: string }
  | { kind: 'error'; message: string }

/** Reject an oversize / wrong-mime file before any round-trip —
 *  defense in depth at the client so the user isn't waiting on a
 *  network call to see the error. */
function clientFileError(file: File): string | null {
  if (!REFUND_PROOF_MIME_TYPES.includes(file.type as (typeof REFUND_PROOF_MIME_TYPES)[number])) {
    return `Unsupported file type. Allowed: ${ACCEPT_MIMES_HINT}.`
  }
  if (file.size <= 0) {
    return 'That file appears to be empty.'
  }
  if (file.size > MAX_BYTES) {
    const fileMb = (file.size / (1024 * 1024)).toFixed(1)
    return `That file is ${fileMb} MB. Please pick a file under ${MAX_MB} MB.`
  }
  return null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface RefundProofUploaderProps {
  /** Called with the uploaded proof metadata after a successful
   *  upload. The parent form stores these in state and includes
   *  them in the submit payload. */
  onUploaded: (result: RefundProofUploadResult) => void
  /** Called when the user wants to remove the uploaded proof
   *  (e.g. to pick a different file). The parent clears its
   *  `proof_path` + `proof_filename` state. */
  onCleared: () => void
  /** The currently-uploaded proof (controlled by the parent form
   *  state). When set, the component renders the "Uploaded"
   *  state with a "Replace" / "Remove" pair; when null, it
   *  renders the drop zone. */
  uploaded: RefundProofUploadResult | null
}

/**
 * The drop zone is keyboard-accessible. Enter / Space on the
 * focused zone opens the native file picker (via the hidden
 * `<input type="file">`). Drag-and-drop is layered on top via the
 * `onDragOver` / `onDrop` handlers.
 */
export function RefundProofUploader({ onUploaded, onCleared, uploaded }: RefundProofUploaderProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dropZoneRef = useRef<HTMLButtonElement | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [dragActive, setDragActive] = useState(false)

  const uploadFile = useCallback(
    async (file: File) => {
      setStatus({ kind: 'validating' })
      const clientError = clientFileError(file)
      if (clientError) {
        setStatus({ kind: 'error', message: clientError })
        return
      }

      setStatus({ kind: 'minting' })
      const minted = await requestRefundProofUploadAction({
        mime: file.type,
        size: file.size,
        filename: file.name,
      })
      if (!minted.ok) {
        setStatus({ kind: 'error', message: minted.error })
        return
      }

      setStatus({ kind: 'uploading' })
      try {
        const res = await fetch(minted.uploadUrl, {
          method: 'PUT',
          body: file,
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
              message: `That file is too large. Please pick a file under ${MAX_MB} MB.`,
            })
          } else {
            setStatus({
              kind: 'error',
              message: `Upload failed (HTTP ${res.status}). Please try again.`,
            })
          }
          return
        }
        setStatus({
          kind: 'success',
          storagePath: minted.storagePath,
          sanitizedFilename: minted.sanitizedFilename,
        })
        onUploaded({
          storagePath: minted.storagePath,
          sanitizedFilename: minted.sanitizedFilename,
        })
      } catch {
        setStatus({
          kind: 'error',
          message: 'Upload interrupted. Check your connection and try again.',
        })
      }
    },
    [onUploaded],
  )

  const onPickClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const onFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      // Always clear the input value so the same file can be
      // re-selected after the user cancels (the browser doesn't
      // fire `change` for a no-op re-pick otherwise).
      e.target.value = ''
      if (!file) return
      void uploadFile(file)
    },
    [uploadFile],
  )

  const onDragOver = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      void uploadFile(file)
    },
    [uploadFile],
  )

  const onClear = useCallback(() => {
    setStatus({ kind: 'idle' })
    onCleared()
  }, [onCleared])

  const inFlight =
    status.kind === 'validating' ||
    status.kind === 'minting' ||
    status.kind === 'uploading'

  const errorMessage = status.kind === 'error' ? status.message : null

  // When a proof is uploaded and the user hasn't yet replaced it,
  // surface the "Uploaded" state. The status is tracked in local
  // state so the drop zone can render its own progress UI without
  // depending on the parent re-render.
  if (uploaded && status.kind !== 'error') {
    return (
      <div className={styles.row} aria-busy={false}>
        <div className={styles.uploadedRow}>
          <div className={styles.uploadedMeta}>
            <span className={styles.uploadedName}>{uploaded.sanitizedFilename}</span>
            <span className={styles.uploadedHint}>
              Uploaded. It will be attached to your refund request on submit.
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={inFlight}
          >
            Remove
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.row} aria-busy={inFlight}>
      <button
        ref={dropZoneRef}
        type="button"
        className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''}`}
        onClick={onPickClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onPickClick()
          }
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        aria-describedby={`${inputId}-hint`}
        disabled={inFlight}
      >
        <span className={styles.dropIcon} aria-hidden>
          {inFlight ? '…' : '↑'}
        </span>
        <span className={styles.dropTitle}>
          {inFlight
            ? status.kind === 'minting'
              ? 'Preparing…'
              : status.kind === 'uploading'
                ? 'Uploading…'
                : 'Validating…'
            : 'Drag & drop or click to choose a file'}
        </span>
        <span id={`${inputId}-hint`} className={styles.dropHint}>
          {ACCEPT_MIMES_HINT} up to {MAX_MB} MB. Optional.
        </span>
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
      {errorMessage && (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

/** Exported for tests + parent components that want to format
 *  sizes consistently with the uploader's own logic. */
export { formatBytes }