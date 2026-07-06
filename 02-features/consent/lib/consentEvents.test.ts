// consentEvents.test.ts — unit tests for the consent-changed helper.
// Mirrors the search-events test pattern (no DOM — pure function
// coverage + the no-window server-side no-op contract).

import { describe, expect, it } from 'vitest'
import { dispatchConsentChanged, CONSENT_CHANGED_EVENT } from './consentEvents'

describe('consentEvents', () => {
  it('CONSENT_CHANGED_EVENT is the namespaced string', () => {
    expect(CONSENT_CHANGED_EVENT).toBe('uthena:consent:changed')
  })

  it('dispatchConsentChanged is a function', () => {
    expect(typeof dispatchConsentChanged).toBe('function')
  })

  it('dispatchConsentChanged is a server-side no-op (no window throws)', () => {
    // vitest runs in `node` env; the helper must short-circuit when
    // window is undefined so it's importable from universal modules.
    // If we didn't guard, the dispatch would throw a ReferenceError
    // here — the fact this returns without error is the test.
    expect(() =>
      dispatchConsentChanged({ essential: true, analytics: true, marketing: true }),
    ).not.toThrow()
  })
})
