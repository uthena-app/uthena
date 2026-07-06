# Feature: legal

Static legal/policy/error pages — Terms, Privacy, DMCA, Delivery, Refund
Policy, Data Sharing Opt-Out, Contact, FAQ, plus route-level 404 and 500.

## What it owns

- Markdown source files live in `04-platform/emails/legal/`. The human
  writes the legal copy; this feature just **renders** it.
- The renderer reads a markdown file from disk, parses a small YAML-ish
  frontmatter block, and converts the body to React. It ships a small
  safe markdown subset (no HTML pass-through, no script, no raw HTML).
- The shared layout shell (`ProsePage`) wraps the rendered body in a
  ~720px prose column with a "Last updated" line and optional "See also"
  cross-links.
- `ContactForm` is a single client component: name + email + subject
  + message, validated client-side, opens a pre-formatted `mailto:`
  (no server action, no PII collected server-side).
- `FaqAccordion` is a single client component: one-question-per-row
  accordion, keyboard accessible (aria-expanded, Enter/Space toggles).
- The route-level 404 (`app/not-found.tsx`) and 500 (`app/error.tsx`)
  are owned by this feature's public surface.

## What it does NOT own

- No WYSIWYG / admin-editable copy in v1. The markdown is the source
  of truth; admins don't edit it from the admin console. (A future
  admin "Legal Pages" tab can replace the markdown with a TipTap-backed
  CMS row without changing the page shape.)
- No `dmca_takedowns` public transparency feed in v1. The DMCA page
  renders the markdown only; the recent-takedowns list is a v2
  follow-up (the table is in `_data-model.md`, but no public
  allowlist query exists yet — this feature does not add one).
- The DMCA designated-agent contact lives in `platform_settings`
  (`platform_settings.dmca_agent`) and is **admin-editable** from
  `/admin/dmca-agent` (P10.4). The public `/dmca` page reads the
  same row via `getDmcaAgent` with a narrow allowlist (name + email
  + mailing_address + phone only). Updates appear on `/dmca` within
  the page's 24-hour ISR window.
- No JSX for affiliate terms or partner agreements. They are separate
  documents, not part of this module.

## File map

```
02-features/legal/
├── README.md                (this file)
├── index.ts                 (public surface)
├── queries/
│   ├── getLegalMarkdown.ts  (frontmatter parser + safe MD → React)
│   ├── getDmcaAgent.ts      (public read of platform_settings.dmca_agent)
│   ├── listFaqs.ts          (FAQ section loader; groups + Q/A)
│   └── getContactOptions.ts (contact options config)
├── components/
│   ├── ProsePage.tsx        (RSC, shared legal-doc layout shell)
│   ├── ProsePage.module.css
│   ├── ContactForm.tsx      ('use client', mailto-based)
│   ├── ContactForm.module.css
│   ├── FaqAccordion.tsx     ('use client', one-per-row accordion)
│   ├── FaqAccordion.module.css
│   ├── DmcaAgentCard.tsx    (RSC, data-driven DMCA designated-agent card)
│   └── DmcaAgentCard.module.css
└── faqs/                    (one file per FAQ; grouped)
    ├── ordering.md          (Ordering group)
    ├── lifetime-access.md
    ├── plr-license.md
    ├── mrr-license.md
    ├── refunds.md
    ├── allowed-plr-uses.md
    ├── prohibited-plr-uses.md
    └── instructor-participation.md
```

## Markdown subset (what the renderer supports)

The renderer is intentionally small. Supported in the body:

- ATX headings (`#`, `##`, `###`, `####`) → `<h1>`..`<h4>`
- Paragraphs separated by blank lines → `<p>`
- `**bold**` → `<strong>`, `*italic*` → `<em>`, `` `code` `` → `<code>`
- Unordered lists (`- `, `* `) → `<ul><li>`
- Ordered lists (`1. `) → `<ol><li>`
- `[text](url)` → `<a href>`. `http(s)` and `/` (internal) and `mailto:`
  are passed through. Any other scheme is dropped (the link is
  rendered as plain text).
- `> blockquote` → `<blockquote>`
- `---` → `<hr />`
- Pipe tables (`| col | col |`) → `<table><thead><tbody>`
- HTML in source is **escaped** (rendered as visible text), never
  injected. This is the XSS guarantee per spec.

Unsupported but harmless: Setext headings (`====`), reference-style
links, fenced code blocks (the legal documents do not need them).
Anything the renderer does not recognize is rendered as plain text.

## Frontmatter

The top of each markdown file is a small `---`-delimited YAML-ish block
parsed by a ~40-line parser (no dep). Recognized keys:

- `last_updated: YYYY-MM-DD` — displayed at the top of the page
- `title: "..."` — H1 override (defaults to a constant per route)
- `see_also: [{ label: "...", href: "..." }]` — cross-link section
- `og_description: "..."` — OpenGraph description override
- `noindex: true` — sets `robots: noindex` on the page

Unknown keys are preserved in `frontmatter` and exposed to the page if
it needs them. The parser does not throw on bad input — it falls back
to the file as if the frontmatter were missing.

## Owner

Assigned to the building agent. Until PH21 ships, this is unassigned
in the spec sense.

## Out of scope for v1

- Admin-editable copy (CMS, TipTap-backed)
- Recent DMCA takedowns feed (`dmca_takedowns` table exists; the public
  allowlist query is a v2 follow-up)
- `admin_settings.dmca_agent` lookup on `/dmca` (hard-coded in v1)
- Maintenance mode (`/maintenance` route is a separate spec; the 500
  page just falls through to itself when not in maintenance)
- "I have read and agree" checkboxes on legal pages (acceptance is at
  signup + checkout, per spec)
- i18n, PDF export, edit history, version diff
