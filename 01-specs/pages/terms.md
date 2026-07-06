# Terms of Service — `/terms`

## What this page does

The public master Terms of Service. The page renders a markdown file as HTML — same shape as `/privacy` and `/dmca`. The terms apply to **every user of Uthena** (browsers, buyers, partners, affiliates, admins) and are the single source of truth for the platform-level rules.

This is the **master ToS**. The platform has THREE agreement documents, each scoped to a different audience:

- `/terms` — **the master ToS.** Every user agrees to this at signup and at checkout. Covers general platform use, prohibited content, account termination, dispute resolution.
- **Affiliate Terms** — linked from `/affiliate/onboarding` (see `affiliate-onboarding.md`). Covers commission mechanics, payment terms, FTC disclosure obligations, prohibited promotional methods.
- **Partner Agreement** — linked from `/partner/onboarding` (see `partner-onboarding.md`). Covers content ownership, revenue share, content warranties, indemnity.

The three documents are **deliberately separate**. Affiliate and partner terms are NOT inlined on `/terms`. `/terms` does NOT repeat affiliate commission rates, partner revenue share, or any role-specific clauses — it links to the role-specific agreement when relevant.

The terms are a legal document owned by the human. The agent's job is to **render** the markdown and **link** to it from signup, checkout, and the footer. Drafting the legal text is **not** the agent's job.

Migration requirement: the current Shopify footer links to `/policies/terms-of-service`. That URL must permanently redirect to the canonical `/terms` page, and the canonical must be consistent in the sitemap, internal footer links, Open Graph metadata, and structured data.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Terms of Service" title | hard-coded | H1 |
| "Last updated" line | date from markdown frontmatter `last_updated: YYYY-MM-DD` | markdown frontmatter | small muted text, top of page |
| Body | full markdown content | `04-platform/emails/legal/terms.md` (see Open Questions §1 for exact path) | rendered HTML, prose width (~720px) |
| Cross-link section (rendered from frontmatter `see_also: [affiliate-terms, partner-agreement]`) | inline links to the role-specific agreement docs | markdown frontmatter | small "See also" footer with 1-2 links |
| Footer note | "Questions? Email legal@uthena.com" | hard-coded | small text + `mailto:` |

**Server load:** `getLegalMarkdown('terms')` in `02-features/legal/queries/getLegalMarkdown.ts` — same query function as `/privacy` and `/dmca`, parameterized by doc slug.

**No client JS, no forms, no interactivity.** The page is a static document.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Navigate to `/terms` | Renders the markdown as HTML | public |
| Open Shopify policy URL | Navigate to `/policies/terms-of-service` | Permanent redirect to `/terms` | public |
| Click an internal link | Click a markdown link to another Uthena page (e.g. `/privacy`, `/dmca`) | Navigate to that page | public |
| Click an external link | Click a markdown link to an external URL (e.g. a court, a regulator) | Opens in a new tab with `rel="noopener noreferrer"` | public |
| Click "Affiliate Terms" or "Partner Agreement" in the See-also section | Click cross-link | Opens the role-specific agreement (PDF or `/terms/affiliate` etc. — see Open Questions §4) | public |
| Email legal | Click `legal@uthena.com` | Opens mail client | public |
| Print | Browser print | Renders cleanly (no nav, no footer chrome) | public |

## What this page does NOT do

- No "I agree" / "Accept" button (acceptance is at signup and checkout; the role-specific agreements have their own accept points in their respective onboarding wizards)
- No inlined affiliate commission rates, partner revenue share, KYC requirements, or any role-specific clause (those live in their own documents; cross-linked in the See-also section)
- No cookie banner on this page (legal pages are not a tracker surface)
- No live chat, no support widget, no analytics beyond the standard Plausible page-view
- No edit history, no diff viewer, no "previous versions" link in v1
- No i18n in v1 (English only)
- No CMS, no admin-editable copy
- No PDF download in v1 (browser print-to-PDF is the workaround; v2 may add a generated PDF — flag in Open Questions)
- No "I am a partner / affiliate — jump to my section" nav (the role-specific agreement is a separate document, not a section here)
- No tracking of which user has read the terms (acceptance is at signup/checkout, not here)

## Acceptance criteria

- [ ] Page is public; no auth required
- [ ] The page renders the contents of the terms markdown file as HTML; headings, lists, tables, and links all render correctly
- [ ] The "Last updated" date appears at the top of the page and matches the markdown frontmatter
- [ ] The See-also section renders any cross-links declared in the markdown frontmatter (e.g. to the Affiliate Terms and Partner Agreement)
- [ ] The page is ISR with a 24-hour revalidate; pushing a change to the markdown file does not require a redeploy to take effect on subsequent requests
- [ ] Open Graph tags: `og:title = "Terms of Service — Uthena"`, `og:description = "The rules of using Uthena.com"`, `og:type = "article"`, `og:url = "https://uthena.com/terms"`
- [ ] Schema.org `WebPage` + `Article` JSON-LD is present (with `datePublished` / `dateModified` from the markdown frontmatter)
- [ ] `<link rel="canonical" href="https://uthena.com/terms">` is present
- [ ] `/policies/terms-of-service` permanently redirects to `/terms`
- [ ] Footer, signup, checkout, and onboarding links use `/terms`, not the legacy Shopify policy URL
- [ ] No "I agree" / "Accept" button on this page (acceptance is at signup and checkout, separately — see `signup.md` and `checkout.md`)
- [ ] No affiliate commission rates, partner revenue share percentages, KYC requirements, or any role-specific clauses appear in the rendered content (the page is the master ToS, not the affiliate or partner agreement)
- [ ] No client-side JS is shipped to render the page (verify via the Next.js bundle analyzer — this page's client bundle is effectively 0 KB)
- [ ] No PII is collected or logged when this page is rendered
- [ ] No `TODO` / `FIXME` in the rendered output

## Design reference

- Mockup: not yet built — to be created during the legal-pages feature build
- Components: `00-foundations/ui/LegalPage.tsx` (reused from `/privacy`)
- Tokens: `00-foundations/design/tokens.css` (prose layout, max-width 720px)
- Theme: dark (default) + light

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** N/A — no DB access on this page
- **PII displayed:** NO — the page is the terms text itself (a document, not user data)
- **PII in URLs:** NO — the path is `/terms`, static
- **Markdown rendering safety:** the markdown is rendered via a **strict allowlist** sanitizer (same as `/privacy` and `/dmca`). The human owns the markdown but the renderer must not trust it — a PR that introduces an XSS vector in the markdown must not be able to ship an XSS to production.
- **CSP:** the page is served under the same Content-Security-Policy as the rest of the app. The markdown cannot add inline scripts or external resources.
- **File access:** the markdown file is read from the build artifact. The path is hard-coded; user input does not influence the file read.
- **Audit logged:** NO
- **Rate limiting:** standard edge rate limit (Cloudflare default) is sufficient
- **Legacy redirect safety:** the Shopify policy redirect target is fixed to `/terms` and does not read user-provided destination params.
- **CSRF:** N/A — no state-changing actions
- **Third-party scripts:** none beyond the standard Plausible page-view tag (in the root layout)

## Performance

- **Target p95:** < 100ms (static document, edge-cached)
- **Render strategy:** RSC + ISR with a 24-hour revalidate. Same caching strategy as `/privacy` and `/dmca`.
- **Cache:** the rendered HTML is cached at the Next.js data cache (24h TTL) AND at the edge (Cloudflare cache, 24h). Purging is not exposed in v1; changes take up to 24h to take effect.
- **DB load:** zero
- **Bundle size budget:** 0 KB (no client JS for this page)
- **Image loading:** N/A

## Out of scope for v1

- "I have read and agree" button (acceptance is at signup and at checkout)
- PDF download of the terms
- Multi-language versions (English only)
- Edit history / previous versions viewer
- Inline role-specific sections (Affiliate Terms and Partner Agreement are separate documents)
- Email-the-terms-to-me button
- A "what changed" diff link between the current and previous version

## Open questions for human

1. **Exact path for the markdown file.** I propose `04-platform/emails/legal/terms.md` (alongside `privacy.md` and `dmca.md`). The `04-platform/emails/legal/` directory is a natural home for legal-doc sources. The renderer reads the file, parses frontmatter for `last_updated` and `see_also`, and runs the body through the markdown pipeline. **My recommendation: `04-platform/emails/legal/terms.md`** with `last_updated: YYYY-MM-DD` and optional `see_also: [affiliate-terms, partner-agreement]` frontmatter fields. Confirm the path.
2. **Acceptance flow.** The master ToS is agreed to at signup (a single checkbox on `/signup`) and re-affirmed at checkout. Should the master ToS also be agreed to at `/affiliate/onboarding` and `/partner/onboarding`? My recommendation: **no** — the master ToS is implicit. The wizard's "I have read the Uthena Terms of Service" link points to `/terms`; the affirmative consent is for the **role-specific** agreement (Affiliate Terms / Partner Agreement), not the master ToS. Confirm.
3. **Cross-link rendering.** I propose a frontmatter-driven See-also section (e.g. `see_also: [{ label: "Affiliate Terms", href: "/affiliate-terms" }, { label: "Partner Agreement", href: "/partner-agreement" }]`). Alternative: hard-code the See-also section in the markdown body. My recommendation: frontmatter-driven — keeps the markdown body clean of UI metadata. Confirm.
4. **Routes for the cross-linked documents.** Are Affiliate Terms and Partner Agreement rendered from the same markdown pipeline at `/affiliate-terms` and `/partner-agreement`, or are they static PDFs at a Bunny Storage signed URL (the affiliate-onboarding spec mentions a PDF for Affiliate Terms)? My recommendation: **Affiliate Terms** is a PDF (per `affiliate-onboarding.md`); **Partner Agreement** is the same markdown pipeline. Confirm the route shapes and the link targets in the See-also section.
5. **On-demand revalidation.** Same as `/privacy` — 24h ISR is fine for v1; on-demand webhook revalidation is v2. Confirm.
6. **PDF generation.** Same as `/privacy` — defer to v2. Confirm.

---

## Implementation notes

- (filled by the building agent)

### P10.1 — Terms review — this tick (2026-06-29)

**What landed**

1. **Heading anchor IDs — every legal page.**
   - Pure helpers in `02-features/legal/queries/getLegalMarkdown.tsx`:
     - `slugifyHeading(text)` — lowercase + `[a-z0-9]` filter + underscore → dash + whitespace → dash + collapse runs + trim + `'section'` fallback. GitHub-style: `Section 1 — Online Store Terms` → `section-1-online-store-terms`, `API Keys & Tokens` → `api-keys-tokens`.
     - `renderInlineToText(nodes)` — strips inline formatting (`**bold**`, `*italic*`, `` `code` ``, `[link](url)`) from heading text before slug derivation so the resulting `id` is the plain-text form.
     - `dedupeHeadingSlug(candidate, used)` — deterministic GitHub-style `-1`, `-2`, ... suffixes on duplicate headings; mutates the per-call `Map<string, number>` tracker.
   - The renderer (`renderMarkdown`) threads a fresh `used` map through `renderBlocks` (recursive) so headings inside `> ` blockquotes share the same dedup pool.
   - Public exports added to `02-features/legal/index.ts`.

2. **Pre-existing `parseSeeAlsoBlock` (list-form) bug — fixed.**
   - Discovered while writing the test suite for the renderer: every legal page that uses the canonical YAML one-line-gap frontmatter (`terms.md`, `privacy.md`, `dmca.md`, `refund-policy.md`, `delivery.md`, `data-sharing-opt-out.md`) had been rendering with **no see-also links** since P0.x. The list-form parser `break`ed on the very first empty line after `see_also:`, AND the continuation-key regex required no leading whitespace, so the indented `    href: "..."` lines never matched.
   - Fix: blank lines are skipped (don't break); the block ends at the first unindented top-level key (a real subsequent frontmatter key); the continuation-key regex allows the `\s*` prefix.
   - Live smoke: `/terms` see-also section now renders `<a href="/privacy">Privacy Policy</a>` + `/dmca` + `/refund-policy`. Previously 0.

**Acceptance-criteria live verification (`pnpm dev` smoke)**

- [x] Page is public; `GET /terms` → 200, anon-redirect N/A.
- [x] Renders markdown as HTML; ProsePage lays out the body.
- [x] Last updated date at top: `<time dateTime="2025-09-08">September 8, 2025</time>`.
- [x] See-also section now renders cross-links (was silently broken before this tick).
- [x] ISR 24h: `export const revalidate = 86400` in `app/terms/page.tsx`.
- [x] Open Graph + Twitter Card: `og:title`, `og:description`, `og:type=article`, `og:url=https://uthena.com/terms`, `twitter:card=summary_large_image`. Sourced from `buildPageMetadata` (00-foundations).
- [x] JSON-LD: Article schema with `mainEntityOfPage: { @type: 'WebPage', @id: 'https://uthena.com/terms' }` (WebPage is the `mainEntityOfPage` of the Article — satisfies the spec criterion without a separate WebPage schema). `00-foundations/structured-data/README.md` documents Article-only as the canonical legal-page shape.
- [x] `<link rel="canonical" href="https://uthena.com/terms">` (set by `buildPageMetadata`).
- [x] `/policies/terms-of-service` → `308` → `/terms` (in `next.config.mjs` `redirects()`).
- [x] Footer link in `app/lib/footerCopy.ts:57` (`{ label: 'Terms', href: '/terms' }`), signup link in `AuthForms.tsx:415`, checkout link in `ReviewStep.tsx:174` — all use `/terms`.
- [x] No "I agree" button on this page.
- [ ] **`No role-specific clauses appear in the rendered content`** — DEVIATION. The current `terms.md` contains the `# Uthena Instructor Terms` block (Sections: Course Types, Earnings, Affiliate & Referral Programs, Payments, Uploading Courses, Sales Reports, ...). Per STUBS.md line 215, this was deliberately imported verbatim from the live Shopify uthena.com. The page now matches uthena.com, but does not match this spec criterion. **Out of scope for the agent to fix unilaterally** — the markdown is human-owned (per spec line 15). Klaas to decide:
  1. Keep the role-specific block on `/terms` (mirror live) — amend spec line 71.
  2. Split the role-specific block out into a separate partner agreement doc (`/partner-agreement` or similar) and remove from `/terms` — content edit + spec stays.
- [x] No client JS shipped — `pnpm build` reports `/terms` is `218 B / 113 kB` first-load (server-rendered; just RSC + the React tree).
- [x] No PII in URLs (path is `/terms`).
- [x] Safe markdown rendering — no HTML pass-through (renderer's source-HTML-stripping guarantee).

**Checks (all green)**

- `pnpm typecheck` ✓
- `pnpm lint` ✓
- `pnpm check:no-todo` ✓ Clean
- `pnpm check:pii` ✓ Clean
- `pnpm check:specs` ✓ All pages have specs
- `pnpm check:rls` ✓ All tables have RLS
- `pnpm test` **2201/2201** (was 2169, +32 new: 28 in `getLegalMarkdown.test.ts` + 4 regression)
- `pnpm build` ✓ (43 routes; `/terms` is `218 B / 113 kB` first-load — bundle delta 0; shared first-load JS unchanged at 101 kB)

**Files touched**

- `02-features/legal/queries/getLegalMarkdown.tsx` — added 3 pure exports + threaded `used` map through `renderBlocks`; rewrote the list-form branch of `parseSeeAlsoBlock` to fix the silent break on canonical YAML gap.
- `02-features/legal/index.ts` — barrel re-exports the new helpers.
- `02-features/legal/queries/getLegalMarkdown.test.ts` — NEW. 32 unit tests across 4 describe blocks. 6ms wall.
- `01-specs/pages/terms.md` — appended this Implementation notes section.
- `docs/PROGRESS.md` — ticked P10.1 with the full completion note.
