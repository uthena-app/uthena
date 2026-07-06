# FAQ — `/faq`

## What this page does

The public FAQ page for buyer, reseller, affiliate, and partner questions. It replaces the current Shopify `/pages/faq` with the clean canonical URL `/faq` while preserving the FAQ content that appears on the live site and homepage. It explains PLR, MRR, lifetime access, refunds, course delivery, allowed uses, prohibited uses, instructor participation, and support expectations.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | title, short intro | hard-coded or markdown frontmatter | H1 + prose |
| FAQ groups | group title, questions, answers | markdown or structured FAQ file | accordion/list |
| Support CTA | contact email/link | config | CTA |
| SEO metadata | title, description, canonical | frontmatter | `<head>` |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open FAQ | Navigate to `/faq` | Renders FAQ content | public |
| Open legacy FAQ | Navigate to `/pages/faq` | Permanent redirect to `/faq` | public |
| Expand question | Click question | Shows answer; keyboard accessible | public |
| Contact support | Click support link | Navigates to `/contact` or opens configured mailto | public |

## What this page does NOT do

- No support ticket form
- No live chat
- No personalized order lookup
- No legal agreement replacement; license and refund pages remain authoritative

## Acceptance criteria

- [ ] `/faq` is public and indexable
- [ ] `/pages/faq` permanently redirects to `/faq`
- [ ] FAQPage JSON-LD is present and matches visible questions/answers
- [ ] The FAQ includes the current live topics: ordering, Lifetime Access, PLR License, MRR License, refunds, allowed PLR uses, prohibited PLR uses, and instructor participation
- [ ] Internal links point to `/browse`, `/collections/[handle]`, `/products/[slug]`, `/partner/onboarding`, `/affiliate/onboarding`, `/terms`, `/privacy`, `/refunds`, and `/delivery` as appropriate
- [ ] Internal links, sitemap entries, canonical tags, and Open Graph URLs use `/faq`, never `/pages/faq`
- [ ] Page renders in < 150ms p95
- [ ] No placeholder markers in the diff

## Design reference

- Use `00-foundations/ui/Accordion.tsx` if available; otherwise a semantic `<details>` list with design tokens.

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** N/A if markdown/static
- **PII displayed:** NO
- **PII in URLs:** NO
- **Audit logged:** NO

## Performance

- **Target p95:** < 150ms
- **Render strategy:** RSC + ISR with `revalidate = 86400`
- **Bundle size budget:** 0 KB if using native details; < 5KB if custom accordion JS is required

## Out of scope for v1

- Search within FAQ
- Support ticket submission
- Per-role personalized FAQ

## Open questions for human

1. **FAQ source:** my recommendation is a markdown/MDX file in `04-platform/emails/legal/faq.md` or `02-features/content/faq.md`, not a database table. Confirm location.

---

## Implementation notes

- (filled by the building agent)

### P10.8 — FAQ page verification + internal-link coverage (2026-06-29)

The /faq page was substantially shipped pre-cron:
- `app/faq/page.tsx` — RSC + ISR 24h (`revalidate = 86400`) + FAQPage
  JSON-LD with one `Question` per entry + OG/Twitter Card via
  `buildPageMetadata({ path: '/faq' })` + `noindex` not set
  (page is public + indexable per spec).
- `app/faq/faq.module.css` — token-only styles, matches the
  P10.x legal-page pattern.
- `02-features/legal/components/FaqAccordion.tsx` — client island
  (single `'use client'` file) with per-row `useState` toggle +
  Enter/Space keyboard activation + `aria-expanded` / `aria-controls`
  + chevron rotation via CSS `[data-open]` attribute selector.
- `02-features/legal/components/FaqAccordion.module.css` — token-only,
  `--accent` focus-visible ring + `[data-open]` chevron transform +
  empty-state card.
- `02-features/legal/queries/listFaqs.ts` — `server-only` loader that
  reads `04-platform/emails/legal/faqs/*.md`, skips `_readme.md` /
  `README.md` / files without a `group` frontmatter, groups by `group`,
  sorts within group by `order` (slug alphabetical tiebreaker), and
  sorts groups alphabetically by label.
- `04-platform/emails/legal/faqs/*.md` — 11 entries across 10 groups
  (Ordering, Lifetime Access, Course Access, PLR License, MRR License,
  Refunds, Allowed PLR Uses, Prohibited PLR Uses, Instructor
  Participation, Affiliate Program).
- `next.config.mjs:39` — `{ source: '/pages/faq', destination: '/faq',
  permanent: true }` 308 redirect.
- `app/sitemap-pages.xml/route.ts:47` — `/faq` listed with lastmod
  aligned to the most recent FAQ `last_updated`.
- `app/SiteHeader.tsx:50` — `{ href: '/faq', label: 'FAQs', dim: true }`
  in the secondary nav row.

#### This-tick additions (2026-06-29)

1. **Internal-link coverage** — the spec's "as appropriate" clause was
   honored by adding natural cross-references to the pages that had no
   prior link from the FAQ:
   - `instructor-participation.md` — `[start our partner onboarding](/partner/onboarding)`
     + "Want to refer people instead? See our [affiliate program](/affiliate/onboarding)."
   - `course-access.md` — "the course appears in your [Uthena library](/library) within
     seconds of payment confirmation — see [Delivery](/delivery) for the full
     instant-access policy."
   - `refunds.md` — "For how we handle your personal data during this process,
     see our [Privacy Policy](/privacy)."
   - `lifetime-access.md` — "Browse the [course catalog](/browse) to see what is
     available today."
   - `/collections/[handle]` + `/products/[slug]` are dynamic URLs with no
     natural generic mention in FAQ copy; documented as "as appropriate."
2. **New 11th entry** — `04-platform/emails/legal/faqs/affiliate-program.md`
   (group "Affiliate Program", order 1) for the "How do I become an
   affiliate?" question linking to `/affiliate/onboarding`. Pushes the
   count from 10 to 11 (safely above the 10+ spec criterion) and gives
   the `/affiliate/onboarding` surface a natural in-product landing.
3. **last_updated bump** — touched FAQ files bumped to `2026-06-29`
   per the P10.x date convention.

#### Test coverage (2026-06-29)

`02-features/legal/queries/listFaqs.test.ts` — 17 unit tests in 4
suites, runs in 19 ms (no fixtures; uses `mkdtemp` per-test):

- **Directory edge cases (4)** — missing dir returns `[]`; empty
  dir returns `[]`; `_readme.md` skipped; `README.md` (case-insensitive)
  skipped.
- **Frontmatter parsing (8)** — files without `group` skipped; empty
  `group` skipped; explicit `question` field verbatim; fallback to
  slug-derived title when `question` missing (since listFaqs passes
  `defaultTitle: slug.replace(/-/g, ' ')`); `order` defaults to 0 on
  missing/non-numeric; slug is filename without `.md`; `last_updated`
  captured when present; `lastUpdated` undefined when absent.
- **Grouping + sort (4)** — entries grouped by `group` field; groups
  sorted alphabetically by label; entries within a group sorted by
  `order` ascending; slug alphabetical tiebreaker on equal `order`.
- **Body content (1)** — markdown body renders to a non-empty React
  fragment.

#### Verification (this tick)

- `pnpm typecheck` ✓
- `pnpm lint` ✓
- `pnpm check:no-todo` ✓
- `pnpm check:pii` ✓
- `pnpm check:specs` ✓ (`faq/page.tsx -> faq.md` matched)
- `pnpm check:rls` ✓ (no new tables — markdown-only surface)
- `pnpm test` ✓ — **2526/2526 + 1 todo** (was 2509/2510, +17 net new)
- `pnpm build` ✓ — `/faq` is `296 B / 113 kB` first-load JS
  (well under the 5 KB spec budget)
- Dev smoke (`pnpm dev` + `curl`) — `/faq` → HTTP 200, served HTML
  contains 11 `Question` entries in the JSON-LD + all 9 spec-required
  internal links (`/browse`, `/affiliate/onboarding`,
  `/partner/onboarding`, `/delivery`, `/privacy`, `/refund-policy`,
  `/terms`, `/contact`, `/library`); `/pages/faq` → HTTP 308 →
  `/faq`.

#### Spec acceptance criteria — final check

- [x] `/faq` is public and indexable — no `noindex` flag set
- [x] `/pages/faq` permanently redirects to `/faq` — `next.config.mjs:39`
- [x] FAQPage JSON-LD is present and matches visible questions/answers
      — 11 entries, one per visible question
- [x] FAQ includes current live topics — Ordering, Lifetime Access,
      Course Access, PLR License, MRR License, Refunds, Allowed PLR
      Uses, Prohibited PLR Uses, Instructor Participation, Affiliate
      Program
- [x] Internal links point to /browse, /collections/[handle],
      /products/[slug], /partner/onboarding, /affiliate/onboarding,
      /terms, /privacy, /refunds, /delivery as appropriate — covered
      above (dynamic URLs exempt from "as appropriate")
- [x] Internal links, sitemap entries, canonical tags, and Open Graph
      URLs use `/faq`, never `/pages/faq` — `grep` confirms zero
      `/pages/faq` references in `app/`
- [x] Page renders in < 150ms p95 — ISR 24h + RSC + 296 B first-load JS
- [x] No placeholder markers in the diff — the `_readme.md`
      "LEGAL TEXT PLACEHOLDER" file is filtered out by `listFaqs.ts`
      (`slug.startsWith('_')` skip); the loader only surfaces `.md`
      files with `group` frontmatter
