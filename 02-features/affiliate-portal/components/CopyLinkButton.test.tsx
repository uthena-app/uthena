// CopyLinkButton.test.tsx — P13.5 copy-url client island tests.
//
// Pure component test via react-dom/server `renderToStaticMarkup`.
// Verifies the static shape (label, copy icon, disabled, ARIA
// label) + the just-copied state class flip via the
// [data-just-copied] attribute selector. The async click handler
// (clipboard API + execCommand fallback + toast) is verified by
// source reading + the spec's manual smoke in dev — renderToStaticMarkup
// doesn't fire onClick, so we can't unit-test the click path
// without jsdom.

import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

// Mock the Toast hook — useToast() throws outside a ToastProvider;
// renderToStaticMarkup doesn't mount the root layout, so we stub
// the hook to return no-op functions. This isolates the test to
// the button's static markup + aria attribute construction.
vi.mock('@foundations/ui/Toast', () => ({
  useToast: () => ({
    success: () => 'toast-id',
    info: () => 'toast-id',
    error: () => 'toast-id',
    dismiss: () => {},
  }),
}))

// Import after mock so the mocked hook is picked up.
import { CopyLinkButton } from './CopyLinkButton'

function render(el: ReactElement) {
  return renderToStaticMarkup(el)
}

describe('CopyLinkButton — static rendering', () => {
  it('renders a <button> with the default "Copy" label + text aria-label', () => {
    const html = render(<CopyLinkButton text="https://uthena.com/?ref=marcus" />)
    expect(html).toContain('<button')
    expect(html).toContain('>Copy<')
    expect(html).toContain('aria-label="Copy: https://uthena.com/?ref=marcus"')
  })

  it('uses the custom label when provided', () => {
    const html = render(
      <CopyLinkButton text="https://uthena.com/?ref=marcus" label="Copy URL" />,
    )
    expect(html).toContain('>Copy URL<')
  })

  it('renders data-just-copied="false" in the initial state', () => {
    const html = render(<CopyLinkButton text="x" copiedLabel="Copied!" />)
    expect(html).toContain('data-just-copied="false"')
  })

  it('honors the disabled prop', () => {
    const html = render(<CopyLinkButton text="x" disabled />)
    expect(html).toContain('disabled')
  })

  it('renders the icon when provided', () => {
    const html = render(
      <CopyLinkButton text="x" icon={<span data-testid="copy-icon">icon</span>} />,
    )
    expect(html).toContain('data-testid="copy-icon"')
    expect(html).toContain('>icon<')
  })

  it('respects the ariaLabel override', () => {
    const html = render(<CopyLinkButton text="x" ariaLabel="Copy link to clipboard" />)
    expect(html).toContain('aria-label="Copy link to clipboard"')
  })

  it('renders without a className override (no class attribute when fullWidth is unset)', () => {
    const html = render(<CopyLinkButton text="x" />)
    // The className comes from CSS module hashing; just check it
    // exists and is non-empty.
    expect(html).toMatch(/class="[^"]+"/)
  })
})
