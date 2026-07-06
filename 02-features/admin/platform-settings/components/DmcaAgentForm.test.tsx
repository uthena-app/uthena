// DmcaAgentForm.test.tsx — unit tests for the DMCA agent editor client
// island. Uses `renderToStaticMarkup` (same pattern as the other form
// tests in this codebase: RefundForm.test.tsx, ReviewsSection.test.tsx,
// Stepper.test.tsx) so the tests stay fast + sync.
//
// Strategy: render the initial server-side HTML of the component in
// the four meaningful states (prefilled + updated_at, prefilled no
// updated_at, empty initial, success + error states aren't rendered
// server-side because they live in client-only useState). Assert:
//   - field labels + placeholders render
//   - inputs prefilled from the `initial` prop
//   - preview block renders when all required fields are non-empty
//   - preview block hides when any required field is empty
//   - Last saved row renders when `updatedAt` is provided
//   - Reset button is wired
//
// Interactive behaviour (onChange / onSubmit / useTransition) is
// covered by `updateDmcaAgent.test.ts` (the action-level test mocks
// the same shape that the form's submit handler invokes).

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DmcaAgentForm } from './DmcaAgentForm'
import type { DmcaAgentContact } from '@features/legal'

const SAMPLE: DmcaAgentContact = {
  name: 'Jane Doe, Esq.',
  email: 'legal@uthena.com',
  mailing_address: '123 Main St\nCity, ST 00000',
  phone: '+1-555-0100',
}

describe('DmcaAgentForm', () => {
  it('renders the four labelled inputs prefilled from the initial prop', () => {
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={SAMPLE} updatedAt="2026-06-29T10:00:00Z" />,
    )
    // Labels render with the required asterisk for the three required
    // fields; phone is annotated (optional).
    expect(html).toContain('Designated agent name')
    expect(html).toContain('Designated agent email')
    expect(html).toContain('Mailing address')
    expect(html).toContain('Phone')
    expect(html).toContain('(optional)')
    // Prefilled values round-trip into the inputs.
    expect(html).toContain('value="Jane Doe, Esq."')
    expect(html).toContain('value="legal@uthena.com"')
    expect(html).toContain('123 Main St')
    expect(html).toContain('+1-555-0100')
  })

  it('renders empty fields when initial is null (freshly-provisioned state)', () => {
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={null} updatedAt={null} />,
    )
    // No values in any of the inputs (value="" or no value attr).
    expect(html).not.toContain('Jane Doe')
    expect(html).not.toContain('legal@uthena.com')
    // Preview block hides (no all-required-fields-non-empty state).
    expect(html).not.toContain('Preview — what visitors see')
  })

  it('renders the preview block when all required fields are non-empty', () => {
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={SAMPLE} updatedAt="2026-06-29T10:00:00Z" />,
    )
    expect(html).toContain('Preview — what visitors see')
    expect(html).toContain('Jane Doe, Esq.')
    expect(html).toContain('legal@uthena.com')
    // Phone row appears in the preview when set.
    expect(html).toContain('+1-555-0100')
  })

  it('hides the preview block when any required field is empty', () => {
    const partial: DmcaAgentContact = {
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '', // required but empty
      phone: '',
    }
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={partial} updatedAt={null} />,
    )
    expect(html).not.toContain('Preview — what visitors see')
  })

  it('hides the phone preview row when phone is empty', () => {
    const noPhone: DmcaAgentContact = {
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
      phone: '',
    }
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={noPhone} updatedAt={null} />,
    )
    // Preview block is visible (required fields are non-empty).
    expect(html).toContain('Preview — what visitors see')
    // The form's field label "Phone" always renders (the phone input
    // is always shown). When the preview's Phone row is hidden, the
    // total occurrences of "Phone" in the markup drop from 2 → 1.
    // (1 = label only; 2 = label + previewKey "Phone".)
    const phoneOccurrences = (html.match(/Phone/g) ?? []).length
    expect(phoneOccurrences).toBe(1)
  })

  it('renders both the label and the preview phone row when phone is set', () => {
    // Mirror of the previous test — when phone is set, both the form
    // label and the preview's Phone row render → 2 occurrences.
    const withPhone: DmcaAgentContact = {
      name: 'Jane Doe',
      email: 'legal@uthena.com',
      mailing_address: '123 Main St',
      phone: '+1-555-0100',
    }
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={withPhone} updatedAt={null} />,
    )
    const phoneOccurrences = (html.match(/Phone/g) ?? []).length
    expect(phoneOccurrences).toBe(2)
  })

  it('renders the Last saved timestamp when updatedAt is provided', () => {
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={SAMPLE} updatedAt="2026-06-29T10:00:00Z" />,
    )
    expect(html).toContain('Last saved')
    expect(html).toContain('2026-06-29')
  })

  it('omits the Last saved row when updatedAt is null', () => {
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={SAMPLE} updatedAt={null} />,
    )
    expect(html).not.toContain('Last saved')
  })

  it('renders the Save changes and Reset buttons', () => {
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={SAMPLE} updatedAt="2026-06-29T10:00:00Z" />,
    )
    expect(html).toContain('Save changes')
    expect(html).toContain('Reset')
  })

  it('links to the public /dmca page from the intro paragraph', () => {
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={SAMPLE} updatedAt="2026-06-29T10:00:00Z" />,
    )
    // The intro paragraph references the public page so the admin
    // can preview it directly from the editor.
    expect(html).toContain('href="/dmca"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('marks the form as noValidate (server is the source of truth)', () => {
    const html = renderToStaticMarkup(
      <DmcaAgentForm initial={SAMPLE} updatedAt="2026-06-29T10:00:00Z" />,
    )
    // React renders boolean HTML attributes in the JSX camelCase form
    // (the lowercase html form is normalised server-side). The
    // important contract is that browser-native validation is off so
    // our Zod errors from the action are the single source of truth.
    expect(html).toMatch(/noValidate(?:="")?/)
  })
})