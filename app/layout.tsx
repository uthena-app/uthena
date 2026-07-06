import type { Metadata, Viewport } from 'next'
import { Inter, Inter_Tight, JetBrains_Mono } from 'next/font/google'
import './globals.css'

// Brand faces (docs/BRAND_AND_POSITIONING.md §Typography). Self-hosted
// via next/font — zero layout shift, no external CDN request. The
// tokens (--font-sans / --font-display / --font-mono in tokens.css)
// consume these CSS variables; the literal 'Inter' fallbacks in those
// tokens stay as a safety net.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})
const interTight = Inter_Tight({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter-tight',
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})
import { ErrorBoundary } from '@foundations/ui/ErrorBoundary'
import { ToastProvider } from '@foundations/ui/Toast'
import { SearchOverlay, SearchTrigger } from '@features/search'
import { MobileNavTrigger } from '@features/mobile-nav'
import { CartTrigger } from '@features/cart'
import { JsonLd, buildOrganizationSchema } from '@foundations/structured-data'
import { getConsentBannerState } from '@features/consent/queries/getConsentBannerState'
import { CookieConsentBanner, ConsentAwareAnalytics } from '@features/consent'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'

// `metadataBase` lets every relative path in `images[]` and
// `alternates.canonical` resolve to `https://uthena.com/...` at
// serialization time. Without it, Next.js would warn about
// relative URLs in metadata. Production origin is hardcoded
// because canonical URLs must be stable across server + client
// renders (no hydration mismatch).
const SITE_ORIGIN = 'https://uthena.com'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: 'Uthena — Wholesale PLR Video Courses',
    template: '%s · Uthena',
  },
  description:
    'Wholesale PLR video courses and digital assets. Resell, rebrand, keep the profits.',
  applicationName: 'Uthena',
  authors: [{ name: 'Uthena' }],
  keywords: ['PLR courses', 'wholesale', 'video courses', 'digital products', 'reseller'],
  // Site-wide OpenGraph defaults. Pages that pass `openGraph`
  // in their own `metadata` export inherit these + override
  // individual fields (e.g. `title`, `url`, `images`).
  openGraph: {
    type: 'website',
    siteName: 'Uthena',
    locale: 'en_US',
    // Default OG image — used when a page doesn't supply its
    // own. Renders via the dynamic generator at `/og`.
    images: [
      {
        url: '/og?title=Uthena&subtitle=Wholesale+PLR+Video+Courses',
        width: 1200,
        height: 630,
        alt: 'Uthena — Wholesale PLR Video Courses',
      },
    ],
  },
  // Twitter Card defaults. `summary_large_image` shows the
  // image prominently in the Twitter timeline. Individual
  // pages can override.
  twitter: {
    card: 'summary_large_image',
    title: 'Uthena — Wholesale PLR Video Courses',
    description:
      'Wholesale PLR video courses and digital assets. Resell, rebrand, keep the profits.',
    images: ['/og?title=Uthena&subtitle=Wholesale+PLR+Video+Courses'],
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0E1012' },
    { media: '(prefers-color-scheme: light)', color: '#F4F4F4' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${interTight.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {/* P0.22 — site-wide Organization JSON-LD. The single script
            tag anchors the brand entity in Google's Knowledge Graph
            and Bing's entity index. Rendered once globally; every
            page inherits it from the root layout. No client JS
            shipped — `<JsonLd>` is a server component that returns
            a `<script>` tag as part of the initial HTML payload. */}
        <JsonLd data={buildOrganizationSchema()} />
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        {/* Global client-side event bridges. Each is a tiny client
            island that delegates clicks on data-attr-bearing
            elements to a window event. They render null; mounted
            here so the document-level listener is live before any
            user interaction. */}
        <SearchTrigger />
        <MobileNavTrigger />
        <CartTrigger />
        <SiteHeader />
        {/* ToastProvider — global notification stack. Owns the
            transient toast surface (mounted at the body via portal
            on first client render). Every page can call useToast()
            to push success / info / error notifications. */}
        <ToastProvider>
          <ErrorBoundary>
            {/* Cookie-consent banner (P11.2). Reads geo + GPC
                headers + the visitor's prior consent_log row
                server-side; renders nothing when no banner is
                needed. Mounted INSIDE ToastProvider so any toast
                error from the action surfaces through the same
                stack, and INSIDE ErrorBoundary so a banner runtime
                error doesn't crash the page. */}
            <CookieBannerMount />
            {/* P11.3: bridges the user's consent state to PostHog.
                Mounted INSIDE ToastProvider + ErrorBoundary (same
                scope as the banner), so any island-level failure
                surfaces through the existing error boundary. */}
            <ConsentAwareAnalyticsBridge />
            {children}
          </ErrorBoundary>
        </ToastProvider>
        <SiteFooter />
        {/* SearchOverlay owns the ⌘K listener + the modal DOM. Mounted
            at the root so it persists across page navigations (the
            overlay's open state survives client-side route changes
            without a remount). */}
        <SearchOverlay />
      </body>
    </html>
  )
}

/** Server component that resolves the cookie banner state and
 *  mounts the banner. Lives as a separate component (rather than
 *  inlined in the layout) so the layout stays a server component
 *  without a top-level `await` (Next.js layouts can do `await`,
 *  but isolating the data fetch in its own component makes the
 *  layout composition easier to read). */
async function CookieBannerMount() {
  const state = await getConsentBannerState()
  return <CookieConsentBanner bannerState={state} />
}

/** P11.3: consent-aware analytics bridge. Reads the same resolved
 *  `consent` projection the banner uses (no extra DB round-trip),
 *  then mounts a client island that wires the user's consent state
 *  to the PostHog SDK's opt-in / opt-out API. The island lives in
 *  its own component so the layout composition stays readable. */
async function ConsentAwareAnalyticsBridge() {
  const state = await getConsentBannerState()
  return <ConsentAwareAnalytics initial={state.consent} />
}
