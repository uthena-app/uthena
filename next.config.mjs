/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Security headers are applied at the edge by `middleware.ts` (single
  // source of truth: `00-foundations/security/headers.ts`). Per-route
  // variants are documented in `01-specs/pages/security-headers.md`.
  // Don't duplicate headers here — the middleware is the canonical layer
  // and any change should land in `headers.ts`, not next.config.
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb', // instructor uploads are tus-direct to Bunny; server actions stay small
    },
  },
  images: {
    remotePatterns: [
      // Bunny Storage CDN — replace hostname when zone is provisioned
      { protocol: 'https', hostname: '**.b-cdn.net' },
      // Bunny Stream thumbnails
      { protocol: 'https', hostname: '**.mediadelivery.net' },
      // PostHog asset proxy (own domain in production)
      { protocol: 'https', hostname: 'eu-assets.i.posthog.com' },
    ],
  },
  // Legacy Shopify URL → v2 canonical redirects. Permanent (308).
  // See 01-specs/pages/{terms,privacy,dmca,delivery,refund-policy,
  // data-sharing-opt-out,contact,faq,bundles}.md + 01-specs/pages/
  // seo-url-migration.md for context. P0.18 added the two bundles
  // redirects from the Shopify /pages/ era to the v2 /bundles route.
  async redirects() {
    return [
      { source: '/policies/privacy-policy', destination: '/privacy', permanent: true },
      { source: '/policies/terms-of-service', destination: '/terms', permanent: true },
      { source: '/policies/legal-notice', destination: '/terms', permanent: true },
      { source: '/policies/refund-policy', destination: '/refund-policy', permanent: true },
      { source: '/policies/shipping-policy', destination: '/delivery', permanent: true },
      { source: '/pages/data-sharing-opt-out', destination: '/data-sharing-opt-out', permanent: true },
      { source: '/pages/contact', destination: '/contact', permanent: true },
      { source: '/pages/faq', destination: '/faq', permanent: true },
      // P0.18 — bundles. /pages/bundles and /pages/collection-bundles
      // were the two Shopify-era bundle landing URLs; both redirect to
      // the v2 /bundles canonical. See 01-specs/pages/seo-url-migration.md
      // Shopify page redirect map.
      { source: '/pages/bundles', destination: '/bundles', permanent: true },
      { source: '/pages/collection-bundles', destination: '/bundles', permanent: true },
      // P12.7 — partner course creation / edit aliases. The Shopify
      // sitemap exposed /pages/submit-new-course + /pages/update-course;
      // both redirect to the clean top-level URLs which then
      // auth-gate and dispatch to /partner/upload (create) or
      // /partner/courses (edit). See 01-specs/pages/{submit-new-course,
      // update-course}.md.
      { source: '/pages/submit-new-course', destination: '/submit-new-course', permanent: true },
      { source: '/pages/update-course', destination: '/update-course', permanent: true },
    ]
  },
  // CSS Modules + design tokens; no Tailwind.
}

export default nextConfig