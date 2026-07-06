// route.test.ts — D14 [decided: strip] runnable check for GET /api/health.
//
// The route used to return a `features: { stripe, bunny, ses, sentry, ... }`
// boolean map to ANY anonymous caller — letting an outsider fingerprint
// which third-party integrations are configured on this deployment.
// D14 strips that object; this test locks in the stripped shape and
// confirms the route still behaves as a valid load-balancer probe
// (200 + JSON + no auth).

import { describe, expect, it } from 'vitest'

import { GET } from './route'

describe('GET /api/health — D14: no integration fingerprinting', () => {
  it('returns 200 with ok/app/env/version/time and NOTHING else', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.app).toBe('string')
    expect(typeof body.env).toBe('string')
    expect(typeof body.version).toBe('string')
    expect(typeof body.time).toBe('string')
    // The integration-fingerprinting surface must be gone.
    expect(body.features).toBeUndefined()
    expect(Object.keys(body).sort()).toEqual(['app', 'env', 'ok', 'time', 'version'])
  })

  it('never mentions stripe/bunny/ses/sentry/posthog/gorse anywhere in the body', async () => {
    const res = await GET()
    const raw = await res.text()
    for (const integration of ['stripe', 'bunny', 'ses', 'sentry', 'posthog', 'gorse']) {
      expect(raw.toLowerCase()).not.toContain(integration)
    }
  })

  it('time is a valid ISO-8601 timestamp', async () => {
    const res = await GET()
    const body = await res.json()
    expect(Number.isNaN(new Date(body.time).getTime())).toBe(false)
  })
})
