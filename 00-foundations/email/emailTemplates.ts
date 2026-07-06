// emailTemplates.ts — transactional email templates (P17.5+).
//
// Each template renders the same content as HTML + plain text.
// No template engine — pure TS string templates. v1 has no design
// surface; the look is intentionally minimal so the templates are
// accessible + easy to review.
//
// All templates take a `ContactAddress` so the unsubscribe footer
// (P17.4) is in one place.

export type ContactAddress = {
  email: string
  companyName: string
  physicalAddress: string
}

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

const wrapHtml = (body: string, contact: ContactAddress, unsubscribeUrl?: string) => {
  const unsubFooter = unsubscribeUrl
    ? `<p style="margin-top:32px;font-size:12px;color:#6b7280;text-align:center">
        You can <a href="${unsubscribeUrl}" style="color:#2563eb">update your email preferences</a> any time.
       </p>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<title></title>
</head><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#0e1012;max-width:560px;margin:0 auto;padding:24px;background:#fff">
${body}
<hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb" />
<p style="font-size:12px;color:#6b7280">
  ${contact.companyName}<br />
  ${contact.physicalAddress}
</p>
${unsubFooter}
</body></html>`
}

const wrapText = (body: string, contact: ContactAddress, unsubscribeUrl?: string) => {
  const unsubFooter = unsubscribeUrl
    ? `\n\n--\nUpdate your preferences: ${unsubscribeUrl}\n`
    : ''
  return `${body}\n\n--\n${contact.companyName}\n${contact.physicalAddress}${unsubFooter}`
}

const defaultContact: ContactAddress = {
  email: 'support@uthena.com',
  companyName: 'Uthena',
  physicalAddress: 'PLR Wholesale, Inc.',
}

// ---- P17.5 Order confirmation + receipt ----
export function renderOrderConfirmation(input: {
  orderId: number
  displayName: string
  totalCents: number
  currency: string
  itemCount: number
  receiptUrl: string
  contact?: ContactAddress
}): RenderedEmail {
  const contact = input.contact ?? defaultContact
  const total = (input.totalCents / 100).toFixed(2)
  const subject = `Order #${input.orderId} confirmed — ${input.currency} ${total}`
  const html = wrapHtml(
    `<h1 style="font-size:20px;margin:0 0 16px">Order #${input.orderId} confirmed</h1>
<p>Hi ${input.displayName},</p>
<p>Thank you for your purchase. Your order for ${input.itemCount} ${input.itemCount === 1 ? 'item' : 'items'} totaling <strong>${input.currency} ${total}</strong> is confirmed.</p>
<p>You can access your library right now:</p>
<p style="margin:24px 0"><a href="${input.receiptUrl}" style="display:inline-block;background:#F3924A;color:#0e1012;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">View library</a></p>
<p>If you have any questions, just reply to this email.</p>`,
    contact,
  )
  const text = wrapText(
    `Order #${input.orderId} confirmed

Hi ${input.displayName},

Thank you for your purchase. Your order for ${input.itemCount} ${input.itemCount === 1 ? 'item' : 'items'} totaling ${input.currency} ${total} is confirmed.

View your library: ${input.receiptUrl}

If you have any questions, just reply to this email.`,
    contact,
  )
  return { subject, html, text }
}

// ---- P17.6 Refund confirmation ----
export function renderRefundConfirmation(input: {
  displayName: string
  orderId: number
  amountCents: number
  currency: string
  reason: string
  expectedDays: number
  contact?: ContactAddress
}): RenderedEmail {
  const contact = input.contact ?? defaultContact
  const amount = (input.amountCents / 100).toFixed(2)
  const subject = `Refund for order #${input.orderId} — ${input.currency} ${amount}`
  const html = wrapHtml(
    `<h1 style="font-size:20px;margin:0 0 16px">Refund confirmed</h1>
<p>Hi ${input.displayName},</p>
<p>We've processed a refund of <strong>${input.currency} ${amount}</strong> for order #${input.orderId} (${input.reason}).</p>
<p>Funds typically appear on your statement within <strong>${input.expectedDays}</strong> business days, depending on your card issuer.</p>`,
    contact,
  )
  const text = wrapText(
    `Refund confirmed

Hi ${input.displayName},

We've processed a refund of ${input.currency} ${amount} for order #${input.orderId} (${input.reason}).

Funds typically appear on your statement within ${input.expectedDays} business days, depending on your card issuer.`,
    contact,
  )
  return { subject, html, text }
}

// ---- P17.7 Payout sent (for partners) ----
export function renderPayoutSent(input: {
  displayName: string
  amountCents: number
  currency: string
  externalReference: string
  arrivedDays: number
  payoutHistoryUrl: string
  contact?: ContactAddress
}): RenderedEmail {
  const contact = input.contact ?? defaultContact
  const amount = (input.amountCents / 100).toFixed(2)
  const subject = `Payout sent — ${input.currency} ${amount}`
  const html = wrapHtml(
    `<h1 style="font-size:20px;margin:0 0 16px">Payout sent</h1>
<p>Hi ${input.displayName},</p>
<p>Your payout of <strong>${input.currency} ${amount}</strong> has been sent. Reference: <code>${input.externalReference}</code>.</p>
<p>Funds typically arrive within <strong>${input.arrivedDays}</strong> business days.</p>
<p><a href="${input.payoutHistoryUrl}">View payout history</a></p>`,
    contact,
  )
  const text = wrapText(
    `Payout sent

Hi ${input.displayName},

Your payout of ${input.currency} ${amount} has been sent. Reference: ${input.externalReference}.

Funds typically arrive within ${input.arrivedDays} business days.

View payout history: ${input.payoutHistoryUrl}`,
    contact,
  )
  return { subject, html, text }
}

// ---- P17.8 Email verification ----
export function renderEmailVerification(input: {
  displayName: string
  verifyUrl: string
  contact?: ContactAddress
}): RenderedEmail {
  const contact = input.contact ?? defaultContact
  const subject = 'Verify your email — Uthena'
  const html = wrapHtml(
    `<h1 style="font-size:20px;margin:0 0 16px">Verify your email</h1>
<p>Hi ${input.displayName},</p>
<p>Click the button below to verify your email address:</p>
<p style="margin:24px 0"><a href="${input.verifyUrl}" style="display:inline-block;background:#F3924A;color:#0e1012;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Verify email</a></p>
<p>This link expires in 24 hours.</p>`,
    contact,
  )
  const text = wrapText(
    `Verify your email

Hi ${input.displayName},

Open this link to verify your email: ${input.verifyUrl}

This link expires in 24 hours.`,
    contact,
  )
  return { subject, html, text }
}

// ---- P17.9 Password reset ----
export function renderPasswordReset(input: {
  resetUrl: string
  contact?: ContactAddress
}): RenderedEmail {
  const contact = input.contact ?? defaultContact
  const subject = 'Reset your Uthena password'
  const html = wrapHtml(
    `<h1 style="font-size:20px;margin:0 0 16px">Reset your password</h1>
<p>Click the button below to set a new password:</p>
<p style="margin:24px 0"><a href="${input.resetUrl}" style="display:inline-block;background:#F3924A;color:#0e1012;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Set new password</a></p>
<p>This link expires in 1 hour. If you didn't request a password reset, ignore this email.</p>`,
    contact,
  )
  const text = wrapText(
    `Reset your password

Open this link to set a new password: ${input.resetUrl}

This link expires in 1 hour. If you didn't request a password reset, ignore this email.`,
    contact,
  )
  return { subject, html, text }
}

// ---- P17.10 Review submitted ----
export function renderReviewSubmitted(input: {
  displayName: string
  productTitle: string
  productUrl: string
  reviewId: number
  contact?: ContactAddress
}): RenderedEmail {
  const contact = input.contact ?? defaultContact
  const subject = `Review submitted for ${input.productTitle}`
  const html = wrapHtml(
    `<h1 style="font-size:20px;margin:0 0 16px">Review submitted</h1>
<p>Hi ${input.displayName},</p>
<p>Thanks for your review of <strong>${input.productTitle}</strong>. It will appear publicly once our team has verified it.</p>
<p><a href="${input.productUrl}">View product</a></p>`,
    contact,
  )
  const text = wrapText(
    `Review submitted

Hi ${input.displayName},

Thanks for your review of ${input.productTitle}. It will appear publicly once our team has verified it.

View product: ${input.productUrl}`,
    contact,
  )
  return { subject, html, text }
}

// ---- P17.11 Partner: new sale ----
export function renderPartnerNewSale(input: {
  displayName: string
  productTitle: string
  grossCents: number
  royaltyCents: number
  currency: string
  dashboardUrl: string
  contact?: ContactAddress
}): RenderedEmail {
  const contact = input.contact ?? defaultContact
  const gross = (input.grossCents / 100).toFixed(2)
  const royalty = (input.royaltyCents / 100).toFixed(2)
  const subject = `New sale: ${input.currency} ${gross} on ${input.productTitle}`
  const html = wrapHtml(
    `<h1 style="font-size:20px;margin:0 0 16px">New sale on ${input.productTitle}</h1>
<p>Hi ${input.displayName},</p>
<p>You just earned <strong>${input.currency} ${royalty}</strong> on a new sale (gross: ${input.currency} ${gross}).</p>
<p><a href="${input.dashboardUrl}">View dashboard</a></p>`,
    contact,
  )
  const text = wrapText(
    `New sale on ${input.productTitle}

Hi ${input.displayName},

You just earned ${input.currency} ${royalty} on a new sale (gross: ${input.currency} ${gross}).

View dashboard: ${input.dashboardUrl}`,
    contact,
  )
  return { subject, html, text }
}
