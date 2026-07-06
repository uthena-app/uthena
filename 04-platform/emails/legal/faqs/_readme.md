# Uthena FAQ — source

> **LEGAL TEXT PLACEHOLDER.** The real text is owned by the human and
> will replace these files before launch. The structure (group, order,
> question, answer) is final. The text below is illustrative scaffolding
> only and must NOT be shipped to production as final copy.

The FAQ source files live in this directory. One file per question.
Each file is a small markdown document with frontmatter:

```markdown
---
group: "Ordering"
order: 1
question: "How do I place an order?"
---

The answer goes here. Markdown, including **bold**, *italic*, lists,
and [links](/) (subject to the safe renderer in
`02-features/legal/queries/getLegalMarkdown.ts`).
```

The page renders the questions as a grouped, keyboard-accessible
accordion. The questions and answers shown on the public `/faq` page
are the body of each file in this directory, grouped by the
`group` frontmatter field.

> Human: this README is rendered on the public page if you do not
> delete it. Delete this file (or rename it to `_readme.md`) when
> shipping the real FAQ content, or move the placeholder text into
> a single `general.md` FAQ entry.
