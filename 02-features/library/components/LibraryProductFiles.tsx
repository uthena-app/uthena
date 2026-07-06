// LibraryProductFiles.tsx — the per-product file vault section on
// /library/[slug]. RSC. Reuses the existing `<VaultItem>` so the
// row shape, last-accessed label, and generate-link client island
// are identical to the cross-product file vault on /library.
//
// Why not just render <VaultItem> on /library per product?
//   - The cross-product vault groups files by product and shows
//     them under a single /library page. The per-product surface
//     shows only THIS product's files, scoped to one section.
//   - Reusing <VaultItem> keeps the row shape consistent: same
//     kind badge, same size formatting, same last-accessed label,
//     same GenerateLinkButton. Users get the same affordance they
//     already know.
//
// Empty state: when the user owns the product but no files are
// attached (common for video-only courses without a transcript),
// render an empty-state hint pointing them to /library/watch/demo
// for the player demo. (The real "watch the course" CTA lands in
// Phase 15 P15.2 when the lessons surface ships.)

import { VaultItem } from '@features/library'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import type { LibraryProductFile } from '../queries/getLibraryProduct'
import styles from './LibraryProductFiles.module.css'

export type LibraryProductFilesProps = {
  files: LibraryProductFile[]
}

export function LibraryProductFiles({ files }: LibraryProductFilesProps) {
  return (
    <section className={styles.section} aria-label="Files for this course">
      <h2 className={styles.h2}>Files</h2>
      <p className={styles.hint}>
        Source files, transcripts, and sales materials. Generate a 24h signed
        link for any file — the link works from any device until it expires.
      </p>
      {files.length === 0 ? (
        <EmptyState
          variant="card"
          title="No downloadable files for this course yet."
          description="This course is video-only. Head to the player demo to try the video surface."
          action={
            <a href="/library/watch/demo" className={styles.demoLink}>
              Open the player demo
            </a>
          }
        />
      ) : (
        <ul className={styles.list}>
          {files.map((f) => (
            <VaultItem key={f.id} file={f} />
          ))}
        </ul>
      )}
    </section>
  )
}