// parseCheckoutStep tests — pure helper, no I/O. The parser is the
// single source of truth for "what step did the user mean?" — every
// wizard navigation passes through it.

import { describe, expect, it } from 'vitest'
import { CHECKOUT_STEPS, checkoutStepHref, parseCheckoutStep } from './parseCheckoutStep'

describe('parseCheckoutStep', () => {
  it('falls back to "email" when the input is missing', () => {
    const result = parseCheckoutStep(undefined)
    expect(result).toEqual({ id: 'email', index: 0, fallback: true })
    const resultEmpty = parseCheckoutStep('')
    expect(resultEmpty.fallback).toBe(true)
    expect(resultEmpty.id).toBe('email')
  })

  it('falls back to "email" when the input is an array (multi-param)', () => {
    const result = parseCheckoutStep(['review'])
    expect(result).toEqual({ id: 'review', index: 1, fallback: false })
    const resultEmpty = parseCheckoutStep([])
    expect(resultEmpty.fallback).toBe(true)
    expect(resultEmpty.id).toBe('email')
  })

  it('normalizes a known step id (case-insensitive)', () => {
    expect(parseCheckoutStep('REVIEW').id).toBe('review')
    expect(parseCheckoutStep('Email').id).toBe('email')
    expect(parseCheckoutStep('payment').id).toBe('payment')
  })

  it('falls back to "email" for an unknown step id', () => {
    const result = parseCheckoutStep('thank-you')
    expect(result.fallback).toBe(true)
    expect(result.id).toBe('email')
  })

  it('falls back to "email" for SQLi-style or CRLF attempts', () => {
    // Defense in depth — the page already URL-encodes everything, but
    // if a query string sneaks in raw characters the parser must not
    // throw or accept them.
    expect(parseCheckoutStep("email' OR 1=1--").id).toBe('email')
    expect(parseCheckoutStep('email\r\nLocation: evil').fallback).toBe(true)
    expect(parseCheckoutStep('email%20injection').id).toBe('email') // raw %, not a known id
  })

  it('returns the correct index for each canonical step', () => {
    CHECKOUT_STEPS.forEach((id, idx) => {
      expect(parseCheckoutStep(id).index).toBe(idx)
    })
  })

  it('always returns a canonical id from CHECKOUT_STEPS', () => {
    const inputs: Array<string | string[] | undefined> = [
      undefined,
      '',
      'junk',
      ['email'],
      ['PAYMENT'],
      'confirmation',
    ]
    for (const input of inputs) {
      const result = parseCheckoutStep(input)
      expect(CHECKOUT_STEPS).toContain(result.id)
    }
  })
})

describe('checkoutStepHref', () => {
  it('encodes the step id into a /checkout?step= URL', () => {
    expect(checkoutStepHref('review')).toBe('/checkout?step=review')
    expect(checkoutStepHref('email')).toBe('/checkout?step=email')
    expect(checkoutStepHref('confirmation')).toBe('/checkout?step=confirmation')
  })

  it('round-trips through parseCheckoutStep for every canonical id', () => {
    CHECKOUT_STEPS.forEach((id) => {
      const href = checkoutStepHref(id)
      const param = href.split('?step=')[1]
      expect(parseCheckoutStep(param).id).toBe(id)
    })
  })
})