// emailTemplates.test.ts — pure tests for the template renderers.

import { describe, expect, it } from 'vitest'
import {
  renderOrderConfirmation,
  renderRefundConfirmation,
  renderPayoutSent,
  renderEmailVerification,
  renderPasswordReset,
  renderReviewSubmitted,
  renderPartnerNewSale,
} from './emailTemplates'

describe('emailTemplates renderers', () => {
  it('renderOrderConfirmation includes the order id + a view library CTA', () => {
    const out = renderOrderConfirmation({
      orderId: 12345,
      displayName: 'Pat',
      totalCents: 19900,
      currency: 'USD',
      itemCount: 3,
      receiptUrl: 'https://uthena.com/library?ok=1',
    })
    expect(out.subject).toContain('12345')
    expect(out.subject).toContain('199.00')
    expect(out.html).toContain('https://uthena.com/library?ok=1')
    expect(out.text).toContain('Hi Pat')
  })

  it('renderRefundConfirmation surfaces the amount + days', () => {
    const out = renderRefundConfirmation({
      displayName: 'Sam',
      orderId: 999,
      amountCents: 1999,
      currency: 'USD',
      reason: 'duplicate',
      expectedDays: 5,
    })
    expect(out.subject).toContain('999')
    expect(out.subject).toContain('19.99')
    expect(out.html).toContain('duplicate')
    expect(out.html).toContain('5')
  })

  it('renderPayoutSent surfaces the partner-friendly refs', () => {
    const out = renderPayoutSent({
      displayName: 'Lee',
      amountCents: 123456,
      currency: 'USD',
      externalReference: 'BATCH-987',
      arrivedDays: 3,
      payoutHistoryUrl: 'https://uthena.com/partner/payouts',
    })
    expect(out.subject).toContain('1234.56')
    expect(out.html).toContain('BATCH-987')
  })

  it('renderEmailVerification includes the verify URL', () => {
    const out = renderEmailVerification({
      displayName: 'K',
      verifyUrl: 'https://uthena.com/auth/callback?token=abc',
    })
    expect(out.subject).toContain('Verify')
    expect(out.html).toContain('?token=abc')
  })

  it('renderPasswordReset includes the reset URL', () => {
    const out = renderPasswordReset({
      resetUrl: 'https://uthena.com/reset-password?token=xyz',
    })
    expect(out.subject.toLowerCase()).toContain('reset')
    expect(out.html).toContain('reset-password?token=xyz')
  })

  it('renderReviewSubmitted surfaces the product title', () => {
    const out = renderReviewSubmitted({
      displayName: 'Mac',
      productTitle: 'Cold Email Playbook',
      productUrl: 'https://uthena.com/products/cold-email-playbook',
      reviewId: 42,
    })
    expect(out.subject).toContain('Cold Email Playbook')
    expect(out.html).toContain('/products/cold-email-playbook')
  })

  it('renderPartnerNewSale surfaces both gross + royalty', () => {
    const out = renderPartnerNewSale({
      displayName: 'Nic',
      productTitle: 'AI for Entrepreneurs',
      grossCents: 19900,
      royaltyCents: 7960,
      currency: 'USD',
      dashboardUrl: 'https://uthena.com/partner',
    })
    expect(out.subject).toContain('AI for Entrepreneurs')
    expect(out.html).toContain('79.60')
    expect(out.html).toContain('199.00')
  })
})
