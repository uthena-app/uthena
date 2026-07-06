// getContactOptions.ts — the contact-page option list. The contact
// page renders this list as a series of cards. The mailto links are
// hard-coded (no server-side message routing in v1; the support inbox
// is a real address and the human owns it).
//
// This file is safe to import from client components: it has no
// server-only logic, no DB access, no secrets — just static config.
// (Both the contact page and the contact form need the same data.)

export type ContactOption = {
  /** Display label. */
  label: string
  /** Short, plain-English description of what this inbox is for. */
  description: string
  /** Mail recipient. */
  email: string
  /** Pre-filled subject — URL-encoded. */
  subject: string
  /** Expected response time, plain English. */
  responseTime: string
}

export const CONTACT_OPTIONS: ReadonlyArray<ContactOption> = [
  {
    label: 'Customer support',
    description: 'Order help, library access, refund questions, account issues.',
    email: 'support@uthena.com',
    subject: 'Support%20request',
    responseTime: 'Within 48 hours',
  },
  {
    label: 'General',
    description: 'Any other question, comment, or feedback about Uthena.',
    email: 'info@uthena.com',
    subject: 'General%20inquiry',
    responseTime: 'Within 48 hours',
  },
  {
    label: 'Privacy',
    description:
      'Data requests, GDPR / CCPA, opt-out, account export or deletion. The data controller can also be reached at the address below.',
    email: 'projects@dantwah.com',
    subject: 'Privacy%20request',
    responseTime: 'Within 5 business days',
  },
  {
    label: 'Legal',
    description: 'DMCA notices, counter-notices, terms questions, contracts.',
    email: 'legal@uthena.com',
    subject: 'Legal%20inquiry',
    responseTime: 'Within 3 business days',
  },
  {
    label: 'Affiliate program',
    description: 'Joining the affiliate program, commissions, promo questions.',
    email: 'affiliates@uthena.com',
    subject: 'Affiliate%20inquiry',
    responseTime: 'Within 2 business days',
  },
  {
    label: 'Partner / instructor',
    description: 'Selling on Uthena, content submissions, royalty questions.',
    email: 'partners@uthena.com',
    subject: 'Partner%20inquiry',
    responseTime: 'Within 3 business days',
  },
]

/** Company info. Sourced from the live uthena.com Privacy Policy. The
 *  mailing address is the public data-controller address. */
export const COMPANY_INFO = {
  legalName: 'Uthena',
  mailingAddress: '5830 E 2nd St, 27742, Casper, WY, 82609, US',
} as const
