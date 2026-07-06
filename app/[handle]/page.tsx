// app/[handle]/page.tsx — P13.8 public minishop /[handle] route.
//
// The affiliate's branded storefront at uthena.com/[handle]. RSC,
// ISR-cached 5 minutes (per spec acceptance #13 — the curated list
// + bio change infrequently). Public (no auth required for read).
//
// **Flow:**
//   1. Validate the handle — reserved / bad shape → 404.
//   2. Resolve the affiliate + profile + curated products + stats
//      via getMiniShop(). Null → 404.
//   3. Render the 5 sections per spec: Hero / Trust strip /
//      Featured pick / Curated collection / About card / Footer.
//   4. Emit schema.org `Person` JSON-LD via buildPersonSchema().
//
// **Render strategy:**
//   - RSC, ISR with `revalidate = 300` — public marketing page,
//     cacheable for 5 minutes (per spec performance target).
//   - No client JS — the entire page is server-rendered.
//   - The "Edit your shop" link is a single async server component
//     that reads the auth session at render-time and renders nothing
//     for anon / mismatched users (per spec acceptance #4).
//
// **Why no robots meta**: the page is public + indexable per the
// spec (it IS the affiliate's marketing surface). `noindex` is
// reserved for authenticated + sensitive surfaces.

import 'server-only'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { buildPageMetadata } from '@foundations/metadata'
import { JsonLd, buildPersonSchema } from '@foundations/structured-data'
import {
  isReservedHandle,
  isValidHandleShape,
} from '@foundations/auth/reserved-handles'
import {
  getMiniShop,
  MiniShopHero,
  TrustStrip,
  FeaturedPick,
  CuratedCollection,
  AboutCard,
  MiniShopFooter,
  MiniShopEmptyState,
  MiniShopEditLink,
} from '@features/affiliate-portal'
import styles from './page.module.css'

export const revalidate = 300 // 5 minutes (per spec acceptance #13)

type Params = Promise<{ handle: string }>

/** Page metadata — OG + Twitter Card per spec acceptance #15.
 *  Falls back to a neutral title when the handle doesn't resolve
 *  so the not-found page renders with the canonical "Not found"
 *  title instead of leaking the handle. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { handle } = await params
  // Cheap shape + reserved short-circuit — no DB read needed for
  // the negative path. The full not-found takes over after.
  if (!isValidHandleShape(handle) || isReservedHandle(handle)) {
    return {
      title: 'Not found',
      robots: { index: false, follow: false },
    }
  }
  const shop = await getMiniShop(handle)
  if (!shop) {
    return {
      title: 'Not found',
      robots: { index: false, follow: false },
    }
  }
  const displayName =
    shop.profile.displayName || `@${shop.affiliate.handle}`
  const brandLabel = shop.affiliate.brandName ?? displayName
  const description =
    shop.affiliate.bio?.trim() ||
    `Curated picks by ${displayName} on Uthena`
  const ogImage = shop.profile.avatarUrl ?? undefined
  return buildPageMetadata({
    title: `${brandLabel} (@${shop.affiliate.handle})`,
    description,
    path: `/${shop.affiliate.handle}`,
    image: ogImage,
    type: 'profile',
  })
}

export default async function MiniShopPage({ params }: { params: Params }) {
  const { handle } = await params

  // Reserve-list + shape guard — same surface the onboarding wizard
  // validates against. Reserved / malformed handles 404 before we
  // even hit the DB.
  if (!isValidHandleShape(handle) || isReservedHandle(handle)) {
    notFound()
  }

  const shop = await getMiniShop(handle)
  if (!shop) {
    notFound()
  }

  const { affiliate, profile, curatedProducts, stats } = shop
  const displayName = profile.displayName || `@${affiliate.handle}`
  const minishopPath = `/${affiliate.handle}`

  // Auto-promote single curated product to featured (spec acceptance #12).
  // The data is shape-correct from the query (`is_featured` boolean
  // reflects DB state); for a single curated row, the query sees
  // `is_featured` as whatever the editor set. We defend against the
  // off-shape case where the lone curated row somehow has
  // is_featured=false (e.g. old data) — the page surfaces the only
  // product as the featured pick regardless, with a fallback flag for
  // the parent.
  const featured =
    curatedProducts.find((p) => p.isFeatured) ??
    (curatedProducts.length === 1 ? curatedProducts[0] : null)
  const restOfCollection = featured
    ? curatedProducts.filter((p) => p.curatedId !== featured.curatedId)
    : curatedProducts

  const personSchema = buildPersonSchema({
    handle: affiliate.handle,
    name: displayName,
    bio: affiliate.bio,
    avatarUrl: profile.avatarUrl,
    socialLinks: profile.socialLinks,
  })

  return (
    <main className={styles.shell}>
      <JsonLd data={personSchema} />

      {/* Top bar — brand label (left) + edit link (right). */}
      <nav className={styles.topBar} aria-label="Mini-shop navigation">
        <a href={minishopPath} className={styles.brand}>
          {affiliate.brandName ?? displayName}
          <span className={styles.brandHandle}>@{affiliate.handle}</span>
        </a>
        <MiniShopEditLink
          affiliateUserId={affiliate.userId}
          handle={affiliate.handle}
        />
      </nav>

      {/* Hero — identity + 4 stat tiles + (optional) avatar. */}
      <MiniShopHero
        affiliate={affiliate}
        profile={profile}
        curatedProducts={curatedProducts}
        lifetimeEarnedCents={stats.lifetimeEarnedCents}
        clicks30d={stats.clicks30d}
        avgRating={stats.avgRating}
      />

      {/* Trust strip — 4 platform-wide promises. */}
      <TrustStrip />

      {/* Empty-state OR featured pick + curated collection. */}
      {curatedProducts.length === 0 ? (
        <MiniShopEmptyState affiliate={affiliate} />
      ) : (
        <>
          {featured && (
            <FeaturedPick
              product={featured}
              affiliateHandle={affiliate.handle}
              displayName={displayName}
              miniShopPath={minishopPath}
            />
          )}
          {restOfCollection.length > 0 && (
            <CuratedCollection
              products={restOfCollection}
              affiliateHandle={affiliate.handle}
            />
          )}
        </>
      )}

      {/* About card — bio + 3 stats (lifetime earned + joined + verified). */}
      <AboutCard
        affiliate={affiliate}
        profile={profile}
        lifetimeEarnedCents={stats.lifetimeEarnedCents}
      />

      {/* Footer — copyright + legal links. */}
      <MiniShopFooter affiliate={affiliate} />
    </main>
  )
}
