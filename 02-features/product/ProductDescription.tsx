// ProductDescription — the Description tab content. Renders
// `products.long_description` (a TipTap JSON document stored as
// JSONB) via the pure-JSX `renderTipTap` renderer.
//
// Mockup parity: `mockups/product.html` lines 118–130 — the mockup
// has a hard-coded "Course overview" / "What you'll learn" /
// "License, rebrand, and resell" prose block. We don't hard-code
// any of that; the partner authors the long_description in the
// TipTap editor and we render whatever they wrote.
//
// **Four render modes**:
//   1. `long_description` is null → renders the mockup-faithful
//      fallback prose (Course overview / What you'll learn). This
//      is the "fresh product, partner hasn't filled in the wizard"
//      state. Same pattern as ProductPerks (Slice 3) and
//      ProductCurriculum (Slice 4 below).
//   2. `long_description` is an empty doc (`{type:'doc',content:[]}`)
//      → renders nothing (partner explicitly cleared the field).
//   3. `long_description` has content → renders the partner's
//      prose via `renderTipTap`. The renderer's output is pure
//      React (no `dangerouslySetInnerHTML`), with strict XSS
//      defenses on links and unknown node types.
//   4. `long_description` is non-null but fails the TipTap
//      schema parse (corrupt / legacy / pre-v2 shape) → falls
//      back to the mockup-faithful prose. Defense in depth: the
//      DB column accepts any JSONB, so a bad write or a
//      future-shape mismatch can't render a broken page.
//
// **Why an RSC**: zero interactivity. The output is fully
// server-rendered. The Description tab is the default tab, so the
// first paint includes this content even before the client JS
// hydrates the tabs switcher.

import { parseTipTapDoc } from '@foundations/data/schemas'
import { renderTipTap, type JSONContent } from './renderTipTap'
import styles from './ProductDescription.module.css'

/** Mockup-faithful fallback prose for the "no content yet" state. */
const FALLBACK_DESCRIPTION: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Course overview' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'This course walks you through the entire lifecycle of building and shipping a digital product. You will learn the exact tools, workflows, and prompts the instructor uses to research a niche, package a curriculum, price it for the market, and keep it selling after launch.',
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: "What you'll learn" }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Pick a profitable niche using AI-driven market analysis' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Build a content engine that produces 30 posts per week in your voice' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Design a visual identity and brand system' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Set up distribution and growth loops on three platforms simultaneously' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Convert attention into product sales with a clean monetization stack' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'License, rebrand, and resell the entire course as your own' }] },
          ],
        },
      ],
    },
  ],
}

/** True when the doc has no meaningful content (no paragraphs, no headings, no lists). */
function isEmptyDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return true
  const content = (doc as JSONContent).content
  return !Array.isArray(content) || content.length === 0
}

type Props = {
  /** TipTap JSON doc from `products.long_description` (JSONB). */
  longDescription: unknown
}

export function ProductDescription({ longDescription }: Props) {
  // Resolve the effective document. Null / missing → fallback. Empty
  // doc → nothing. Doc that fails the schema parse (corrupt / legacy /
  // pre-v2) → fallback (defense in depth). Doc with valid content → the doc.
  let effective: JSONContent | null
  if (longDescription == null) {
    effective = FALLBACK_DESCRIPTION
  } else {
    const parsed = parseTipTapDoc(longDescription)
    if (parsed === null) {
      // Bad shape — treat like null and show the fallback rather than render garbage.
      effective = FALLBACK_DESCRIPTION
    } else if (isEmptyDoc(parsed)) {
      effective = null
    } else {
      effective = parsed as JSONContent
    }
  }

  if (!effective) return null

  return (
    <div className={styles.prose}>
      {renderTipTap(effective)}
    </div>
  )
}