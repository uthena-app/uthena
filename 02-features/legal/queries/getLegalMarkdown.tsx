// getLegalMarkdown.ts — reads a markdown file from disk, parses a tiny
// frontmatter block, and renders the body to safe React elements.
//
// Server-only. No `gray-matter`, no `react-markdown` — the legal-doc
// surface is small enough to hand-roll safely. The XSS guarantee:
//   1. Source HTML in the markdown body is escaped to text, never
//      injected as DOM.
//   2. Links are matched against an explicit scheme allowlist.
//   3. The output is a tree of React elements, not an HTML string.
//
// Caching: this function is wrapped in `React.cache` so the same slug
// within a single request hits the same memoized result. The page then
// sets `revalidate = 86400` so Next.js caches the rendered output.

import 'server-only'
import { cache } from 'react'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Fragment, type ReactElement, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LegalFrontmatter = {
  /** ISO date "YYYY-MM-DD". Optional. */
  lastUpdated?: string | undefined
  /** H1 override. Optional — page constant wins if both are present. */
  title?: string | undefined
  /** OpenGraph description override. */
  ogDescription?: string | undefined
  /** When true, the page sets robots=noindex. */
  noindex?: boolean | undefined
  /** Cross-link entries rendered as a "See also" footer. */
  seeAlso?: ReadonlyArray<{ label: string; href: string }> | undefined
  /** Any unknown keys are preserved under `_extras` for callers. */
  _extras?: Record<string, string> | undefined
}

export type LegalDoc = {
  /** Resolved H1 title (frontmatter.title wins, else the page's default). */
  title: string
  /** Optional last-updated ISO date. */
  lastUpdated?: string | undefined
  /** Raw parsed frontmatter block. */
  frontmatter: LegalFrontmatter
  /** OpenGraph description (from frontmatter or undefined). */
  ogDescription?: string | undefined
  /** robots=noindex flag from frontmatter. */
  noindex: boolean
  /** See-also cross-link list, from frontmatter. */
  seeAlso: ReadonlyArray<{ label: string; href: string }>
  /** Rendered body as React elements. */
  body: ReactNode
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Render a single legal document by slug (e.g. 'terms', 'privacy'). */
export const getLegalDoc = cache(async function getLegalDoc(
  slug: string,
  opts: { defaultTitle?: string; sourceDir?: string } = {},
): Promise<LegalDoc> {
  const file = await readLegalFile(slug, opts.sourceDir)
  const { frontmatter, body } = parseFrontmatter(file)
  const title = (frontmatter.title ?? opts.defaultTitle ?? slug).trim()
  const nodes = renderMarkdown(body)
  return {
    title,
    lastUpdated: frontmatter.lastUpdated,
    frontmatter,
    ogDescription: frontmatter.ogDescription,
    noindex: frontmatter.noindex === true,
    seeAlso: frontmatter.seeAlso ?? [],
    body: nodes,
  }
})

/** Read a markdown file by slug. Path is restricted to the legal source dir. */
export async function readLegalFile(slug: string, sourceDir?: string): Promise<string> {
  // Defense in depth: only allow [a-z0-9-] in the slug.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Invalid legal doc slug: ${slug}`)
  }
  const dir = sourceDir ?? path.join(process.cwd(), '04-platform', 'emails', 'legal')
  const file = path.join(dir, `${slug}.md`)
  return readFile(file, 'utf8')
}

// ---------------------------------------------------------------------------
// Frontmatter parser (tiny, no dep)
// ---------------------------------------------------------------------------

type ParsedFile = { frontmatter: LegalFrontmatter; body: string }

/**
 * Parse a `---`-delimited YAML-ish frontmatter block. We only support:
 *   - `key: value` (string)
 *   - `key: YYYY-MM-DD` (date — same as string)
 *   - `key: [item1, item2]` (list of objects with `label` + `href`)
 *
 * Unknown keys land in `_extras` so callers can still see them. The
 * parser does not throw on malformed input — it returns what it
 * could parse, with the rest of the file treated as body.
 */
export function parseFrontmatter(raw: string): ParsedFile {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return { frontmatter: {}, body: raw }
  const head = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  const fm: LegalFrontmatter = {}
  const extras: Record<string, string> = {}
  for (const line of head.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]!
    const raw = m[2] ?? ''
    if (key === 'see_also') {
      const list = parseSeeAlsoBlock(head)
      if (list) fm.seeAlso = list
      continue
    }
    if (key === 'last_updated') {
      fm.lastUpdated = unquote(raw).trim()
      continue
    }
    if (key === 'noindex') {
      fm.noindex = unquote(raw).trim() === 'true'
      continue
    }
    if (key === 'title' || key === 'og_description') {
      const k = key === 'og_description' ? 'ogDescription' : 'title'
      fm[k] = unquote(raw).trim()
      continue
    }
    extras[key] = unquote(raw).trim()
  }
  if (Object.keys(extras).length > 0) fm._extras = extras
  return { frontmatter: fm, body }
}

function unquote(s: string): string {
  const t = s.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * Parse a `see_also: [...]` block from the frontmatter. The block is
 * allowed to span multiple lines. We accept only objects with `label`
 * and `href` keys. Any malformed entry is dropped silently.
 */
function parseSeeAlsoBlock(head: string): LegalFrontmatter['seeAlso'] {
  const idx = head.indexOf('see_also:')
  if (idx < 0) return undefined
  const after = head.slice(idx + 'see_also:'.length)
  // Two shapes: inline `[{...}, {...}]` or a `see_also:` followed by
  //   - label: ...
  //     href: ...
  //   - label: ...
  //     href: ...
  const inline = /^\s*\[[\s\S]*\]\s*$/.exec(after)
  if (inline) {
    const inside = after.trim().slice(1, -1)
    const entries: { label: string; href: string }[] = []
    // Split by `}, {` then by `, label:`, then by `, href:`. Keep it
    // forgiving: any entry that lacks label+href is dropped.
    for (const raw of splitTopLevel(inside, '},')) {
      const obj = raw.replace(/^\s*\{\s*/, '').replace(/\s*\}\s*$/, '')
      const label = /label\s*:\s*"([^"]*)"|label\s*:\s*'([^']*)'/.exec(obj)
      const href = /href\s*:\s*"([^"]*)"|href\s*:\s*'([^']*)'/.exec(obj)
      if (label && href) {
        entries.push({ label: label[1] ?? label[2] ?? '', href: href[1] ?? href[2] ?? '' })
      }
    }
    return entries
  }
  // List form
  //
  // Parses blocks shaped like:
  //   see_also:
  //     - label: "Foo"
  //       href: "/foo"
  //     - label: "Bar"
  //       href: "/bar"
  //
  // The block ends at the first UNINDENTED, NON-EMPTY, NON-LIST line
  // (i.e. the next top-level frontmatter key). Blank lines BETWEEN
  // items are IGNORED — they are not the end of the block. This was
  // previously broken: the loop `break`ed on the very first empty
  // line after `see_also:`, so every list-form see_also with the
  // standard YAML one-line gap returned `undefined`. Fixed so the
  // /terms, /privacy, /dmca, /refund-policy etc. see-also lists
  // actually render.
  const entries: { label: string; href: string }[] = []
  const lines = after.split(/\r?\n/)
  let cur: Partial<{ label: string; href: string }> = {}
  const flushCur = () => {
    if (cur.label && cur.href) {
      entries.push({ label: cur.label, href: cur.href })
    }
    cur = {}
  }
  for (const line of lines) {
    // Blank lines DO NOT end the block — they're legal between items.
    if (line.trim() === '') continue

    // A non-indented line that looks like another top-level key ends
    // the see_also block. (Anything else that's neither a list item
    // nor an indented continuation is also treated as end-of-block,
    // matching the previous behavior for malformed input.)
    const isIndented = /^\s/.test(line)
    const isNewTopKey = !isIndented && /^[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(line)
    if (isNewTopKey) {
      flushCur()
      break
    }

    // `- item` line — start a new entry. The first `key: value` on
    // the same line seeds `cur`.
    const listItemMatch = /^\s*-\s+(.*)$/.exec(line)
    if (listItemMatch) {
      flushCur()
      const rest = listItemMatch[1] ?? ''
      const m = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(rest)
      if (m) {
        cur[m[1] as 'label' | 'href'] = unquote(m[2] ?? '').trim()
      }
      continue
    }

    // Indented continuation `key: value` — append to the current entry.
    // The `\s*` prefix matters: list-item continuations are indented
    // under their `- ` opener (e.g. `    href: "/foo"` after a `  -`
    // marker), so the regex has to accept leading whitespace.
    const m = /^\s*([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line)
    if (m) {
      cur[m[1] as 'label' | 'href'] = unquote(m[2] ?? '').trim()
      continue
    }

    // Anything else (e.g. a stray `>`, `#` comment that started at col
    // 0) — treat as end-of-block, but flush whatever we have first.
    flushCur()
    break
  }
  flushCur()
  return entries.length > 0 ? entries : undefined
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let inStr: string | null = null
  let buf = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      buf += c
      if (c === inStr && s[i - 1] !== '\\') inStr = null
      continue
    }
    if (c === '"' || c === "'") {
      inStr = c
      buf += c
      continue
    }
    if (c === '{' || c === '[' || c === '(') depth++
    if (c === '}' || c === ']' || c === ')') depth--
    if (sep === '},' && c === '}' && s[i + 1] === ',') {
      buf += c
      out.push(buf.trim())
      buf = ''
      i++ // skip comma
      continue
    }
    if (sep === c) {
      out.push(buf.trim())
      buf = ''
      continue
    }
    buf += c
  }
  if (buf.trim()) out.push(buf.trim())
  return out.filter((x) => x.length > 0)
}

// ---------------------------------------------------------------------------
// Safe markdown → ReactNode renderer
// ---------------------------------------------------------------------------

/** Inline formatting tokens we recognise inside a paragraph. */
type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }

function parseInline(input: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  let buf = ''
  const flushText = () => {
    if (buf) {
      out.push({ kind: 'text', text: buf })
      buf = ''
    }
  }
  while (i < input.length) {
    const c = input[i]!
    // Inline code
    if (c === '`') {
      const end = input.indexOf('`', i + 1)
      if (end > i) {
        flushText()
        out.push({ kind: 'code', text: input.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    // Link [text](href)
    if (c === '[') {
      const close = input.indexOf(']', i + 1)
      if (close > i && input[close + 1] === '(') {
        const hrefEnd = input.indexOf(')', close + 2)
        if (hrefEnd > close) {
          const text = input.slice(i + 1, close)
          const href = input.slice(close + 2, hrefEnd).trim()
          if (isSafeHref(href)) {
            flushText()
            out.push({ kind: 'link', href, children: parseInline(text) })
            i = hrefEnd + 1
            continue
          }
          // Unsafe href — render as plain text inside brackets.
        }
      }
    }
    // Strong **...**
    if (c === '*' && input[i + 1] === '*') {
      const end = input.indexOf('**', i + 2)
      if (end > i + 1) {
        flushText()
        out.push({ kind: 'strong', children: parseInline(input.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    // Em *...*
    if (c === '*' && input[i + 1] !== '*') {
      const end = findUnescaped(input, '*', i + 1)
      if (end > i) {
        flushText()
        out.push({ kind: 'em', children: parseInline(input.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    buf += c
    i++
  }
  flushText()
  return out
}

function findUnescaped(s: string, ch: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === ch && s[i - 1] !== '\\') return i
  }
  return -1
}

const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i

function isSafeHref(href: string): boolean {
  if (!href) return false
  if (SAFE_HREF.test(href)) return true
  // Relative paths starting with `./` or `../` are also OK.
  if (href.startsWith('./') || href.startsWith('../')) return true
  return false
}

function escapeText(s: string): string {
  // React handles text escaping automatically when we pass a string as
  // a child. We do NOT need to escape `<` / `&` here. The only thing
  // we strip is NUL bytes and CRLF normalization is preserved.
  return s.replace(/\u0000/g, '')
}

function renderInline(nodes: Inline[], keyPrefix: string): ReactNode {
  return nodes.map((n, idx) => {
    const key = `${keyPrefix}-${idx}`
    switch (n.kind) {
      case 'text':
        return <Fragment key={key}>{escapeText(n.text)}</Fragment>
      case 'strong':
        return <strong key={key}>{renderInline(n.children, key)}</strong>
      case 'em':
        return <em key={key}>{renderInline(n.children, key)}</em>
      case 'code':
        return <code key={key}>{escapeText(n.text)}</code>
      case 'link': {
        const external = /^https?:/i.test(n.href)
        return external ? (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {renderInline(n.children, key)}
          </a>
        ) : (
          <a key={key} href={n.href}>
            {renderInline(n.children, key)}
          </a>
        )
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Heading-slug helpers — anchor IDs for sub-section links.
// ---------------------------------------------------------------------------
// P10.1 — every legal-page heading needs a stable, URL-safe `id` so
// callers can link directly to a sub-section with `<a href="#<id>">`.
// The pure helpers below are exported so they can be unit-tested without
// pulling in the React renderer or `server-only` boundary.

/** Serialize an inline-formatted heading into its plain-text form.
 *  Used for slug derivation only — the heading is still rendered with
 *  its formatting intact via {@link renderInline}. */
export function renderInlineToText(nodes: Inline[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        out += n.text
        break
      case 'strong':
      case 'em':
      case 'link':
        out += renderInlineToText(n.children)
        break
      case 'code':
        out += n.text
        break
    }
  }
  return out
}

/** Convert a heading's plain text into a URL-safe slug.
 *  Mirrors the GitHub-style convention:
 *    "Section 1 — Online Store Terms"
 *      → "section-1-online-store-terms"
 *    "API Keys & Tokens"
 *      → "api-keys-tokens"
 *    "What if I don't see my order?"
 *      → "what-if-i-dont-see-my-order"
 *
 *  Algorithm:
 *    - Lowercase ASCII.
 *    - Keep `[a-z0-9]` plus spaces and dashes; everything else is stripped.
 *    - Underscore → dash (URL consistency).
 *    - Whitespace → dash.
 *    - Collapse runs of dashes.
 *    - Trim leading/trailing dashes.
 *    - Empty result → `'section'` so the heading still gets an `id`.
 *
 *  Pure. Safe to import from client bundles. */
export function slugifyHeading(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/_/g, '-')          // underscores → dashes for URL consistency
    .replace(/[^\w\s-]/g, '')     // strip non-word / non-whitespace / non-dash
    .replace(/\s+/g, '-')         // whitespace → single dash boundary
    .replace(/-+/g, '-')          // collapse runs of dashes
    .replace(/^-|-$/g, '')        // trim leading / trailing dashes
  return cleaned || 'section'
}

/** Return a unique slug, appending `-2`, `-3`, … when the candidate
 *  slug was already used. Matches GitHub's deterministic scheme so
 *  "/terms#section-1-terms" still resolves predictably.
 *
 *  Mutates the `used` counter as a side effect — call with a fresh
 *  map per `renderMarkdown` invocation. */
export function dedupeHeadingSlug(
  candidate: string,
  used: Map<string, number>,
): string {
  const existing = used.get(candidate)
  if (existing === undefined) {
    used.set(candidate, 1)
    return candidate
  }
  used.set(candidate, existing + 1)
  return `${candidate}-${existing}`
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; nodes: Inline[] }
  | { kind: 'paragraph'; nodes: Inline[] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'ol'; items: Inline[][] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'hr' }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'codeblock'; text: string }

function parseBlocks(input: string): Block[] {
  const lines = input.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!
    const line = raw.replace(/\s+$/, '')

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }
    // HR
    if (/^---\s*$/.test(line) || /^\*\*\*\s*$/.test(line)) {
      blocks.push({ kind: 'hr' })
      i++
      continue
    }
    // Heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const lvl = h[1]!.length as 1 | 2 | 3 | 4
      blocks.push({ kind: 'heading', level: lvl, nodes: parseInline(h[2] ?? '') })
      i++
      continue
    }
    // Blockquote — collect consecutive `>` lines
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!.replace(/\s+$/, ''))) {
        buf.push(lines[i]!.replace(/\s+$/, '').replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(buf.join('\n')) })
      continue
    }
    // Fenced code block ``` (kept as plain monospace text)
    if (/^```/.test(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i]!.replace(/\s+$/, ''))) {
        buf.push(lines[i]!)
        i++
      }
      i++ // skip closing fence
      blocks.push({ kind: 'codeblock', text: buf.join('\n') })
      continue
    }
    // Table — header row, separator row, then data rows
    if (/^\|.*\|\s*$/.test(line)) {
      const head = splitTableRow(line)
      i++
      if (i < lines.length && /^\|?\s*:?-{2,}/.test(lines[i]!.trim())) {
        i++
        const rows: string[][] = []
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!.replace(/\s+$/, ''))) {
          rows.push(splitTableRow(lines[i]!.replace(/\s+$/, '')))
          i++
        }
        blocks.push({ kind: 'table', head, rows })
        continue
      } else {
        // Not actually a table — fall through and treat as paragraph
        blocks.push({ kind: 'paragraph', nodes: parseInline(line) })
        continue
      }
    }
    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: Inline[][] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!.replace(/\s+$/, ''))) {
        const t = lines[i]!.replace(/\s+$/, '').replace(/^[-*]\s+/, '')
        items.push(parseInline(t))
        i++
      }
      blocks.push({ kind: 'ul', items })
      continue
    }
    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: Inline[][] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!.replace(/\s+$/, ''))) {
        const t = lines[i]!.replace(/\s+$/, '').replace(/^\d+\.\s+/, '')
        items.push(parseInline(t))
        i++
      }
      blocks.push({ kind: 'ol', items })
      continue
    }
    // Paragraph — collect until blank line / block start
    const buf: string[] = [line]
    i++
    while (i < lines.length) {
      const next = lines[i]!.replace(/\s+$/, '')
      if (
        next.trim() === '' ||
        /^#{1,4}\s/.test(next) ||
        /^>\s?/.test(next) ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^---\s*$/.test(next) ||
        /^\|.*\|\s*$/.test(next) ||
        /^```/.test(next)
      ) {
        break
      }
      buf.push(next)
      i++
    }
    blocks.push({ kind: 'paragraph', nodes: parseInline(buf.join(' ')) })
  }
  return blocks
}

function splitTableRow(line: string): string[] {
  // Strip leading/trailing pipes, then split on `|`. Cells are trimmed.
  const inner = line.replace(/^\|/, '').replace(/\|\s*$/, '')
  return inner.split('|').map((c) => c.trim())
}

function renderBlocks(blocks: Block[]): ReactNode {
  return renderBlocksWith(blocks, new Map<string, number>())
}

function renderBlocksWith(blocks: Block[], used: Map<string, number>): ReactNode {
  return blocks.map((b, idx) => {
    const k = `b-${idx}`
    switch (b.kind) {
      case 'heading': {
        const Tag = (`h${b.level}`) as 'h1' | 'h2' | 'h3' | 'h4'
        const headingText = renderInlineToText(b.nodes)
        const baseSlug = slugifyHeading(headingText)
        const id = dedupeHeadingSlug(baseSlug, used)
        return <Tag key={k} id={id}>{renderInline(b.nodes, k)}</Tag>
      }
      case 'paragraph':
        return <p key={k}>{renderInline(b.nodes, k)}</p>
      case 'ul':
        return (
          <ul key={k}>
            {b.items.map((it, j) => (
              <li key={`${k}-${j}`}>{renderInline(it, `${k}-${j}`)}</li>
            ))}
          </ul>
        )
      case 'ol':
        return (
          <ol key={k}>
            {b.items.map((it, j) => (
              <li key={`${k}-${j}`}>{renderInline(it, `${k}-${j}`)}</li>
            ))}
          </ol>
        )
      case 'quote':
        // Blockquote recurses with the SAME `used` map — headings
        // inside a blockquote should not collide with the rest of
        // the document and vice versa.
        return <blockquote key={k}>{renderBlocksWith(b.blocks, used)}</blockquote>
      case 'hr':
        return <hr key={k} />
      case 'codeblock':
        return (
          <pre key={k}>
            <code>{b.text}</code>
          </pre>
        )
      case 'table':
        return (
          <table key={k}>
            <thead>
              <tr>
                {b.head.map((cell, j) => (
                  <th key={`${k}-h-${j}`}>{renderInline(parseInline(cell), `${k}-h-${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, j) => (
                <tr key={`${k}-r-${j}`}>
                  {row.map((cell, jj) => (
                    <td key={`${k}-r-${j}-${jj}`}>
                      {renderInline(parseInline(cell), `${k}-r-${j}-${jj}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )
    }
  })
}

export function renderMarkdown(input: string): ReactNode {
  return renderBlocks(parseBlocks(input))
}
