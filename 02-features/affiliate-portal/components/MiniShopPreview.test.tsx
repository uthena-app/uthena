// MiniShopPreview.test.tsx — structural unit tests for the
// /affiliate/settings Profile section's live preview card.
//
// Strategy: renderToStaticMarkup (same as the rest of the project).
// The component is RSC + zero client JS, so the markup is the
// contract.
//
// What this verifies:
//   1. Renders the handle as a `@handle` eyebrow (always)
//   2. Renders the displayName when present
//   3. Renders the bio when present
//   4. Falls back to "@handle" when displayName is empty (matches
//      the public /[handle] hero's defensive behavior)
//   5. Falls back to "Curated picks by @handle" when bio is empty
//   6. Renders the "Verified affiliate" pill (matches MiniShopHero)

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MiniShopPreview } from './MiniShopPreview'

describe('MiniShopPreview — happy path', () => {
  it('renders the handle as an eyebrow + displayName + bio', () => {
    const html = renderToStaticMarkup(
      createElement(MiniShopPreview, {
        displayName: 'Alice',
        bio: 'Teaching indie hackers since 2019.',
        handle: 'alice',
      }),
    )
    expect(html).toContain('@alice')
    expect(html).toContain('Alice')
    expect(html).toContain('Teaching indie hackers since 2019.')
  })

  it('renders the "Verified affiliate" pill (matches MiniShopHero)', () => {
    const html = renderToStaticMarkup(
      createElement(MiniShopPreview, {
        displayName: 'Alice',
        bio: 'A bio.',
        handle: 'alice',
      }),
    )
    expect(html).toContain('Verified affiliate')
  })
})

describe('MiniShopPreview — defensive fallbacks', () => {
  it('falls back to "@handle" when displayName is empty', () => {
    const html = renderToStaticMarkup(
      createElement(MiniShopPreview, {
        displayName: '',
        bio: 'A bio.',
        handle: 'bob',
      }),
    )
    // Should not render an empty <p>; should render "@bob" as the name.
    expect(html).not.toContain('></p>')
    expect(html).toContain('@bob')
    // The handle eyebrow + the name fallback are both @bob — but
    // they appear in different elements so the markup has 2 separate
    // @bob tokens (the handle eyebrow + the fallback name).
    const occurrences = (html.match(/@bob/g) ?? []).length
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })

  it('falls back to "Curated picks by @handle" when bio is empty', () => {
    const html = renderToStaticMarkup(
      createElement(MiniShopPreview, {
        displayName: 'Carol',
        bio: '',
        handle: 'carol',
      }),
    )
    expect(html).toContain('Curated picks by @carol')
  })

  it('falls back for both empty displayName AND empty bio', () => {
    const html = renderToStaticMarkup(
      createElement(MiniShopPreview, {
        displayName: '',
        bio: '',
        handle: 'dave',
      }),
    )
    expect(html).toContain('@dave')
    expect(html).toContain('Curated picks by @dave')
  })

  it('trims surrounding whitespace before applying fallbacks', () => {
    const html = renderToStaticMarkup(
      createElement(MiniShopPreview, {
        displayName: '   ',
        bio: '   \n  ',
        handle: 'eve',
      }),
    )
    // Whitespace-only treated as empty → fallbacks apply
    expect(html).toContain('@eve')
    expect(html).toContain('Curated picks by @eve')
  })
})

describe('MiniShopPreview — a11y', () => {
  it('is marked aria-hidden so screen readers skip the preview mirror', () => {
    const html = renderToStaticMarkup(
      createElement(MiniShopPreview, {
        displayName: 'Alice',
        bio: 'A bio.',
        handle: 'alice',
      }),
    )
    // The Preview is decorative — the real values are in the input
    // fields; the preview just shows the look-and-feel.
    expect(html).toMatch(/aria-hidden="true"/)
  })
})