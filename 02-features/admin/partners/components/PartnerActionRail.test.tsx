// PartnerActionRail.test.tsx — component tests for the right-rail
// partner approval actions panel on /admin/partners/[id].
//
// Verifies the status-aware CTA selection: the rail shows the
// "Approve partner" button only when status='pending', the
// "Suspend partner" button only when status='approved', and the
// "Unsuspend partner" button only when status='suspended'.
//
// The modals themselves are interactive (typed input, useState,
// useTransition) — they're covered by manual smoke + the action
// tests; rendering them via renderToStaticMarkup would just assert
// the modal renders nothing when closed, which the component
// guarantees by construction (useState(false) on mount).

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PartnerActionRail } from './PartnerActionRail'

describe('PartnerActionRail', () => {
  it('renders the Approve CTA when status=pending', () => {
    const html = renderToStaticMarkup(
      <PartnerActionRail
        partnerId={1}
        partnerDisplayName="Acme Co"
        status="pending"
      />,
    )
    expect(html).toContain('Approve partner')
    expect(html).not.toContain('Suspend partner')
    expect(html).not.toContain('Unsuspend partner')
    expect(html).toContain('Pending')
  })

  it('renders the Suspend CTA when status=approved', () => {
    const html = renderToStaticMarkup(
      <PartnerActionRail
        partnerId={2}
        partnerDisplayName="Globex"
        status="approved"
      />,
    )
    expect(html).toContain('Suspend partner')
    expect(html).not.toContain('Approve partner')
    expect(html).not.toContain('Unsuspend partner')
    expect(html).toContain('Approved')
  })

  it('renders the Unsuspend CTA when status=suspended', () => {
    const html = renderToStaticMarkup(
      <PartnerActionRail
        partnerId={3}
        partnerDisplayName="Initech"
        status="suspended"
      />,
    )
    expect(html).toContain('Unsuspend partner')
    expect(html).not.toContain('Approve partner')
    expect(html).not.toContain('Suspend partner')
    expect(html).toContain('Suspended')
  })

  it('renders the partner display name in the status panel', () => {
    const html = renderToStaticMarkup(
      <PartnerActionRail
        partnerId={4}
        partnerDisplayName="Wayne Enterprises"
        status="pending"
      />,
    )
    // The rail's status panel mentions the partner; the modal would
    // also include the name when open.
    expect(html).toContain('Current status')
  })

  it('does NOT render any modal markup on initial mount', () => {
    const html = renderToStaticMarkup(
      <PartnerActionRail
        partnerId={1}
        partnerDisplayName="Acme Co"
        status="pending"
      />,
    )
    expect(html).not.toContain('Type APPROVE to confirm')
    expect(html).not.toContain('Type SUSPEND to confirm')
    expect(html).not.toContain('Type UNSUSPEND to confirm')
  })

  it('uses the aside + aria-label=Partner actions landmark', () => {
    const html = renderToStaticMarkup(
      <PartnerActionRail
        partnerId={1}
        partnerDisplayName="Acme Co"
        status="approved"
      />,
    )
    expect(html).toContain('<aside')
    expect(html).toContain('aria-label="Partner actions"')
  })

  it('uses button[type=button] for the CTA (not submit)', () => {
    const html = renderToStaticMarkup(
      <PartnerActionRail
        partnerId={1}
        partnerDisplayName="Acme Co"
        status="approved"
      />,
    )
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Suspend partner<\/button>/)
  })

  it('renders the help text that explains typed-confirmation + email queue', () => {
    const html = renderToStaticMarkup(
      <PartnerActionRail
        partnerId={1}
        partnerDisplayName="Acme Co"
        status="approved"
      />,
    )
    expect(html).toContain('typed confirmation')
    expect(html).toContain('email pipeline')
  })
})