// listFaqs.ts — load the FAQ source files and group them by `group`
// frontmatter. Each file is a small Q/A. The page renders the groups
// as accordion sections.
//
// The FAQ source files live at `04-platform/emails/legal/faqs/*.md`.
// One file per question keeps the human's edits clean and reviewable.
// A file's frontmatter may declare:
//   group: "Ordering"        (required; the section it belongs to)
//   order: 1                 (optional; sorts within the group)
//   question: "How does X?"  (overrides the H1 of the file)

import 'server-only'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { getLegalDoc, type LegalDoc } from './getLegalMarkdown'

export type FaqEntry = {
  /** The slug is the filename without `.md`. */
  slug: string
  /** Group label from frontmatter. */
  group: string
  /** Sort key within the group. */
  order: number
  /** Resolved question text. */
  question: string
  /** Resolved answer body (React). */
  answer: LegalDoc['body']
  /** Optional last-updated from frontmatter. */
  lastUpdated?: string | undefined
}

export type FaqGroup = {
  group: string
  entries: FaqEntry[]
}

/** Load and group every FAQ file. Stable order: by group label, then order. */
export async function listFaqs(opts: { sourceDir?: string } = {}): Promise<FaqGroup[]> {
  const dir =
    opts.sourceDir ?? path.join(process.cwd(), '04-platform', 'emails', 'legal', 'faqs')
  let files: string[]
  try {
    const entries = await readdir(dir)
    files = entries.filter((f) => f.endsWith('.md')).sort()
  } catch {
    // Directory may not exist in dev — return empty list rather than throw.
    return []
  }
  const items: FaqEntry[] = []
  for (const f of files) {
    const slug = f.replace(/\.md$/, '')
    // Skip non-FAQ files: README, _readme, anything starting with `_`.
    if (slug.startsWith('_') || slug.toLowerCase() === 'readme') continue
    const doc = await getLegalDoc(slug, {
      defaultTitle: slug.replace(/-/g, ' '),
      sourceDir: dir,
    })
    // Files without a `group` frontmatter field are not FAQs — skip.
    const group = doc.frontmatter._extras?.['group']?.trim()
    if (!group) continue
    const orderRaw = doc.frontmatter._extras?.['order']?.trim()
    const order = orderRaw ? Number.parseInt(orderRaw, 10) || 0 : 0
    const question = (doc.frontmatter._extras?.['question']?.trim() || doc.title).trim()
    items.push({
      slug,
      group,
      order,
      question,
      answer: doc.body,
      lastUpdated: doc.lastUpdated,
    })
  }
  // Group, then sort.
  const byGroup = new Map<string, FaqEntry[]>()
  for (const e of items) {
    const arr = byGroup.get(e.group) ?? []
    arr.push(e)
    byGroup.set(e.group, arr)
  }
  const groups: FaqGroup[] = []
  for (const [group, entries] of byGroup) {
    entries.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
    groups.push({ group, entries })
  }
  groups.sort((a, b) => a.group.localeCompare(b.group))
  return groups
}
