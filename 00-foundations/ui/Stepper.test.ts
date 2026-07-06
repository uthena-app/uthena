// Stepper unit tests — verifies the structural + accessibility contract
// without rendering against a real DOM (we use static HTML output via
// ReactDOMServer.renderToStaticMarkup to keep tests fast and pure).
//
// Uses createElement directly so the file stays a plain `.test.ts` —
// the project's vitest config (`include: ['**/*.test.ts']`) doesn't
// include `.tsx` test files. JSX is unnecessary for static markup
// snapshots anyway.

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Stepper, type StepperStep } from './Stepper'

const sampleSteps: StepperStep[] = [
  { id: 'email', label: 'Email', description: 'Confirm your receipt address' },
  { id: 'review', label: 'Review', description: 'Items + total + legal' },
  { id: 'payment', label: 'Payment' },
  { id: 'confirmation', label: 'Confirmation' },
]

describe('Stepper', () => {
  it('renders an <ol> with the requested aria-label', () => {
    const html = renderToStaticMarkup(
      createElement(Stepper, { steps: sampleSteps, currentStep: 'email', ariaLabel: 'Checkout progress' }),
    )
    expect(html).toContain('<ol')
    expect(html).toContain('aria-label="Checkout progress"')
  })

  it('marks the current step with aria-current="step"', () => {
    const html = renderToStaticMarkup(createElement(Stepper, { steps: sampleSteps, currentStep: 'review' }))
    const reviewMatch = html.match(/<li[^>]*aria-current="step"[\s\S]*?<\/li>/)
    expect(reviewMatch).not.toBeNull()
    expect(reviewMatch![0]).toContain('Review')
  })

  it('marks previous steps as done and renders the check icon', () => {
    const html = renderToStaticMarkup(createElement(Stepper, { steps: sampleSteps, currentStep: 'review' }))
    const emailItem = html.match(/<li[^>]*data-state="done"[\s\S]*?<\/li>/)
    expect(emailItem).not.toBeNull()
    expect(emailItem![0]).toContain('<svg')
    expect(emailItem![0]).not.toContain('>1<')
  })

  it('marks future steps as upcoming', () => {
    const html = renderToStaticMarkup(createElement(Stepper, { steps: sampleSteps, currentStep: 'review' }))
    expect(html).toContain('data-state="upcoming"')
    expect(html.match(/data-state="upcoming"/g)?.length).toBe(2)
  })

  it('renders an sr-only "current" / "done" / "upcoming" suffix for SR users', () => {
    const html = renderToStaticMarkup(createElement(Stepper, { steps: sampleSteps, currentStep: 'email' }))
    expect(html).toMatch(/current/i)
    expect(html).toMatch(/upcoming/i)
    // "done" only appears once a step is in the past.
    expect(html).not.toMatch(/done/i)
  })

  it('renders N-1 connectors between N steps', () => {
    const html = renderToStaticMarkup(createElement(Stepper, { steps: sampleSteps, currentStep: 'email' }))
    const connectors = html.match(/class="[^"]*connector[^"]*"/g)
    expect(connectors?.length).toBe(sampleSteps.length - 1)
  })

  it('honors explicit completedSteps (e.g. a step can be skipped)', () => {
    const html = renderToStaticMarkup(
      createElement(Stepper, { steps: sampleSteps, currentStep: 'payment', completedSteps: ['email'] }),
    )
    // Review should be UPCOMING (not done), even though it sits before
    // the current step — explicit list wins over auto-by-position.
    expect(html).toContain('data-state="upcoming"')
    expect(html).toContain('data-state="done"')
  })

  it('falls back to no completed steps when currentStep is not found', () => {
    const html = renderToStaticMarkup(
      createElement(Stepper, { steps: sampleSteps, currentStep: 'nonexistent' }),
    )
    expect(html).not.toContain('data-state="done"')
    expect(html).not.toContain('aria-current="step"')
  })

  it('renders the trailing slot when provided', () => {
    const html = renderToStaticMarkup(
      createElement(Stepper, {
        steps: sampleSteps,
        currentStep: 'email',
        trailing: createElement('a', { href: '/cart' }, 'Back'),
      }),
    )
    expect(html).toContain('Back')
    expect(html).toContain('href="/cart"')
  })

  it('uses horizontal orientation by default and exposes a vertical variant', () => {
    const horiz = renderToStaticMarkup(createElement(Stepper, { steps: sampleSteps, currentStep: 'email' }))
    expect(horiz).toContain('o_horizontal')
    expect(horiz).not.toContain('o_vertical')

    const vert = renderToStaticMarkup(
      createElement(Stepper, { steps: sampleSteps, currentStep: 'email', orientation: 'vertical' }),
    )
    expect(vert).toContain('o_vertical')
    expect(vert).not.toContain('class="Stepper_connector')
  })

  it('applies a className passthrough', () => {
    const html = renderToStaticMarkup(
      createElement(Stepper, { steps: sampleSteps, currentStep: 'email', className: 'my-stepper' }),
    )
    expect(html).toContain('my-stepper')
  })

  it('omits the description element when no description is provided', () => {
    const stepsNoDesc: StepperStep[] = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
    const html = renderToStaticMarkup(createElement(Stepper, { steps: stepsNoDesc, currentStep: 'a' }))
    expect(html).not.toContain('class="Stepper_desc')
  })

  it('exposes a stable data-state attribute per step for CSS targeting', () => {
    const html = renderToStaticMarkup(createElement(Stepper, { steps: sampleSteps, currentStep: 'review' }))
    const stateAttrs = html.match(/data-state="(current|done|upcoming)"/g)
    expect(stateAttrs?.length).toBe(sampleSteps.length)
  })
})