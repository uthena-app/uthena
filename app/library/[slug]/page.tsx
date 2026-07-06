// /library/[slug] — per-product detail page for the buyer's library.
// RSC. Composes:
//   - <LibraryProductHeader>      — breadcrumb + thumbnail + title + meta + back-link
//   - <LibraryProductFiles>       — per-product file vault (reuses <VaultItem>)
//   - <LibraryProductSharing>     — concurrent-stream / rate-limit / TTL context
//   - <LibraryProductLessons>     — Slice-1 placeholder (Phase 15 P15.2 will replace)
//   - <LibraryProductCertificate> — Slice-1 placeholder (Phase 15 P15.11+P15.12 will replace)
//
// Auth + access gates (defense in depth):
//   1. `requireUser('/library/[slug]')` — redirects anon to
//      /login?next=<current path>.
//   2. `getLibraryProduct()` returns null when the slug isn't in
//      `user_accessible_products`. The page treats null as 404 —
//      never leaks product existence to non-owners.
//
// Why not render the public PDP here too? The /library/[slug] page
// is the OWNER's view — re-watch, download, certificate, sharing
// rules. The public PDP (/products/[slug]) is the BUYER's view —
// pricing, gallery, reviews, license picker. The two have different
// intents; merging them would mix concerns.
//
// Why `force-dynamic`: every read is per-user. No static cache.

import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { requireUser } from '@foundations/auth/guards'
import { sensitivePageMetadata } from '@foundations/metadata'
import { getLibraryProduct } from '@features/library/queries/getLibraryProduct'
import {
  LibraryProductHeader,
  LibraryProductFiles,
  LibraryProductSharing,
  LibraryProductLessons,
  LibraryProductCertificate,
} from '@features/library'
import styles from './page.module.css'

type Params = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const data = await getLibraryProduct(slug)
  if (!data) {
    return sensitivePageMetadata({
      title: 'Course not found',
      description: 'This course is not in your library.',
      path: `/library/${slug}`,
    })
  }
  return sensitivePageMetadata({
    title: `${data.product.title} — Your library`,
    description: data.product.short_description,
    path: `/library/${slug}`,
  })
}

export const dynamic = 'force-dynamic'

export default async function LibraryProductPage({ params }: { params: Params }) {
  const { slug } = await params

  // Gate 1: auth.
  const user = await requireUser(`/library/${slug}`)
  if (!user) redirect(`/login?next=/library/${encodeURIComponent(slug)}`)

  // Gate 2: access via user_accessible_products RPC. null = either
  // the user doesn't own this product, the product is unpublished, or
  // a DB error. Treat all three as 404 (don't leak existence).
  const data = await getLibraryProduct(slug)
  if (!data) notFound()

  return (
    <main id="main" className={styles.page}>
      <LibraryProductHeader product={data.product} access={data.access} />

      <div className={styles.layout}>
        <div className={styles.main}>
          <LibraryProductFiles files={data.files} />
          <LibraryProductSharing activeStreams={data.activeStreams} />
        </div>
        <aside className={styles.aside} aria-label="Course progress">
          <LibraryProductLessons product={data.product} />
          <LibraryProductCertificate />
        </aside>
      </div>
    </main>
  )
}