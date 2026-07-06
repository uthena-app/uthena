// /og — dynamic OpenGraph image generator. P0.21.
//
// Usage. <meta property="og:image" content="/og?title=…&subtitle=…" />
// Renders a 1200×630 PNG with the Uthena brand chrome (dark
// canvas + teal accent + Inter Tight title). The image is
// generated server-side per request — there's no static PNG
// file to maintain and per-page images work without storing
// dozens of PNGs in the repo.
//
// Why next/og (built into next@15.0.3, no extra dep):
//   - One file, zero build steps, zero binary assets.
//   - The image is computed at request time from the title +
//     subtitle query params. Every page that doesn't supply its
//     own og:image gets a branded share card with its own
//     headline.
//   - The output is cached at the edge by Next.js's default
//     static rendering of route handlers (when no runtime is
//     specified, route handlers default to Node.js runtime —
//     fine for ImageResponse, which has had Node.js support
//     since Next.js 13.4).
//
// Page-driven usage (the common case).
//   <meta property="og:image"
//         content="/og?title=AI+Personal+Branding&subtitle=Uthena" />
// Helper-driven usage (from `buildPageMetadata`).
//   When `image` is not supplied, the helper emits:
//     /og?title=<page-title>&subtitle=Uthena
//   so the resulting share card shows the page's title.
//
// Static usage.
//   <meta property="og:image" content="/og?title=Uthena&subtitle=Wholesale+PLR+Video+Courses" />
//   This is `DEFAULT_OG_IMAGE` from `@foundations/metadata` and
//   is what the site-wide default looks like (used when a page
//   doesn't supply a title, e.g. the root layout's `openGraph`).
//
// Output format.
//   - 1200×630 PNG (standard social-share card aspect).
//   - Cache-Control: public, max-age=3600, s-maxage=3600.
//     Same 1h cache window as the rest of the marketing
//     surface (P0.20 sitemap routes use the same TTL).
//
// Defensive input handling.
//   - `title` capped at 90 chars (long titles wrap badly in
//     the layout; we'll show ellipsis when over).
//   - `subtitle` capped at 60 chars.
//   - Untrusted characters escaped by JSX (React handles it).
//   - Unknown query params ignored.

import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const TITLE_MAX = 90
const SUBTITLE_MAX = 60
const SITE_FOOTER = 'uthena.com'
const BG = '#0E1012'
const SURFACE = '#15181B'
const LINE = '#2A2F35'
const TEXT_PRIMARY = '#FFFFFF'
const TEXT_SECONDARY = '#A1A4AC'
const TEXT_MUTED = '#6B6E76'
const TEAL = '#1ABC9C'
const TEAL_SOFT = 'rgba(26, 188, 156, 0.10)'
const TEAL_LINE = 'rgba(26, 188, 156, 0.30)'

// Capped by the helper so the image layout never overflows.
// Title runs full width; subtitle runs beneath the title in
// teal-soft style.
function clamp(value: string, max: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trimEnd()}…`
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const title = clamp(url.searchParams.get('title') ?? 'Uthena', TITLE_MAX)
  const subtitle = clamp(url.searchParams.get('subtitle') ?? 'PLR · MRR · Wholesale', SUBTITLE_MAX)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: BG,
          padding: 64,
          fontFamily: 'sans-serif',
          color: TEXT_PRIMARY,
        }}
      >
        {/* Top row — brand mark + site footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          {/* Brand mark — wordmark + teal identity dot.
              Matches the v4 brand kit. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                background: TEAL,
                boxShadow: `0 0 0 4px ${TEAL_SOFT}`,
                display: 'flex',
              }}
            />
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: TEXT_PRIMARY,
              }}
            >
              Uthena
            </div>
          </div>
          <div
            style={{
              fontSize: 22,
              color: TEXT_MUTED,
              letterSpacing: '0.02em',
            }}
          >
            {SITE_FOOTER}
          </div>
        </div>

        {/* Middle row — title + subtitle. flex:1 + flex centering
            makes the title block sit at the visual center of the
            card regardless of title length. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
            gap: 24,
            maxWidth: 980,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: TEAL,
              display: 'flex',
            }}
          >
            {subtitle}
          </div>
          <div
            style={{
              fontSize: title.length > 40 ? 64 : 80,
              fontWeight: 700,
              letterSpacing: '-0.025em',
              lineHeight: 1.1,
              color: TEXT_PRIMARY,
              display: 'flex',
            }}
          >
            {title}
          </div>
        </div>

        {/* Bottom row — footer pill. Mirrors the SiteFooter pay-
            chip pattern (white pill on the cream footer zone)
            but in dark mode (soft teal pill on dark). The pill
            signals "this is a real product, not a marketing
            landing". */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 18px',
              borderRadius: 999,
              background: SURFACE,
              border: `1px solid ${LINE}`,
              fontSize: 20,
              color: TEXT_SECONDARY,
              letterSpacing: '0.02em',
            }}
          >
            Wholesale PLR · MRR · Bundles
          </div>
          <div
            style={{
              display: 'flex',
              padding: '10px 18px',
              borderRadius: 999,
              background: TEAL_SOFT,
              border: `1px solid ${TEAL_LINE}`,
              fontSize: 20,
              color: TEAL,
              fontWeight: 600,
            }}
          >
            Resell · Rebrand · Keep the profit
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        // 1h edge cache — same TTL as the sitemap routes (P0.20).
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    }
  )
}