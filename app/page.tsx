// Home page — server component. Reads real published products, active
// categories, public product stats, and hero art cells in parallel,
// then composes the seven home sections from `@features/home`. The
// global <SiteHeader> + <SiteFooter> are rendered by `app/layout.tsx`;
// this page owns only the body content.
//
// RSC + ISR with `revalidate = 60` per the home spec (target p95 < 200ms).
// No client JS for the data fetching. The NewsletterBand is the only
// client island (it owns its own 'use client' boundary + state).

import type { Metadata } from 'next'
import {
  Hero,
  TrustStrip,
  FeaturedSection,
  ReviewsSection,
  CategoriesSection,
  FaqSection,
  getPublicProductStats,
  getHomeHeroCells,
  getActiveCategories,
} from '@features/home'
import { NewsletterBand } from '@features/newsletter'
import { getFeaturedProducts, getPublishedProductCount } from '@features/catalog/queries'
import { getSubscriptionCatalogAccess } from '@features/library/queries/getSubscriptionCatalogAccess'
import { buildPageMetadata } from '@foundations/metadata'
import styles from './page.module.css'

export const revalidate = 60

// P0.21 — full OpenGraph + Twitter Card meta via the shared
// helper. The OG image defaults to the dynamic generator at
// `/og?title=Uthena+Wholesale+PLR+Video+Courses` (rendered
// server-side by `app/og/route.tsx`).
export const metadata: Metadata = buildPageMetadata({
  title: 'Wholesale PLR Video Courses',
  description:
    'Wholesale PLR video courses and digital assets for resellers, instructors, and affiliates. Buy a course once, rebrand and resell it forever. Free lifetime updates.',
  path: '/',
})

export default async function HomePage() {
  const [stats, artCells, categories, featured, totalCount, subscriptionAccess] =
    await Promise.all([
      getPublicProductStats(),
      getHomeHeroCells(),
      getActiveCategories(),
      getFeaturedProducts(6),
      getPublishedProductCount(),
      getSubscriptionCatalogAccess(),
    ])

  return (
    <main id="main" className={styles.page}>
      <Hero stats={stats} artCells={artCells} />
      <TrustStrip />
      <FeaturedSection
        products={featured}
        totalCount={totalCount}
        subscriptionProductIds={subscriptionAccess.productIds}
      />
      <ReviewsSection stats={stats} />
      <CategoriesSection categories={categories} />
      <NewsletterBand />
      <FaqSection />
    </main>
  )
}
