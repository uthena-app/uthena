// listFaqs.test.ts — unit tests for the FAQ loader. We exercise the
// real filesystem path with a tmp directory so we cover the readdir +
// file-parse + group + sort pipeline end-to-end. No mocks.
//
// `server-only` is shimmed in vitest.config.ts so the module imports
// without throwing.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listFaqs } from './listFaqs'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'listfaqs-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeFaq(name: string, body: string) {
  await writeFile(path.join(dir, name), body, 'utf8')
}

const frontmatter = (lines: string[]) =>
  ['---', ...lines, '---', ''].join('\n')

describe('listFaqs — directory edge cases', () => {
  it('returns an empty list when the directory does not exist', async () => {
    const groups = await listFaqs({ sourceDir: path.join(dir, 'missing') })
    expect(groups).toEqual([])
  })

  it('returns an empty list when the directory has no .md files', async () => {
    await writeFile(path.join(dir, 'readme.txt'), 'not markdown', 'utf8')
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups).toEqual([])
  })

  it('ignores files starting with `_` (e.g. _readme.md)', async () => {
    await writeFaq(
      '_readme.md',
      frontmatter(['group: "Ordering"', 'order: 1', 'question: "Should not appear"']) +
        '\nBody.\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups).toEqual([])
  })

  it('ignores readme.md (case-insensitive filename match)', async () => {
    await writeFaq(
      'README.md',
      frontmatter(['group: "Ordering"', 'order: 1', 'question: "Should not appear"']) +
        '\nBody.\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups).toEqual([])
  })
})

describe('listFaqs — frontmatter parsing', () => {
  it('skips files without a `group` frontmatter field', async () => {
    await writeFaq('random.md', frontmatter(['order: 1']) + '\nBody.\n')
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups).toEqual([])
  })

  it('skips files with an empty `group` field', async () => {
    await writeFaq(
      'empty-group.md',
      frontmatter(['group: "   "', 'order: 1']) + '\nBody.\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups).toEqual([])
  })

  it('uses the frontmatter `question` field verbatim', async () => {
    await writeFaq(
      'ordering.md',
      frontmatter(['group: "Ordering"', 'order: 1', 'question: "How do I order?"']) +
        '\nBody text.\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.entries[0]!.question).toBe('How do I order?')
  })

  it('falls back to the slug-as-title (listFaqs passes slug.replace(/-/g, " ") as defaultTitle) when no `question` frontmatter is provided', async () => {
    await writeFaq(
      'ordering-cancel.md',
      frontmatter(['group: "Ordering"', 'order: 1']) +
        '\n# How do I order?\n\nBody text.\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups[0]!.entries[0]!.question).toBe('ordering cancel')
  })

  it('defaults `order` to 0 when the field is missing or non-numeric', async () => {
    await writeFaq(
      'a.md',
      frontmatter(['group: "Ordering"']) + '\n# A\n'
    )
    await writeFaq(
      'b.md',
      frontmatter(['group: "Ordering"', 'order: "abc"']) + '\n# B\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    // Both have order 0 → tiebreaker is slug alphabetical
    expect(groups[0]!.entries.map((e) => e.slug)).toEqual(['a', 'b'])
  })

  it('uses the filename (without .md) as the slug', async () => {
    await writeFaq(
      'ordering-cancel.md',
      frontmatter(['group: "Ordering"', 'order: 1', 'question: "Q?"']) +
        '\nBody.\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups[0]!.entries[0]!.slug).toBe('ordering-cancel')
  })

  it('captures `last_updated` from the frontmatter when present', async () => {
    await writeFaq(
      'a.md',
      frontmatter([
        'group: "Ordering"',
        'order: 1',
        'last_updated: "2026-06-29"',
      ]) + '\nBody.\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups[0]!.entries[0]!.lastUpdated).toBe('2026-06-29')
  })

  it('leaves lastUpdated undefined when the frontmatter field is missing', async () => {
    await writeFaq(
      'a.md',
      frontmatter(['group: "Ordering"', 'order: 1']) + '\nBody.\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups[0]!.entries[0]!.lastUpdated).toBeUndefined()
  })
})

describe('listFaqs — grouping + sort', () => {
  it('groups entries by their `group` field', async () => {
    await writeFaq(
      'ord-cancel.md',
      frontmatter(['group: "Ordering"', 'order: 1']) + '\n# Q1\n'
    )
    await writeFaq(
      'plr-yes.md',
      frontmatter(['group: "PLR"', 'order: 1']) + '\n# Q2\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups.map((g) => g.group)).toEqual(['Ordering', 'PLR'])
    expect(groups[0]!.entries[0]!.slug).toBe('ord-cancel')
    expect(groups[1]!.entries[0]!.slug).toBe('plr-yes')
  })

  it('sorts groups alphabetically by label', async () => {
    await writeFaq('z.md', frontmatter(['group: "Zeta"']) + '\n# Z\n')
    await writeFaq('a.md', frontmatter(['group: "Alpha"']) + '\n# A\n')
    await writeFaq('m.md', frontmatter(['group: "Mu"']) + '\n# M\n')
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups.map((g) => g.group)).toEqual(['Alpha', 'Mu', 'Zeta'])
  })

  it('sorts entries within a group by `order` ascending', async () => {
    await writeFaq(
      'third.md',
      frontmatter(['group: "G"', 'order: 3']) + '\n# Third\n'
    )
    await writeFaq(
      'first.md',
      frontmatter(['group: "G"', 'order: 1']) + '\n# First\n'
    )
    await writeFaq(
      'second.md',
      frontmatter(['group: "G"', 'order: 2']) + '\n# Second\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups[0]!.entries.map((e) => e.slug)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('uses slug alphabetical order as a tiebreaker when `order` is equal', async () => {
    await writeFaq(
      'b.md',
      frontmatter(['group: "G"', 'order: 1']) + '\n# B\n'
    )
    await writeFaq(
      'a.md',
      frontmatter(['group: "G"', 'order: 1']) + '\n# A\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    expect(groups[0]!.entries.map((e) => e.slug)).toEqual(['a', 'b'])
  })
})

describe('listFaqs — body content', () => {
  it('renders the markdown body to a non-empty React fragment', async () => {
    await writeFaq(
      'a.md',
      frontmatter(['group: "G"', 'question: "Q?"']) +
        '\nThe answer is **yes**.\n'
    )
    const groups = await listFaqs({ sourceDir: dir })
    const body = groups[0]!.entries[0]!.answer
    // The renderer returns a React element tree, not a string.
    expect(body).toBeTruthy()
  })
})