// getLegalMarkdown.test.ts — unit tests for the legal-doc renderer
// (frontmatter parser, slug helpers, end-to-end Markdown → React output).
//
// `server-only` is shimmed in vitest.config.ts, so the `import 'server-only'`
// at the top of getLegalMarkdown.tsx resolves to an empty stub in these
// tests — we don't need to mock it.
//
// We use `renderToStaticMarkup` for the rendering tests so the file can
// stay a plain `.test.ts` (no JSX, the project's `include` glob covers
// only `*.test.ts` + `*.test.tsx` but JSX-free snapshots run fastest in
// the `.test.ts` lane).

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  slugifyHeading,
  renderInlineToText,
  dedupeHeadingSlug,
  renderMarkdown,
  parseFrontmatter,
} from './getLegalMarkdown'

// ---------------------------------------------------------------------------
// slugifyHeading
// ---------------------------------------------------------------------------

describe('slugifyHeading', () => {
  it('lowercases ASCII headings', () => {
    expect(slugifyHeading('Section 1 — Online Store Terms')).toBe(
      'section-1-online-store-terms'
    )
  })

  it('converts whitespace to dashes', () => {
    expect(slugifyHeading('What if I   do not see my order?')).toBe(
      'what-if-i-do-not-see-my-order'
    )
  })

  it('strips punctuation entirely', () => {
    expect(slugifyHeading('API Keys & Tokens (Beta)')).toBe('api-keys-tokens-beta')
  })

  it('strips em-dashes and curly quotes', () => {
    expect(slugifyHeading('“Instructor” — Earnings & Payouts')).toBe(
      'instructor-earnings-payouts'
    )
  })

  it('collapses multiple dashes into one', () => {
    expect(slugifyHeading('A --- B   C')).toBe('a-b-c')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugifyHeading('!!! Spaced !!!')).toBe('spaced')
  })

  it('falls back to "section" when the result is empty', () => {
    expect(slugifyHeading('!!!')).toBe('section')
    expect(slugifyHeading('')).toBe('section')
  })

  it('converts underscores to dashes', () => {
    expect(slugifyHeading('Course_Type_PLRLicense')).toBe('course-type-plrlicense')
  })

  it('preserves digits', () => {
    expect(slugifyHeading('Section 19 — Changes to Terms of Service')).toBe(
      'section-19-changes-to-terms-of-service'
    )
  })

  it('handles real headings from /terms markdown', () => {
    expect(slugifyHeading('## Section 1 — Online Store Terms')).toBe(
      'section-1-online-store-terms'
    )
    expect(slugifyHeading('## Section 20 — Contact Information')).toBe(
      'section-20-contact-information'
    )
  })
})

// ---------------------------------------------------------------------------
// renderInlineToText — strips formatting to plain text for slug derivation
// ---------------------------------------------------------------------------

describe('renderInlineToText', () => {
  it('returns plain text unchanged', () => {
    expect(renderInlineToText([{ kind: 'text', text: 'hello world' }])).toBe(
      'hello world'
    )
  })

  it('unwraps strong children', () => {
    expect(
      renderInlineToText([
        {
          kind: 'strong',
          children: [{ kind: 'text', text: 'bold' }],
        },
      ])
    ).toBe('bold')
  })

  it('unwraps em children', () => {
    expect(
      renderInlineToText([
        {
          kind: 'em',
          children: [{ kind: 'text', text: 'italic' }],
        },
      ])
    ).toBe('italic')
  })

  it('keeps code text (no markup semantics)', () => {
    expect(
      renderInlineToText([{ kind: 'code', text: 'npm install' }])
    ).toBe('npm install')
  })

  it('unwraps link children (text only)', () => {
    expect(
      renderInlineToText([
        {
          kind: 'link',
          href: '/foo',
          children: [{ kind: 'text', text: 'click me' }],
        },
      ])
    ).toBe('click me')
  })

  it('composes mixed inline nodes into a single plain string', () => {
    expect(
      renderInlineToText([
        { kind: 'text', text: 'Hello ' },
        {
          kind: 'strong',
          children: [{ kind: 'text', text: 'world' }],
        },
        { kind: 'text', text: '!' },
      ])
    ).toBe('Hello world!')
  })

  it('returns empty string for empty input', () => {
    expect(renderInlineToText([])).toBe('')
  })
})

// ---------------------------------------------------------------------------
// dedupeHeadingSlug — collision handling (matches GitHub's `-1`, `-2` ...)
// ---------------------------------------------------------------------------

describe('dedupeHeadingSlug', () => {
  it('returns the candidate on first use', () => {
    const used = new Map<string, number>()
    expect(dedupeHeadingSlug('section', used)).toBe('section')
    expect(used.get('section')).toBe(1)
  })

  it('appends -1 on the second use', () => {
    const used = new Map<string, number>()
    dedupeHeadingSlug('section', used)
    expect(dedupeHeadingSlug('section', used)).toBe('section-1')
    expect(used.get('section')).toBe(2)
  })

  it('appends -2, -3, ... on subsequent uses', () => {
    const used = new Map<string, number>()
    expect(dedupeHeadingSlug('x', used)).toBe('x')
    expect(dedupeHeadingSlug('x', used)).toBe('x-1')
    expect(dedupeHeadingSlug('x', used)).toBe('x-2')
    expect(dedupeHeadingSlug('x', used)).toBe('x-3')
  })

  it('tracks each unique slug independently', () => {
    const used = new Map<string, number>()
    expect(dedupeHeadingSlug('a', used)).toBe('a')
    expect(dedupeHeadingSlug('b', used)).toBe('b')
    expect(dedupeHeadingSlug('a', used)).toBe('a-1')
    expect(dedupeHeadingSlug('b', used)).toBe('b-1')
  })
})

// ---------------------------------------------------------------------------
// renderMarkdown — integration: heading IDs appear on rendered HTML
// ---------------------------------------------------------------------------

describe('renderMarkdown — heading anchor IDs (P10.1)', () => {
  it('emits an `id` on every heading it renders', () => {
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        renderMarkdown(
          ['## Section 1', '## Section 2', '### Section 1 — Subsection'].join('\n\n')
        ) as any
      )
    )
    expect(html).toContain('id="section-1"')
    expect(html).toContain('id="section-2"')
    expect(html).toContain('id="section-1-subsection"')
  })

  it('derives the id from the heading text', () => {
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        renderMarkdown('## Returns & Refunds Policy') as any
      )
    )
    expect(html).toContain('id="returns-refunds-policy"')
  })

  it('strips inline formatting from the id but keeps it in the rendered text', () => {
    // The renderer's inline parser only supports `*italic*` (asterisk)
    // — `_underscore_` italic is a deliberate non-feature. Match the
    // real-world input shape: heading with bold + em runs.
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        renderMarkdown('## **Bold** heading *with italic*') as any
      )
    )
    // id is the plain text after markup is stripped.
    expect(html).toContain('id="bold-heading-with-italic"')
    // The visible heading text still contains the formatted runs.
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<em>with italic</em>')
  })

  it('appends -1, -2 to disambiguate duplicate headings', () => {
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        renderMarkdown(
          ['## Terms', '## Terms', '## Terms'].join('\n\n')
        ) as any
      )
    )
    expect(html).toContain('id="terms"')
    expect(html).toContain('id="terms-1"')
    expect(html).toContain('id="terms-2"')
  })

  it('keeps headings inside blockquotes in the same dedupe pool as the rest', () => {
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        renderMarkdown(
          ['## Wrapper', '> ## Wrapper', '> ## Wrapper'].join('\n\n')
        ) as any
      )
    )
    // Two more "wrapper" entries inside the quote → `wrapper-1`, `wrapper-2`.
    expect(html).toContain('id="wrapper"')
    expect(html).toContain('id="wrapper-1"')
    expect(html).toContain('id="wrapper-2"')
  })

  it('falls back to "section" when the heading text slugifies to empty', () => {
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        renderMarkdown('## !!!') as any
      )
    )
    expect(html).toContain('id="section"')
  })
})

// ---------------------------------------------------------------------------
// parseFrontmatter — frontmatter + see_also parser (P10.1 regression)
// ---------------------------------------------------------------------------
// The legal frontmatter parser previously broke out of the see_also
// list-form loop on the very first blank line after `see_also:` — so
// every legal .md that uses the canonical "one blank line, then
// indented `- ` items" shape silently rendered with no see-also
// links. The fix is exercised below.

describe('parseFrontmatter — list-form see_also (P10.1 fix)', () => {
  it('parses last_updated and title from a simple frontmatter', () => {
    const raw = [
      '---',
      'last_updated: 2026-01-15',
      'title: "Foo"',
      '---',
      '',
      '## Body',
      '',
    ].join('\n')
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.lastUpdated).toBe('2026-01-15')
    expect(frontmatter.title).toBe('Foo')
    expect(frontmatter.seeAlso).toBeUndefined()
  })

  it('parses list-form see_also with the canonical YAML gap after `see_also:`', () => {
    // This is the exact shape used by every 04-platform/emails/legal/*.md
    // (terms.md, privacy.md, dmca.md, refund-policy.md, delivery.md,
    // data-sharing-opt-out.md). The leading newline after `see_also:`
    // used to break the list-form parser — fixed in P10.1.
    const raw = [
      '---',
      'last_updated: 2026-01-15',
      'title: "Foo"',
      'see_also:',
      '  - label: "Privacy Policy"',
      '    href: "/privacy"',
      '  - label: "DMCA Notice-and-Takedown"',
      '    href: "/dmca"',
      '  - label: "Refund Policy"',
      '    href: "/refund-policy"',
      '---',
      '',
      '## Body',
      '',
    ].join('\n')
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.seeAlso).toEqual([
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'DMCA Notice-and-Takedown', href: '/dmca' },
      { label: 'Refund Policy', href: '/refund-policy' },
    ])
  })

  it('parses list-form see_also when items have a blank line between them', () => {
    const raw = [
      '---',
      'see_also:',
      '  - label: "A"',
      '    href: "/a"',
      '',
      '  - label: "B"',
      '    href: "/b"',
      '---',
      '',
      '## body',
    ].join('\n')
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.seeAlso).toEqual([
      { label: 'A', href: '/a' },
      { label: 'B', href: '/b' },
    ])
  })

  it('ends see_also at the next unindented top-level frontmatter key', () => {
    const raw = [
      '---',
      'last_updated: 2026-01-15',
      'title: "Foo"',
      'see_also:',
      '  - label: "A"',
      '    href: "/a"',
      'og_description: "the rules"',
      '---',
      '## body',
    ].join('\n')
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.seeAlso).toEqual([{ label: 'A', href: '/a' }])
    expect(frontmatter.ogDescription).toBe('the rules')
  })

  it('parses the real /terms.md frontmatter end-to-end (regression)', () => {
    // Source-of-truth test: the actual file now parses with seeAlso
    // populated (it was silently undefined before P10.1).
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const raw = fs.readFileSync(
      path.join(process.cwd(), '04-platform/emails/legal/terms.md'),
      'utf8'
    )
    const { frontmatter } = parseFrontmatter(raw)
    expect(frontmatter.lastUpdated).toBe('2025-09-08')
    expect(frontmatter.title).toBe('Terms of Service')
    expect(frontmatter.ogDescription).toBe('The rules of using Uthena.com')
    expect(frontmatter.seeAlso).toEqual([
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'DMCA Notice-and-Takedown', href: '/dmca' },
      { label: 'Refund Policy', href: '/refund-policy' },
    ])
  })
})
