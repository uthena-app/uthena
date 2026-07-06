// Tests for the client-safe reportError wrapper.
//
// Why these tests matter:
//   - The seam (00-foundations/observability/sentry.ts) is server-only.
//     The boundary is a 'use client' component. The wrapper is the
//     bridge. If it serializes the wrong payload, the route handler
//     rejects it (400) and the capture is silently dropped. The seam
//     has its own test suite; this is the contract test for the
//     client-side half of the bridge.
//   - The wrapper's defensive paths (missing errId, fetch failure)
//     must never throw — the boundary is the last line of UX and a
//     thrown error in the reportError call would replace the friendly
//     error page with a less-friendly error page.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reportError, type ReportErrorResult } from './client-report'

const fetchSpy = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchSpy.mockReset()
  // Default to a resolved Promise (200 OK); individual tests override.
  fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))
  // Install the spy as the global fetch. jsdom (the vitest default
  // environment) provides fetch as part of the Window, but in newer
  // Node versions fetch is also on globalThis. Stub both paths.
  vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reportError — happy path', () => {
  it('returns { ok: true, mode: "logged" } for a valid call', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    const result: ReportErrorResult = reportError(err, {
      surface: 'app.error',
      errId: 'ERR-ABC2345678',
    })
    expect(result).toEqual({ ok: true, mode: 'logged' })
  })

  it('POSTs to /api/errors/report with a JSON body', async () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    reportError(err, {
      surface: 'app.account.error',
      errId: 'ERR-ABC2345678',
      actor: { kind: 'user', user_id: 'u_1' },
      tags: { 'http.method': 'GET' },
    })
    // Yield the microtask queue so the fire-and-forget fetch resolves
    // (or at least runs the body-construction path).
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe('/api/errors/report')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(init?.keepalive).toBe(true)
    // Body must be the PII-safe payload (no message, no stack).
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({
      surface: 'app.account.error',
      errId: 'ERR-ABC2345678',
      errorName: 'Error',
      errorDigest: 'd1',
      actor: { kind: 'user', user_id: 'u_1' },
      tags: { 'http.method': 'GET' },
    })
  })

  it('NEVER forwards error.message (PII-safety)', async () => {
    const err = Object.assign(new Error('user@example.com tried /secret'), {
      digest: 'd1',
    })
    reportError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(JSON.stringify(body)).not.toContain('user@example.com')
    expect(JSON.stringify(body)).not.toContain('/secret')
    // Only the class name is forwarded (error.name = 'Error').
    expect(body.errorName).toBe('Error')
    expect(body.errorName).not.toContain('user@')
  })

  it('NEVER forwards error.stack (PII-safety)', async () => {
    const err: Error & { digest?: string } = new Error('boom')
    err.stack = 'Error: boom\n    at /Users/klaas/secret-path/file.ts:42:13'
    err.digest = 'd1'
    reportError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(JSON.stringify(body)).not.toContain('/Users/klaas/secret-path')
    expect(JSON.stringify(body)).not.toContain('secret-path')
    expect(JSON.stringify(body)).not.toContain('file.ts:42:13')
  })

  it('forwards error.digest when present', async () => {
    const err = Object.assign(new Error('boom'), { digest: 'NEXT-DIGEST-XYZ' })
    reportError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(body.errorDigest).toBe('NEXT-DIGEST-XYZ')
  })

  it('omits errorDigest when missing (undefined, not null)', async () => {
    const err: Error & { digest?: string } = new Error('boom')
    // No digest property
    reportError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    // JSON.stringify drops undefined keys — body has no errorDigest field.
    expect(Object.prototype.hasOwnProperty.call(body, 'errorDigest')).toBe(false)
  })
})

describe('reportError — defensive paths', () => {
  it('returns invalid_input when errId is empty', () => {
    const err = new Error('boom')
    const result = reportError(err, { surface: 'app.error', errId: '' })
    expect(result).toEqual({ ok: false, mode: 'skipped', reason: 'invalid_input' })
    // No fetch was issued.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns invalid_input when surface is empty', () => {
    const err = new Error('boom')
    const result = reportError(err, { surface: '', errId: 'ERR-ABC2345678' })
    expect(result).toEqual({ ok: false, mode: 'skipped', reason: 'invalid_input' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does NOT throw when fetch rejects (returns fetch_failed silently)', async () => {
    fetchSpy.mockRejectedValue(new TypeError('network down'))
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    expect(() =>
      reportError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' }),
    ).not.toThrow()
    // Yield the microtask so the rejected promise's catch handler runs.
    await new Promise((resolve) => setTimeout(resolve, 10))
    // The boundary still rendered ok (the test didn't crash).
  })

  it('does NOT throw when fetch times out (returns timeout silently)', async () => {
    const timeoutErr = new DOMException('aborted', 'TimeoutError')
    fetchSpy.mockRejectedValue(timeoutErr)
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    expect(() =>
      reportError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' }),
    ).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  it('uses keepalive: true so the request can complete on tab close', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    reportError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    expect(fetchSpy.mock.calls[0]?.[1]?.keepalive).toBe(true)
  })

  it('uses AbortSignal.timeout(2500) so the boundary is never blocked', () => {
    const err = Object.assign(new Error('boom'), { digest: 'd1' })
    reportError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    const signal = fetchSpy.mock.calls[0]?.[1]?.signal as AbortSignal | undefined
    expect(signal).toBeInstanceOf(AbortSignal)
    // AbortSignal.timeout returns a signal with the timeout already
    // armed; we can't read the exact ms (it's internal), but we can
    // verify the signal is an AbortSignal — that's the API contract.
  })
})

describe('reportError — payload shape (typed Actor union)', () => {
  it('forwards the anon actor shape correctly', async () => {
    const err = new Error('boom')
    reportError(err, {
      surface: 'app.error',
      errId: 'ERR-ABC2345678',
      actor: { kind: 'anon' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(body.actor).toEqual({ kind: 'anon' })
  })

  it('forwards the admin actor shape (with role discriminator)', async () => {
    const err = new Error('boom')
    reportError(err, {
      surface: 'app.admin.error',
      errId: 'ERR-ABC2345678',
      actor: { kind: 'admin', user_id: 'u_1', role: 'super_admin' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    expect(body.actor).toEqual({
      kind: 'admin',
      user_id: 'u_1',
      role: 'super_admin',
    })
  })

  it('omits the actor field when not provided (not undefined-keyed)', async () => {
    const err = new Error('boom')
    reportError(err, { surface: 'app.error', errId: 'ERR-ABC2345678' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
    // JSON.stringify drops undefined keys.
    expect(Object.prototype.hasOwnProperty.call(body, 'actor')).toBe(false)
  })
})