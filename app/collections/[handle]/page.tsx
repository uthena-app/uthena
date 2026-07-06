// Collection detail — `/collections/[handle]`. P0.17.
//
// A "collection" is a hand-picked, team-curated grouping of products,
// distinct from a category (taxonomy). The page tries the collections
// table first; if no published collection matches the slug, it falls
// back to a category lookup so the legacy Shopify redirect URLs (e.g.
// `/collections/ai-courses`) keep working — see
// `01-specs/pages/seo-url-migration.md` for the full URL migration
// plan.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  getActiveCategories,
  getCollectionBySlug,
  getPublishedProducts,
  type CollectionDetail,
} from '@features/catalog/queries'
import { ProductCard } from '@features/catalog/ProductCard'
import { getSubscriptionCatalogAccess } from '@features/library/queries/getSubscriptionCatalogAccess'
import { EmptyState } from '@foundations/ui/primitives/EmptyState'
import { buildPageMetadata } from '@foundations/metadata'
import { JsonLd, buildBreadcrumbSchema } from '@foundations/structured-data'
import styles from './collection.module.css'

export const revalidate = 60

type Params = Promise<{ handle: string }>

type Resolved =
  | { kind: 'collection'; collection: CollectionDetail }
  | { kind: 'category'; name: string; slug: string }

/**
 * Try the collections table first; on miss, try a category lookup.
 * Returns `null` when neither matches (the page renders 404). The
 * legacy-redirect behavior preserves the SEO value of every pre-v2
 * `/collections/<category-slug>` URL.
 */
async function resolveCollection(handle: string): Promise<Resolved | null> {
  const c = await getCollectionBySlug(handle)
  if (c) return { kind: 'collection', collection: c }
  // Legacy fallback — the page can still render the existing
  // category-as-collection view for legacy redirect URLs.
  const cats = await getActiveCategories()
  const cat = cats.find((row) => row.slug === handle)
  if (cat) return { kind: 'category', name: cat.name, slug: cat.slug }
  return null
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { handle } = await params
  const resolved = await resolveCollection(handle)
  if (!resolved) return { title: 'Collection not found' }
  if (resolved.kind === 'collection') {
    const c = resolved.collection
    // P0.21 — full OG + Twitter Card via the shared helper.
    return buildPageMetadata({
      title: `${c.name} — curated collection`,
      description: c.description ?? `A hand-picked collection of Uthena courses: ${c.name}.`,
      path: `/collections/${handle}`,
    })
  }
  return buildPageMetadata({
    title: `${resolved.name} courses`,
    description: `Browse every ${resolved.name.toLowerCase()} course on Uthena.`,
    path: `/collections/${handle}`,
  })
}

export default async function CollectionPage({ params }: { params: Params }) {
  const { handle } = await params
  const resolved = await resolveCollection(handle)
  if (!resolved) notFound()

  if (resolved.kind === 'collection') {
    const c = resolved.collection
    const products = c.products
    const subscriptionAccess = await getSubscriptionCatalogAccess()
    // P0.22 — JSON-LD BreadcrumbList (Home > Collections > {name}).
    const breadcrumbSchema = buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Collections', path: '/collections' },
      { name: c.name, path: `/collections/${handle}` },
    ])
    return (
      <>
        <JsonLd data={breadcrumbSchema} />
        <main id="main" className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Collection</p>
          <h1 className={styles.h1}>{c.name}</h1>
          {c.description ? (
            <p className={styles.lede}>{c.description}</p>
          ) : (
            <p className={styles.lede}>
              A hand-picked set of {products.length}{' '}
              {products.length === 1 ? 'course' : 'courses'} curated by Uthena.
            </p>
          )}
        </header>
        {products.length === 0 ? (
          <EmptyState
            title="This collection is being curated."
            description="No published courses in this collection yet. Check back soon."
            action={
              <a href="/collections" className={styles.linkBtn}>
                See all collections
              </a>
            }
          />
        ) : (
          <div className={styles.grid}>
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                subscriptionIncluded={subscriptionAccess.productIds.has(p.id)}
              />
            ))}
          </div>
        )}
      </main>
      </>
    )
  }

  // Legacy category fallback — preserves `/collections/<category-slug>`
  // URLs from the Shopify era. Uses the same `<ProductCard>` grid but
  // the catalog query for the category rather than the curated list.
  const [products, subscriptionAccess] = await Promise.all([
    getPublishedProducts({ category: resolved.slug, limit: 60 }),
    getSubscriptionCatalogAccess(),
  ])
  // P0.22 — JSON-LD BreadcrumbList for the legacy category fallback
  // (Home > Collections > {category name}).
  const breadcrumbSchema = buildBreadcrumbSchema([
    { name: 'Home', path: '/' },
    { name: 'Collections', path: '/collections' },
    { name: resolved.name, path: `/collections/${handle}` },
  ])
  return (
    <>
      <JsonLd data={breadcrumbSchema} />
      <main id="main" className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Collection</p>
        <h1 className={styles.h1}>{resolved.name}</h1>
        <p className={styles.lede}>
          {products.length} {products.length === 1 ? 'course' : 'courses'} in {resolved.name}
        </p>
      </header>
      {products.length === 0 ? (
        <EmptyState
          title="No courses in this collection yet."
          description="Check back soon."
        />
      ) : (
        <div className={styles.grid}>
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              subscriptionIncluded={subscriptionAccess.productIds.has(p.id)}
            />
          ))}
        </div>
      )}
    </main>
    </>
  )
}
