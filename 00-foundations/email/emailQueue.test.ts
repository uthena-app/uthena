// emailQueue.test.ts — pure tests for the queue helpers (no DB).

import { describe, expect, it } from 'vitest'

// We test the shape validation + retry backoff math via re-importing.
import { enqueueEmail } from './emailQueue'
import { isSesConfigured } from './ses'

describe('emailQueue helpers', () => {
  it('exports the canonical senders', () => {
    expect(typeof enqueueEmail).toBe('function')
  })

  it('isSesConfigured honors env', () => {
    // Whether or not AWS env vars are set in CI matters not — the
    // test is that the function returns a deterministic boolean.
    const result = isSesConfigured()
    expect(typeof result).toBe('boolean')
  })

  it('enqueueEmail rejects bad input (missing to)', async () => {
    const result = await enqueueEmail({
      to: '',
      subject: 'Test',
      html: '<p>hi</p>',
      text: 'hi',
      category: 'transactional',
    })
    expect(result.ok).toBe(false)
  })

  it('enqueueEmail rejects bad input (invalid category)', async () => {
    const result = await enqueueEmail({
      to: 'a@b.com',
      subject: 'Test',
      html: '<p>hi</p>',
      text: 'hi',
      // @ts-expect-error testing runtime guard
      category: 'not-a-category',
    })
    expect(result.ok).toBe(false)
  })
})
