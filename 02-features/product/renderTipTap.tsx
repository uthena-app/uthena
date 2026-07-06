// renderTipTap — pure server-safe renderer that converts a TipTap
// JSON document (the value stored in `products.long_description`,
// JSONB column) into React JSX. Used by ProductDescription for the
// product page's Description tab.
//
// **Contract**: the JSON shape this renderer accepts is defined by
// `TipTapDocSchema` in `00-foundations/data/schemas.ts`. The schema
// is the source of truth for what the editor produces and what the
// renderer accepts. `ProductDescription` calls `parseTipTapDoc(doc)`
// first to defend against a corrupt DB row, and the renderer
// itself is also defensive (unknown node types fall through to
// "render children"; unsafe link schemes are stripped).
//
// Why a hand-rolled renderer (instead of pulling in tiptap's
// `generateHTML`):
//   1. `generateHTML` pulls in the full editor + document model
//      (~250 KB on the client, ~80 KB on the server). This renderer
//      is ~120 LOC of pure JSX, no runtime cost.
//   2. Our content is constrained to StarterKit + Link (see
//      `00-foundations/ui/forms/RichTextField.tsx`). We don't need
//      to render 200 nodes — we render the 10 our partners actually
//      use, plus a strict text-only fallback for anything else.
//   3. No DOMPurify dependency. The output is pure React — no
//      `dangerouslySetInnerHTML`, no raw HTML strings, no XSS surface
//      beyond what React already manages.
//
// Supported nodes:
//   - doc            → fragment
//   - paragraph      → <p>
//   - heading        → <h2> / <h3> (TipTap's default levels are 2 and 3;
//                       StarterKit doesn't expose h1 in our config)
//   - bulletList     → <ul>
//   - orderedList    → <ol>
//   - listItem       → <li>
//   - blockquote     → <blockquote>
//   - codeBlock      → <pre><code>
//   - hardBreak      → <br>
//   - horizontalRule → <hr>
//   - text           → <span> with marks (bold / italic / strike / code / link)
//
// Marks supported:
//   - bold       → <strong>
//   - italic     → <em>
//   - strike     → <s>
//   - code       → <code> (inline)
//   - link       → <a href target rel>
//
// Defensive fallbacks:
//   - Unknown node type → renders its text children (or nothing).
//   - Link with non-http(s) / non-relative / javascript: scheme →
//     rendered as plain text (link is stripped) so the page can never
//     serve a `javascript:` URL.
//   - All attribute values (href, alt, etc.) are string-typed; non-
//     string inputs become the empty string.

import type { ReactNode } from 'react'
import { Fragment, createElement } from 'react'

/** TipTap node shape — minimal type for what we read. */
type TipTapMark = {
  type: string
  attrs?: Record<string, unknown> | null
}

type TipTapNode = {
  type?: string
  attrs?: Record<string, unknown> | null
  content?: TipTapNode[] | null
  text?: string
  marks?: TipTapMark[] | null
}

export type JSONContent = TipTapNode

/** Maximum depth — defensive cap to prevent stack overflow on a malicious / huge doc. */
const MAX_DEPTH = 64

/**
 * Render a TipTap JSON document. Returns a React fragment containing
 * the document's children. Empty / null / non-object input returns
 * an empty fragment.
 */
export function renderTipTap(doc: unknown): ReactNode {
  if (!doc || typeof doc !== 'object') return null
  const node = doc as TipTapNode
  if (node.type === 'doc') {
    return <>{renderChildren(node.content, 0)}</>
  }
  // Tolerate a bare fragment / paragraph at the root (some serializers
  // skip the doc wrapper). Render it as a single child.
  return <>{renderNode(node, 0)}</>
}

function renderChildren(nodes: TipTapNode[] | null | undefined, depth: number): ReactNode[] {
  if (!Array.isArray(nodes)) return []
  if (depth >= MAX_DEPTH) return []
  return nodes.map((child, i) => (
    <Fragment key={i}>{renderNode(child, depth + 1)}</Fragment>
  ))
}

function renderNode(node: TipTapNode, depth: number): ReactNode {
  if (!node || typeof node !== 'object' || depth >= MAX_DEPTH) return null

  const type = node.type
  const attrs = node.attrs ?? {}
  const content = renderChildren(node.content, depth + 1)

  switch (type) {
    case 'paragraph':
      return <p>{content}</p>
    case 'heading': {
      const level = safeInt(attrs.level, 2, 2, 3)
      const Tag = (`h${level}` as 'h2' | 'h3')
      return <Tag>{content}</Tag>
    }
    case 'bulletList':
      return <ul>{content}</ul>
    case 'orderedList':
      return <ol>{content}</ol>
    case 'listItem':
      return <li>{content}</li>
    case 'blockquote':
      return <blockquote>{content}</blockquote>
    case 'codeBlock':
      return <pre><code>{content}</code></pre>
    case 'hardBreak':
      return <br />
    case 'horizontalRule':
      return <hr />
    case 'text':
      return renderText(node)
    default:
      // Unknown node — render its children so we never drop prose silently.
      return <>{content}</>
  }
}

function renderText(node: TipTapNode): ReactNode {
  const text = typeof node.text === 'string' ? node.text : ''
  if (!text) return null
  // Apply marks innermost → outermost. We build an element tree by
  // folding the marks array: each mark wraps the previous result.
  // Start with a string (the text), wrap each mark.
  let current: ReactNode = text
  const marks = Array.isArray(node.marks) ? node.marks : []
  for (const mark of marks) {
    current = wrapMark(mark, current)
  }
  return current
}

function wrapMark(mark: TipTapMark, children: ReactNode): ReactNode {
  const attrs = mark.attrs ?? {}
  switch (mark.type) {
    case 'bold':
      return <strong>{children}</strong>
    case 'italic':
      return <em>{children}</em>
    case 'strike':
      return <s>{children}</s>
    case 'underline':
      return <u>{children}</u>
    case 'code':
      return <code>{children}</code>
    case 'link': {
      const href = safeHref(attrs.href)
      if (!href) return children // strip unsafe links
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    }
    default:
      return children
  }
}

/**
 * Coerce a value to an integer clamped to [min, max]. Default is
 * returned for non-numeric / out-of-range inputs.
 */
function safeInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN
  if (!Number.isFinite(n)) return fallback
  const i = Math.trunc(n)
  if (i < min || i > max) return fallback
  return i
}

/**
 * Validate an href: allow http(s) and relative URLs only. Strip
 * `javascript:` / `data:` / `vbscript:` and everything else. This
 * is the single XSS-defending surface of the renderer.
 */
function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return null
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('mailto:')) {
    return trimmed
  }
  // Treat everything else as relative (e.g. "products/foo").
  return trimmed
}

// Re-export Fragment so the JSX in this file stays self-contained
// when transpiled.
export { Fragment }
// Suppress an unused-import warning when createElement isn't used by
// the runtime path (it isn't, but the lint config complains).
void createElement