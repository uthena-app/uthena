// Unit tests for the security headers module (P2.7).
//
// Pure-function tests, no fixtures needed. Covers:
//   - CSP_DIRECTIVES is the canonical list (every directive present,
//     order preserved, no duplicates)
//   - CSP_VALUE joins with '; '
//   - HSTS_VALUE matches the production 2-year + preload value
//   - PERMISSIONS_POLICY_VALUE blocks camera/mic/geo/FLoC
//   - UNIVERSAL_HEADERS is the 3-entry set
//   - HTML_PAGE_EXTRA_HEADERS is the 7-entry set (CSP + HSTS +
//     X-Frame-Options + Permissions-Policy + COOP + CORP +
//     Origin-Agent-Cluster)
//   - classifyPath dispatches every variant correctly
//   - getSecurityHeaders returns the right header set for every variant
//   - applySecurityHeaders sets headers on a fake response
//   - HTML page header set is complete (10 entries — 3 universal +
//     7 page-extra)
//   - Image / XML / text variant drops CSP + Permissions-Policy +
//     COOP / CORP but keeps HSTS + X-Frame-Options
//   - JSON variant drops CSP + Permissions-Policy + COOP / CORP
//     but keeps HSTS + X-Frame-Options
//   - Binary variant drops CSP + HSTS + X-Frame-Options +
//     Permissions-Policy + COOP / CORP (universal only)
//   - Webhook variant drops CSP + HSTS + X-Frame-Options +
//     Permissions-Policy + COOP / CORP (universal only)
//   - Health variant drops CSP + HSTS + X-Frame-Options +
//     Permissions-Policy + COOP / CORP (universal only)
//   - Explicit variant override bypasses the classifier
//
// Run: `pnpm test headers` (vitest).

import { describe, expect, it } from 'vitest'
import {
  applySecurityHeaders,
  classifyPath,
  CSP_DIRECTIVES,
  CSP_VALUE,
  getSecurityHeaders,
  HSTS_VALUE,
  HTML_PAGE_EXTRA_HEADERS,
  PERMISSIONS_POLICY_VALUE,
  UNIVERSAL_HEADERS,
} from './headers'

describe('CSP_DIRECTIVES', () => {
  it('contains every required directive in order', () => {
    expect(CSP_DIRECTIVES).toEqual([
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://eu.i.posthog.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.b-cdn.net https://*.mediadelivery.net",
      "media-src 'self' blob: https://*.b-cdn.net https://*.mediadelivery.net",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://eu.i.posthog.com https://api.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ])
  })

  it('CSP_VALUE joins with "; "', () => {
    expect(CSP_VALUE).toBe(CSP_DIRECTIVES.join('; '))
  })

  it('CSP_VALUE starts with default-src', () => {
    expect(CSP_VALUE.startsWith("default-src 'self'")).toBe(true)
  })

  it('CSP_VALUE ends with upgrade-insecure-requests', () => {
    expect(CSP_VALUE.endsWith('upgrade-insecure-requests')).toBe(true)
  })

  it('CSP_VALUE blocks framing via frame-ancestors', () => {
    expect(CSP_VALUE).toContain("frame-ancestors 'none'")
  })

  it('CSP_VALUE blocks legacy plugins via object-src', () => {
    expect(CSP_VALUE).toContain("object-src 'none'")
  })

  it('CSP_VALUE allows the Bunny CDN for images', () => {
    expect(CSP_VALUE).toContain('https://*.b-cdn.net')
  })

  it('CSP_VALUE allows the Bunny Stream CDN for media', () => {
    expect(CSP_VALUE).toContain('https://*.mediadelivery.net')
  })

  it('CSP_VALUE allows PostHog for analytics', () => {
    expect(CSP_VALUE).toContain('https://eu.i.posthog.com')
  })

  it('CSP_VALUE allows Stripe for checkout', () => {
    expect(CSP_VALUE).toContain('https://api.stripe.com')
  })

  it('CSP_VALUE allows Supabase for auth + DB + storage', () => {
    expect(CSP_VALUE).toContain('https://*.supabase.co')
  })
})

describe('HSTS_VALUE', () => {
  it('is the canonical 2-year + preload value', () => {
    expect(HSTS_VALUE).toBe('max-age=63072000; includeSubDomains; preload')
  })

  it('has max-age >= 1 year (31536000 seconds)', () => {
    const match = HSTS_VALUE.match(/max-age=(\d+)/)
    expect(match).not.toBeNull()
    const maxAge = Number(match![1])
    expect(maxAge).toBeGreaterThanOrEqual(31536000)
  })
})

describe('PERMISSIONS_POLICY_VALUE', () => {
  it('blocks camera', () => {
    expect(PERMISSIONS_POLICY_VALUE).toContain('camera=()')
  })

  it('blocks microphone', () => {
    expect(PERMISSIONS_POLICY_VALUE).toContain('microphone=()')
  })

  it('blocks geolocation', () => {
    expect(PERMISSIONS_POLICY_VALUE).toContain('geolocation=()')
  })

  it('opts out of FLoC / Topics API', () => {
    expect(PERMISSIONS_POLICY_VALUE).toContain('interest-cohort=()')
  })
})

describe('UNIVERSAL_HEADERS', () => {
  it('sets X-Content-Type-Options to nosniff', () => {
    expect(UNIVERSAL_HEADERS['X-Content-Type-Options']).toBe('nosniff')
  })

  it('disables DNS prefetch', () => {
    expect(UNIVERSAL_HEADERS['X-DNS-Prefetch-Control']).toBe('off')
  })

  it('uses strict-origin-when-cross-origin Referrer-Policy', () => {
    expect(UNIVERSAL_HEADERS['Referrer-Policy']).toBe(
      'strict-origin-when-cross-origin',
    )
  })

  it('has exactly 3 entries', () => {
    expect(Object.keys(UNIVERSAL_HEADERS)).toHaveLength(3)
  })
})

describe('HTML_PAGE_EXTRA_HEADERS', () => {
  it('includes CSP', () => {
    expect(HTML_PAGE_EXTRA_HEADERS['Content-Security-Policy']).toBe(CSP_VALUE)
  })

  it('includes HSTS', () => {
    expect(HTML_PAGE_EXTRA_HEADERS['Strict-Transport-Security']).toBe(HSTS_VALUE)
  })

  it('includes X-Frame-Options DENY', () => {
    expect(HTML_PAGE_EXTRA_HEADERS['X-Frame-Options']).toBe('DENY')
  })

  it('includes Permissions-Policy', () => {
    expect(HTML_PAGE_EXTRA_HEADERS['Permissions-Policy']).toBe(
      PERMISSIONS_POLICY_VALUE,
    )
  })

  it('includes Cross-Origin-Opener-Policy same-origin', () => {
    expect(HTML_PAGE_EXTRA_HEADERS['Cross-Origin-Opener-Policy']).toBe(
      'same-origin',
    )
  })

  it('includes Cross-Origin-Resource-Policy same-origin', () => {
    expect(HTML_PAGE_EXTRA_HEADERS['Cross-Origin-Resource-Policy']).toBe(
      'same-origin',
    )
  })

  it('includes Origin-Agent-Cluster ?1', () => {
    expect(HTML_PAGE_EXTRA_HEADERS['Origin-Agent-Cluster']).toBe('?1')
  })

  it('has exactly 7 entries (CSP + HSTS + X-Frame-Options + Permissions-Policy + COOP + CORP + Origin-Agent-Cluster)', () => {
    expect(Object.keys(HTML_PAGE_EXTRA_HEADERS)).toHaveLength(7)
  })
})

describe('classifyPath', () => {
  describe('HTML variant (default)', () => {
    it.each([
      '/',
      '/browse',
      '/products/some-slug',
      '/collections',
      '/collections/ai-courses',
      '/bundles',
      '/newsletter',
      '/search?q=ai',
      '/login',
      '/signup',
      '/reset-password',
      '/update-password',
      '/verify-email',
      '/cart',
      '/checkout',
      '/library',
      '/account',
      '/account/profile',
      '/account/orders',
      '/account/orders/123',
      '/partner',
      '/partner/courses',
      '/admin',
      '/admin/customers',
      '/admin/payouts',
      '/auth/callback?code=abc',
    ])('classifies %s as html', (path) => {
      expect(classifyPath(path)).toBe('html')
    })
  })

  describe('image variant', () => {
    it('classifies /og as image', () => {
      expect(classifyPath('/og')).toBe('image')
    })

    it('classifies /og?title=X as image (strips query string)', () => {
      expect(classifyPath('/og?title=Hello')).toBe('image')
    })
  })

  describe('xml variant', () => {
    it.each([
      '/sitemap.xml',
      '/sitemap-products.xml',
      '/sitemap-collections.xml',
      '/sitemap-pages.xml',
    ])('classifies %s as xml', (path) => {
      expect(classifyPath(path)).toBe('xml')
    })
  })

  describe('text variant', () => {
    it('classifies /robots.txt as text', () => {
      expect(classifyPath('/robots.txt')).toBe('text')
    })
  })

  describe('json variant', () => {
    it.each([
      '/api/search',
      '/api/orders/123/grants',
      '/api/some-other-thing',
    ])('classifies %s as json', (path) => {
      expect(classifyPath(path)).toBe('json')
    })
  })

  describe('binary variant', () => {
    it('classifies /api/files/1/download as binary', () => {
      expect(classifyPath('/api/files/1/download')).toBe('binary')
    })

    it('classifies /api/files/abc/stream as json (returns JSON, not a 302)', () => {
      expect(classifyPath('/api/files/abc/stream')).toBe('json')
    })

    it('classifies nested IDs as binary', () => {
      expect(classifyPath('/api/files/uuid-with-dashes-12345/download')).toBe(
        'binary',
      )
    })
  })

  describe('webhook variant', () => {
    it('classifies /api/webhooks/stripe as webhook', () => {
      expect(classifyPath('/api/webhooks/stripe')).toBe('webhook')
    })

    it('classifies /api/webhooks/paypal as webhook', () => {
      expect(classifyPath('/api/webhooks/paypal')).toBe('webhook')
    })

    it('classifies /api/webhooks/bunny as webhook', () => {
      expect(classifyPath('/api/webhooks/bunny')).toBe('webhook')
    })
  })

  describe('health variant', () => {
    it('classifies /healthz as health', () => {
      expect(classifyPath('/healthz')).toBe('health')
    })

    it('classifies /api/health as health', () => {
      expect(classifyPath('/api/health')).toBe('health')
    })
  })

  describe('order of checks (specificity)', () => {
    it('health wins over api/*', () => {
      expect(classifyPath('/api/health')).toBe('health')
      expect(classifyPath('/healthz')).toBe('health')
    })

    it('webhook wins over api/* json default', () => {
      expect(classifyPath('/api/webhooks/stripe')).toBe('webhook')
    })

    it('binary file download wins over api/* json default', () => {
      expect(classifyPath('/api/files/1/download')).toBe('binary')
    })

    it('file stream is json (returns { url, expires_at }, keeps HSTS + X-Frame-Options)', () => {
      expect(classifyPath('/api/files/1/stream')).toBe('json')
    })

    it('og wins over html default', () => {
      expect(classifyPath('/og')).toBe('image')
    })

    it('sitemap wins over html default', () => {
      expect(classifyPath('/sitemap.xml')).toBe('xml')
    })

    it('robots wins over html default', () => {
      expect(classifyPath('/robots.txt')).toBe('text')
    })
  })
})

describe('getSecurityHeaders', () => {
  describe('html variant', () => {
    it('returns all 10 headers (3 universal + 7 page-extra)', () => {
      const headers = getSecurityHeaders('/')
      expect(Object.keys(headers)).toHaveLength(10)
      expect(headers['X-Content-Type-Options']).toBe('nosniff')
      expect(headers['X-DNS-Prefetch-Control']).toBe('off')
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
      expect(headers['Content-Security-Policy']).toBe(CSP_VALUE)
      expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
      expect(headers['X-Frame-Options']).toBe('DENY')
      expect(headers['Permissions-Policy']).toBe(PERMISSIONS_POLICY_VALUE)
      expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin')
      expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin')
      expect(headers['Origin-Agent-Cluster']).toBe('?1')
    })

    it('works for nested routes', () => {
      const headers = getSecurityHeaders('/account/orders/123')
      expect(headers['Content-Security-Policy']).toBe(CSP_VALUE)
      expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
    })

    it('works for /auth/callback (server-rendered redirect target)', () => {
      const headers = getSecurityHeaders('/auth/callback')
      expect(headers['Content-Security-Policy']).toBe(CSP_VALUE)
      expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
    })
  })

  describe('image variant', () => {
    it('returns 5 headers (3 universal + HSTS + X-Frame-Options)', () => {
      const headers = getSecurityHeaders('/og')
      expect(Object.keys(headers)).toHaveLength(5)
      expect(headers['X-Content-Type-Options']).toBe('nosniff')
      expect(headers['X-DNS-Prefetch-Control']).toBe('off')
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
      expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
      expect(headers['X-Frame-Options']).toBe('DENY')
    })

    it('does NOT include CSP', () => {
      expect(getSecurityHeaders('/og')).not.toHaveProperty('Content-Security-Policy')
    })

    it('does NOT include Permissions-Policy', () => {
      expect(getSecurityHeaders('/og')).not.toHaveProperty('Permissions-Policy')
    })

    it('does NOT include COOP / CORP', () => {
      const headers = getSecurityHeaders('/og')
      expect(headers).not.toHaveProperty('Cross-Origin-Opener-Policy')
      expect(headers).not.toHaveProperty('Cross-Origin-Resource-Policy')
    })
  })

  describe('xml variant', () => {
    it.each(['/sitemap.xml', '/sitemap-products.xml', '/sitemap-collections.xml', '/sitemap-pages.xml'])(
      'returns the same 5 headers for %s',
      (path) => {
        const headers = getSecurityHeaders(path)
        expect(Object.keys(headers)).toHaveLength(5)
        expect(headers).not.toHaveProperty('Content-Security-Policy')
        expect(headers).not.toHaveProperty('Permissions-Policy')
        expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
        expect(headers['X-Frame-Options']).toBe('DENY')
      },
    )
  })

  describe('text variant', () => {
    it('returns the same 5 headers for /robots.txt', () => {
      const headers = getSecurityHeaders('/robots.txt')
      expect(Object.keys(headers)).toHaveLength(5)
      expect(headers).not.toHaveProperty('Content-Security-Policy')
      expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
      expect(headers['X-Frame-Options']).toBe('DENY')
    })
  })

  describe('json variant', () => {
    it('returns 5 headers (universal + HSTS + X-Frame-Options, no CSP)', () => {
      const headers = getSecurityHeaders('/api/search')
      expect(Object.keys(headers)).toHaveLength(5)
      expect(headers['X-Content-Type-Options']).toBe('nosniff')
      expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
      expect(headers['X-Frame-Options']).toBe('DENY')
      expect(headers).not.toHaveProperty('Content-Security-Policy')
      expect(headers).not.toHaveProperty('Permissions-Policy')
    })

    it('works for /api/orders/[id]/grants', () => {
      const headers = getSecurityHeaders('/api/orders/123/grants')
      expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
      expect(headers).not.toHaveProperty('Content-Security-Policy')
    })

    it('file /stream is json (keeps HSTS + X-Frame-Options — it returns JSON, not a 302)', () => {
      const headers = getSecurityHeaders('/api/files/1/stream')
      expect(Object.keys(headers)).toHaveLength(5)
      expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
      expect(headers['X-Frame-Options']).toBe('DENY')
      expect(headers).not.toHaveProperty('Content-Security-Policy')
    })
  })

  describe('binary variant', () => {
    it('returns only 3 universal headers for download', () => {
      const headers = getSecurityHeaders('/api/files/1/download')
      expect(Object.keys(headers)).toHaveLength(3)
      expect(headers['X-Content-Type-Options']).toBe('nosniff')
      expect(headers['X-DNS-Prefetch-Control']).toBe('off')
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    })

    it('does NOT include CSP / HSTS / X-Frame-Options / Permissions-Policy', () => {
      const headers = getSecurityHeaders('/api/files/1/download')
      expect(headers).not.toHaveProperty('Content-Security-Policy')
      expect(headers).not.toHaveProperty('Strict-Transport-Security')
      expect(headers).not.toHaveProperty('X-Frame-Options')
      expect(headers).not.toHaveProperty('Permissions-Policy')
      expect(headers).not.toHaveProperty('Cross-Origin-Opener-Policy')
      expect(headers).not.toHaveProperty('Cross-Origin-Resource-Policy')
    })
  })

  describe('webhook variant', () => {
    it('returns only 3 universal headers for Stripe webhook', () => {
      const headers = getSecurityHeaders('/api/webhooks/stripe')
      expect(Object.keys(headers)).toHaveLength(3)
    })

    it('does NOT include HSTS / X-Frame-Options / CSP', () => {
      const headers = getSecurityHeaders('/api/webhooks/stripe')
      expect(headers).not.toHaveProperty('Strict-Transport-Security')
      expect(headers).not.toHaveProperty('X-Frame-Options')
      expect(headers).not.toHaveProperty('Content-Security-Policy')
    })
  })

  describe('health variant', () => {
    it('returns only 3 universal headers for /healthz', () => {
      const headers = getSecurityHeaders('/healthz')
      expect(Object.keys(headers)).toHaveLength(3)
    })

    it('returns only 3 universal headers for /api/health', () => {
      const headers = getSecurityHeaders('/api/health')
      expect(Object.keys(headers)).toHaveLength(3)
    })
  })

  describe('explicit variant override', () => {
    it('bypasses the classifier for an explicit variant', () => {
      const headers = getSecurityHeaders('/whatever', { variant: 'json' })
      expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
      expect(headers).not.toHaveProperty('Content-Security-Policy')
    })

    it('falls back to html when pathname would be html but variant is set to image', () => {
      const headers = getSecurityHeaders('/account/profile', { variant: 'image' })
      expect(headers['Strict-Transport-Security']).toBe(HSTS_VALUE)
      expect(headers['X-Frame-Options']).toBe('DENY')
      expect(headers).not.toHaveProperty('Content-Security-Policy')
    })
  })

  describe('CSP value integrity', () => {
    it('the HTML-page CSP contains no whitespace issues', () => {
      const headers = getSecurityHeaders('/')
      const csp = headers['Content-Security-Policy']!
      // No double spaces, no trailing whitespace.
      expect(csp).not.toMatch(/\s\s/)
      expect(csp).not.toMatch(/\s$/)
    })
  })
})

describe('applySecurityHeaders', () => {
  it('calls headers.set for every entry', () => {
    const setCalls: Array<[string, string]> = []
    const fakeResponse = {
      headers: {
        set: (key: string, value: string) => {
          setCalls.push([key, value])
        },
      },
    }
    applySecurityHeaders(fakeResponse, '/')
    expect(setCalls).toHaveLength(10)
    expect(setCalls).toContainEqual(['X-Content-Type-Options', 'nosniff'])
    expect(setCalls).toContainEqual(['Content-Security-Policy', CSP_VALUE])
    expect(setCalls).toContainEqual(['Strict-Transport-Security', HSTS_VALUE])
  })

  it('uses the explicit variant when provided', () => {
    const setCalls: Array<[string, string]> = []
    const fakeResponse = {
      headers: {
        set: (key: string, value: string) => {
          setCalls.push([key, value])
        },
      },
    }
    applySecurityHeaders(fakeResponse, '/account', { variant: 'binary' })
    // binary variant = 3 universal headers, no HSTS.
    expect(setCalls).toHaveLength(3)
    expect(setCalls.find(([k]) => k === 'Strict-Transport-Security')).toBeUndefined()
  })

  it('returns void (side-effect only)', () => {
    const fakeResponse = { headers: { set: () => undefined } }
    const result = applySecurityHeaders(fakeResponse, '/')
    expect(result).toBeUndefined()
  })
})