// GenerateLinkButton.tsx — client island. Posts to mintDownloadUrlAction,
// shows the URL + expiry inline. Copy-to-clipboard UX.

'use client'

import { useState, useTransition } from 'react'
import { mintDownloadUrlAction } from '../actions/mintDownloadUrl'
import styles from './GenerateLinkButton.module.css'

export function GenerateLinkButton({ fileId }: { fileId: number }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; expires_at: string; file_name: string } | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      const res = await mintDownloadUrlAction({ file_id: fileId })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setResult({ url: res.url, expires_at: res.expires_at, file_name: res.file_name })
    })
  }

  async function copy() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.url)
    } catch {
      // Fallback: select the text in the input.
    }
  }

  if (result) {
    return (
      <div className={styles.urlBox}>
        <input
          type="text"
          readOnly
          value={result.url}
          onClick={(e) => e.currentTarget.select()}
          className={styles.urlInput}
        />
        <div className={styles.urlActions}>
          <button type="button" onClick={copy} className={styles.copyBtn}>
            Copy
          </button>
          <a href={result.url} download={result.file_name} className={styles.openBtn}>
            Open
          </a>
        </div>
        <p className={styles.expiry}>Expires {new Date(result.expires_at).toLocaleString()}</p>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <button type="button" onClick={onClick} disabled={isPending} className={styles.btn}>
        {isPending ? 'Generating…' : 'Generate link'}
      </button>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  )
}
