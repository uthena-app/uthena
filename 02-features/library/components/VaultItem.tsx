// VaultItem.tsx — one row in the file vault. Shows the file name,
// a kind badge (format), size, optional duration, last-accessed
// timestamp, and a "Generate link" button that posts to
// mintDownloadUrlAction.
//
// P7.4 — added a bulk-select checkbox at the left of the row. The
// checkbox is plain HTML (`<input type="checkbox" name="file_ids">`)
// so the form submission works without JS; the client island
// (BulkDownloadBar) reads the selection count + total size from
// the data-file-size attribute. The checkbox has an `<label>`
// wrapper for click-target area + a11y, and the "Select" label is
// screen-reader-only to keep the row visually unchanged.

import { VaultFile } from '@features/library/queries/getUserAccessibleFiles'
import { formatTimeAgo } from '@features/account/profile/queries/formatTimeAgo'
import { GenerateLinkButton } from './GenerateLinkButton'
import styles from './VaultItem.module.css'

const KIND_LABEL: Record<VaultFile['kind'], string> = {
  video: 'Video', slides: 'Slides', transcript: 'Transcript', graphics: 'Graphics',
  audio: 'Audio', document: 'Document', archive: 'Archive', other: 'File',
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function VaultItem({ file }: { file: VaultFile }) {
  const lastAccessedLabel = file.last_accessed_at ? formatTimeAgo(file.last_accessed_at) : 'Never accessed'
  // The meta line already shows "Product · Size · Duration". Last accessed
  // gets its own row so the size + duration stay scannable on a single
  // line and the relative time doesn't crowd the file name.
  const metaParts: string[] = [file.product_title, formatSize(file.size_bytes)]
  if (file.duration_seconds) metaParts.push(`${Math.round(file.duration_seconds / 60)} min`)

  return (
    <li className={styles.row}>
      <label className={styles.selectCell} aria-label={`Select ${file.original_filename} for bulk download`}>
        <input
          type="checkbox"
          name="file_ids"
          value={file.id}
          data-file-size={file.size_bytes}
          className={styles.selectInput}
        />
        <span className={styles.srOnly}>Select</span>
      </label>
      <div className={styles.kindBadge}>{KIND_LABEL[file.kind]}</div>
      <div className={styles.body}>
        <p className={styles.name}>{file.original_filename}</p>
        <p className={styles.meta}>{metaParts.join(' · ')}</p>
        <p className={styles.lastAccessed}>
          Last accessed: <span className={styles.lastAccessedValue}>{lastAccessedLabel}</span>
        </p>
      </div>
      <GenerateLinkButton fileId={file.id} />
    </li>
  )
}
