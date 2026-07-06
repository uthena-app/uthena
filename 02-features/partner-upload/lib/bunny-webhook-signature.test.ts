// bunny-webhook-signature.test.ts — unit tests for the pure HMAC
// verify path (P12.8 Slice 1).

import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  BUNNY_WEBHOOK_SIGNATURE_HEADER_NAMES,
  normalizeBunnySignature,
  readBunnySignature,
  verifyBunnyWebhookSignature,
} from './bunny-webhook-signature'

const SECRET = 'whsec_test_topsecret_value'

/** Helper to compute the canonical signature for a body + secret. */
function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

function makeHeaders(map: Record<string, string>): Headers {
  // Polyfill Headers via the Web API. Vitest runs in Node 20 — use
  // the built-in Headers.
  return new Headers(Object.entries(map))
}

describe('BUNNY_WEBHOOK_SIGNATURE_HEADER_NAMES', () => {
  it('includes both Bunny header shapes', () => {
    expect(BUNNY_WEBHOOK_SIGNATURE_HEADER_NAMES).toContain('Signature')
    expect(BUNNY_WEBHOOK_SIGNATURE_HEADER_NAMES).toContain('X-Bunny-Signature')
  })
})

describe('readBunnySignature', () => {
  it('returns the Signature header value when present', () => {
    const h = makeHeaders({ Signature: 'abc' })
    expect(readBunnySignature(h)).toBe('abc')
  })
  it('returns the X-Bunny-Signature header when Signature is absent', () => {
    const h = makeHeaders({ 'X-Bunny-Signature': 'def' })
    expect(readBunnySignature(h)).toBe('def')
  })
  it('trims whitespace around the value', () => {
    const h = makeHeaders({ Signature: '   abc  ' })
    expect(readBunnySignature(h)).toBe('abc')
  })
  it('returns null when neither header is present', () => {
    expect(readBunnySignature(makeHeaders({}))).toBeNull()
  })
  it('prefers Signature over X-Bunny-Signature when both present', () => {
    const h = makeHeaders({ Signature: 'first', 'X-Bunny-Signature': 'second' })
    expect(readBunnySignature(h)).toBe('first')
  })
})

describe('normalizeBunnySignature', () => {
  it('passes bare hex through unchanged (lowercase)', () => {
    const hex = 'a'.repeat(64)
    expect(normalizeBunnySignature(hex)).toBe(hex)
  })
  it('uppercases are normalized to lowercase', () => {
    const upper = 'A'.repeat(64)
    expect(normalizeBunnySignature(upper)).toBe('a'.repeat(64))
  })
  it('strips the sha256= prefix', () => {
    const hex = 'b'.repeat(64)
    expect(normalizeBunnySignature(`sha256=${hex}`)).toBe(hex)
  })
  it('rejects short hex (<64 chars)', () => {
    expect(normalizeBunnySignature('a'.repeat(63))).toBeNull()
  })
  it('rejects long hex (>64 chars)', () => {
    expect(normalizeBunnySignature('a'.repeat(65))).toBeNull()
  })
  it('rejects non-hex characters', () => {
    expect(normalizeBunnySignature('z'.repeat(64))).toBeNull() // not hex
    expect(normalizeBunnySignature('a'.repeat(63) + '!')).toBeNull()
  })
  it('trims whitespace before validating', () => {
    const hex = 'c'.repeat(64)
    expect(normalizeBunnySignature(`  ${hex}  `)).toBe(hex)
  })
})

describe('verifyBunnyWebhookSignature — happy path', () => {
  it('verifies a body signed with the candidate secret', () => {
    const body = JSON.stringify({ EventName: 'FileScanCompleted' })
    const sig = sign(body, SECRET)
    const res = verifyBunnyWebhookSignature({
      rawBody: body,
      signature: sig,
      secrets: [SECRET],
    })
    expect(res).toEqual({ ok: true, reason: 'verified' })
  })
  it('accepts Stripe-style sha256= prefix', () => {
    const body = JSON.stringify({ ok: true })
    const sig = sign(body, SECRET)
    const res = verifyBunnyWebhookSignature({
      rawBody: body,
      signature: `sha256=${sig}`,
      secrets: [SECRET],
    })
    expect(res.ok).toBe(true)
  })
  it('verifies when the secret is one of multiple candidates (rotation window)', () => {
    const body = 'abcdef'
    const sig = sign(body, SECRET)
    const res = verifyBunnyWebhookSignature({
      rawBody: body,
      signature: sig,
      secrets: ['old_secret', SECRET, 'another_secret'],
    })
    expect(res.ok).toBe(true)
  })
  it('verifies regardless of body whitespace (the raw body is preserved)', () => {
    const body = 'hello'
    const sig = sign(body, SECRET)
    // Strict byte comparison — any change to the raw body invalidates.
    expect(
      verifyBunnyWebhookSignature({
        rawBody: 'hello',
        signature: sign('hellX', SECRET), // tampered
        secrets: [SECRET],
      }).ok,
    ).toBe(false)
    expect(
      verifyBunnyWebhookSignature({
        rawBody: 'hello',
        signature: sig,
        secrets: [SECRET],
      }).ok,
    ).toBe(true)
  })
})

describe('verifyBunnyWebhookSignature — failure cases', () => {
  it('returns missing_signature when signature is null', () => {
    const res = verifyBunnyWebhookSignature({
      rawBody: 'x',
      signature: null,
      secrets: [SECRET],
    })
    expect(res).toEqual({ ok: false, reason: 'missing_signature' })
  })
  it("returns malformed_signature when the signature isn't valid hex", () => {
    const res = verifyBunnyWebhookSignature({
      rawBody: 'x',
      signature: 'not-hex',
      secrets: [SECRET],
    })
    expect(res).toEqual({ ok: false, reason: 'malformed_signature' })
  })
  it('returns no_secret_configured when no candidates', () => {
    const body = 'x'
    const sig = sign(body, SECRET)
    const res = verifyBunnyWebhookSignature({
      rawBody: body,
      signature: sig,
      secrets: [],
    })
    expect(res).toEqual({ ok: false, reason: 'no_secret_configured' })
  })
  it('skips empty-string secrets in the candidate list', () => {
    const body = 'x'
    const sig = sign(body, SECRET)
    const res = verifyBunnyWebhookSignature({
      rawBody: body,
      signature: sig,
      secrets: ['', SECRET, ''],
    })
    expect(res.ok).toBe(true)
  })
  it('returns no_secret_match when the signature is correct hex but wrong key', () => {
    const body = 'x'
    const sig = sign(body, 'WRONG_KEY')
    const res = verifyBunnyWebhookSignature({
      rawBody: body,
      signature: sig,
      secrets: [SECRET],
    })
    expect(res).toEqual({ ok: false, reason: 'no_secret_match' })
  })
  it('returns no_secret_match when the body was tampered', () => {
    const sig = sign('original', SECRET)
    const res = verifyBunnyWebhookSignature({
      rawBody: 'tampered',
      signature: sig,
      secrets: [SECRET],
    })
    expect(res).toEqual({ ok: false, reason: 'no_secret_match' })
  })
})
