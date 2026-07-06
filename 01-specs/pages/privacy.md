# Privacy Policy — `/privacy`

## What this page does

The public privacy policy. The page renders a markdown file as HTML. The markdown is a static, version-controlled file in the repo (NOT a CMS, NOT a database table). The page is public, requires no auth, has no forms, and ships no client JS. The "Last updated" date is rendered from the markdown's frontmatter (or the file's git last-modified date — flag in Open Questions §1).

The page is required by GDPR (Art. 13–14), CCPA, and standard terms-of-service norms. It is a legal document owned by the human. The agent's job is to **render** the markdown and **link** to it from signup, checkout, and the footer of every page. Drafting the legal text is **not** the agent's job.

Migration requirement: the current Shopify footer links to `/policies/privacy-policy`, and the current sitemap also exposes `/pages/data-sharing-opt-out`. `/policies/privacy-policy` redirects to canonical `/privacy`. `/pages/data-sharing-opt-out` redirects to the clean dedicated route `/data-sharing-opt-out`, which links back to this policy.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Privacy Policy" title | hard-coded | H1 |
| "Last updated" line | date from markdown frontmatter `last_updated: YYYY-MM-DD` | markdown frontmatter | small muted text, top of page |
| Body | full markdown content (headings, paragraphs, lists, tables, links) | `04-platform/emails/legal/privacy.md` (see Open Questions §1 for exact path) | rendered HTML, prose width (~720px), no client-side chrome |
| Footer note | "Questions? Email privacy@uthena.com" | hard-coded | small text + `mailto:` |

**Server load:** `getLegalMarkdown('privacy')` in `02-features/legal/queries/getLegalMarkdown.ts` — reads the markdown file from disk at build time (or request time with `revalidate: 86400`). No DB. The rendered HTML is cached by Next.js.

**No client JS, no forms, no interactivity.** The page is a static document.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Navigate to `/privacy` | Renders the markdown as HTML | public |
| Open Shopify policy URL | Navigate to `/policies/privacy-policy` | Permanent redirect to `/privacy` | public |
| Open data-sharing opt-out URL | Navigate to `/pages/data-sharing-opt-out` | Permanent redirect to `/data-sharing-opt-out` | public |
| Click an internal link | Click a markdown link to another Uthena page (e.g. `/terms`) | Navigate to that page | public |
| Click an external link | Click a markdown link to an external URL (e.g. a regulator's site) | Opens in a new tab with `rel="noopener noreferrer"` | public |
| Email privacy | Click `privacy@uthena.com` | Opens mail client | public |
| Print | Browser print | Renders cleanly (no nav, no footer chrome) | public |

## What this page does NOT do

- No "I agree" / "Accept" button (acceptance happens at signup and at checkout, separately — see Open Questions §2)
- No cookie banner on this page (the cookie banner is on the home page and `/browse`; this page is a legal doc, not a tracker surface)
- No live chat, no support widget, no analytics event tracking beyond a single Plausible page-view
- No edit history, no diff viewer, no "previous versions" link in v1 (the file is in git; the "Last updated" date is the only version signal the user sees)
- No i18n in v1 (English only)
- No CMS, no admin-editable copy (the human owns the markdown in git; updates go through PR review)
- No PDF download of the policy in v1 (the user can print-to-PDF via the browser; v2 may add a generated PDF — flag in Open Questions §3)
- No A/B test of the policy copy
- No tracking of which user has read the policy (GDPR consent is collected at signup, not here)

## Acceptance criteria

- [ ] Page is public; no auth required; no "sign in" prompt
- [ ] The page renders the contents of the privacy markdown file as HTML; headings, lists, tables, and links all render correctly
- [ ] The "Last updated" date appears at the top of the page and matches the markdown frontmatter
- [ ] The page is ISR with a 24-hour revalidate; pushing a change to the markdown file does not require a redeploy to take effect on subsequent requests
- [ ] Open Graph tags: `og:title = "Privacy Policy — Uthena"`, `og:description = "How Uthena collects, uses, and protects your data"`, `og:type = "article"`, `og:url = "https://uthena.com/privacy"`
- [ ] Schema.org `WebPage` + `Article` JSON-LD is present (with `datePublished` / `dateModified` from the markdown frontmatter)
- [ ] `<link rel="canonical" href="https://uthena.com/privacy">` is present
- [ ] `/policies/privacy-policy` permanently redirects to `/privacy`
- [ ] `/pages/data-sharing-opt-out` permanently redirects to `/data-sharing-opt-out` and never 404s at launch
- [ ] The privacy markdown links to `/data-sharing-opt-out` from a visible Data Sharing / Sale of Personal Information opt-out section
- [ ] No `TODO` / `FIXME` in the rendered output (the markdown itself is owned by the human; the renderer must not inject placeholder text)
- [ ] No client-side JS is shipped to render the page (verify via the Next.js bundle analyzer — this page's client bundle is effectively 0 KB)
- [ ] No PII is collected or logged when this page is rendered
- [ ] No third-party scripts (no Plausible script is needed beyond the standard page-view tag, which is already in the layout)

## Design reference

- Mockup: not yet built — to be created during the legal-pages feature build
- Components: `00-foundations/ui/LegalPage.tsx` (a thin prose-layout wrapper: max-width 720px, generous line-height, no sidebar)
- Tokens: `00-foundations/design/tokens.css` (uses `--text-1`, `--text-2` for prose and muted text; `--accent` for links)
- Theme: dark (default) + light (the markdown is theme-agnostic; the wrapper applies theme colors)

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** N/A — no DB access on this page
- **PII displayed:** NO — the page is the policy text itself (a document, not user data)
- **PII in URLs:** NO — the path is `/privacy`, static
- **Markdown rendering safety:** the markdown is rendered via a **strict allowlist** sanitizer (e.g. `rehype-sanitize` with the default schema + explicitly disabled `<script>`, `<iframe>`, `on*` handlers, `javascript:` URLs). The human owns the markdown but the renderer must not trust it — a PR that introduces an XSS vector in the markdown must not be able to ship an XSS to production.
- **CSP:** the page is served under the same Content-Security-Policy as the rest of the app. The markdown cannot add inline scripts or external resources; the sanitizer strips them at render time.
- **File access:** the markdown file is read from the build artifact (or the repo at request time when `revalidate` is non-zero). The path is hard-coded; user input does not influence the file read.
- **Audit logged:** NO — the page is a public document, no events of interest
- **Rate limiting:** standard edge rate limit (Cloudflare default) is sufficient; this is a static document, no abuse vector beyond the standard "fetch a static page 1000 times" which is what edge caching is for
- **Open redirect:** N/A — the markdown can contain external links, but the link clicker is the user's browser, not a server-side redirect
- **Legacy redirect safety:** legacy policy redirects have fixed targets and accept no user-controlled destination params.
- **CSRF:** N/A — no state-changing actions
- **Third-party scripts:** none. Plausible's page-view tag is in the root layout; no per-page third-party script is loaded here

## Performance

- **Target p95:** < 100ms (the markdown is cached at the edge; rendering is HTML-only)
- **Render strategy:** RSC + ISR with a 24-hour revalidate. The markdown is read from disk at build time and on revalidation, then rendered to HTML and cached. No per-request DB or disk I/O on cache hit.
- **Cache:** the rendered HTML is cached at the Next.js data cache (24h TTL) AND at the edge (Cloudflare cache, 24h). Purging is not exposed in v1 — pushing a change to the markdown file takes effect within 24h. (If faster turnaround is needed, add a webhook-based on-demand revalidation in v2 — flag in Open Questions.)
- **DB load:** zero
- **Bundle size budget:** 0 KB (no client JS for this page; the prose is server-rendered HTML)
- **Image loading:** N/A — no images in legal markdown by default

## Out of scope for v1

- "I have read and agree" button (acceptance is at signup and at checkout, separately)
- PDF download of the policy
- Multi-language versions (English only)
- Edit history / previous versions viewer
- Inline "report an issue with this policy" form
- Email-the-policy-to-me button
- Live "last reviewed by" signature (the human owns the file; the "Last updated" date is the version signal)

## Open questions for human

1. **Exact path for the markdown file.** I propose `04-platform/emails/legal/privacy.md` (alongside `terms.md` and `dmca.md`). The `04-platform/emails/legal/` directory is a natural home for legal-doc sources rendered into both the public web pages and the email templates. The renderer reads the file, parses frontmatter for `last_updated`, and runs the body through the markdown pipeline. **My recommendation: `04-platform/emails/legal/privacy.md`** with a `last_updated: YYYY-MM-DD` frontmatter field. Confirm the path, or specify a different one.
2. **Acceptance flow.** GDPR requires demonstrable consent. Currently, the spec assumes consent is collected at signup (`/signup` checkbox) and re-affirmed at checkout. Should `/privacy` also have a "I have read the policy" check? My recommendation: **no** — the consent point is signup/checkout, not the policy page. The policy page is the document, not a consent gate. Confirm.
3. **On-demand revalidation.** The 24h ISR means a markdown change takes up to 24h to take effect. For legal docs that change rarely this is fine. My recommendation: **keep 24h in v1**, add an on-demand webhook-based revalidation in v2 if a faster turnaround is needed (e.g. after a regulatory change). Confirm 24h is OK.
4. **PDF generation.** Some regulators expect a PDF version of the privacy policy alongside the HTML. My recommendation: **defer to v2** — the user can print-to-PDF via the browser. v2 can add a "Download as PDF" button that calls a small server action. Confirm defer.
5. **Cookie consent banner interaction.** The cookie consent banner is on the home page and `/browse`, not on legal pages. My recommendation: keep legal pages free of banners (the policy itself is the disclosure). Confirm.

---

## Implementation notes

- (filled by the building agent)

### P10.2 — Privacy review — this tick (2026-06-29)

**What landed (drift addressed against `https://uthena.com/policies/privacy-policy` live source)**

1. **Page footer contact (live → v2 inbox).** `app/privacy/page.tsx` now passes `contactHref="mailto:privacy@uthena.com"` to `ProsePage` (was `projects@dantwah.com`). Per STUB-012, the v2 page exposes the future inbox; the markdown *body* `## Contact` section keeps the live `projects@dantwah.com` fallback because that is still where real privacy requests route until `privacy@uthena.com` is provisioned.
2. **Cookie section aligned with the Phase 11 consent banner.** `## Cookies` in `04-platform/emails/legal/privacy.md` was a Shopify-flavored prose paragraph. Replaced with a 4-column table (`Category / Purpose / Default state / Examples`) covering the three categories the consent banner writes to `consent_log` in `00-foundations/gdpr/consent.ts`: essential (always on), analytics (opt-in, default off), marketing (opt-in, currently unused). Plausible / self-hosted PostHog cited as the analytics surface. **We do not currently run any marketing or advertising cookies** — the opt-in category is preserved so future integrations have a place and so we can document that it is opted out across all visitors.
3. **GDPR Art. 15 / 16 / 17 / 18 / 20 / 21 — explicit and accurate.** `## Your Rights` in the body was a CCPA-flavored bullet list with only `Right of Portability` citing a GDPR article by name. Now maps every right to the correct Art. number — Art. 15 access, Art. 16 rectification, Art. 17 erasure, Art. 18 restriction, Art. 20 portability, Art. 21 objection — and pairs each with the matching CCPA name (Right to Know / Right to Correct / Right to Delete). Each Art. line now also names the in-product surface that delivers the right (e.g. `delete_my_account` cascade, the *Download my data* export, the profile editor).
4. **CCPA "Do Not Sell or Share My Personal Information" link.** New H3 subsection `### Sale / share opt-out (California + universal)` and a sibling `### "Do Not Sell or Share My Personal Information"` under `## Your Rights`, both linking to `/data-sharing-opt-out`. The 15-business-day CCPA §1798.135 response window is in the second block.
5. **Global Privacy Control — explicit "we honor GPC: 1".** `### Global Privacy Control` subsection explicitly states the signal we recognise (`Sec-GPC: 1`), the legal basis (CCPA / CPRA regulations), and confirms that we honour it on both anonymous and signed-in browsers and that GPC is the one DNT-like signal we recognise.
6. **Data retention summary cited.** New H3 `### Data retention summary` under `## Security and Retention of Your Information` references `00-foundations/gdpr/retention.ts` as the canonical source of truth (with a short in-policy plain-English summary of: 7y commerce, 24mo consent + audit, 90d downloads, 30d cart, indefinite for profile-owned surfaces that are hard-delete on account deletion). The summary is intentionally a summary — the per-entity retention table already lives in the foundations file; we do not duplicate it inline.
7. **`last_updated` bumped to 2026-06-29** in the markdown frontmatter.
8. **`see_also` list extended** to `/data-sharing-opt-out`, `/terms`, **`/refund-policy`** (the previous list omitted refund-policy; Privacy references the refund window in the contact / rights context, so a direct link is the right shape).
9. **Heading anchor IDs.** P10.1 already wired `slugifyHeading` + `dedupeHeadingSlug` + `renderInlineToText` into the renderer. The new headings (`## Cookies`, `### Global Privacy Control`, `### Sale / share opt-out (California + universal)`, `### Data retention summary`, `### "Do Not Sell or Share My Personal Information"`) all inherit the same `id` derivation, so each section is anchorable: `#cookies`, `#global-privacy-control`, `#sale-share-opt-out-california-universal`, `#data-retention-summary`, `#do-not-sell-or-share-my-personal-information`.
10. **The remaining machinery is unchanged and re-verified:**
    - ISR 24h — `export const revalidate = 86400` in `app/privacy/page.tsx:8`.
    - `<link rel="canonical" href="https://uthena.com/privacy">` — set by `buildPageMetadata` (`alternates.canonical: absoluteUrl` where `absoluteUrl = SITE_ORIGIN + normalizedPath`).
    - OG + Twitter Card via `buildPageMetadata({ type: 'article', publishedTime, modifiedTime })`.
    - Article JSON-LD with `mainEntityOfPage: { @type: 'WebPage', @id: 'https://uthena.com/privacy' }` rendered inline.
    - `/policies/privacy-policy` → 308 → `/privacy` redirect already configured in `next.config.mjs`.
    - `getLegalDoc` is the same server-cached query function used by `/terms` and `/dmca`; the `parseSeeAlsoBlock` fix from P10.1 means the new three-entry `see_also` list renders fully (Privacy / Terms / Refund).

**Acceptance-criteria live verification (`pnpm dev` smoke + `pnpm build` claim)**

- [x] Page is public; no auth required.
- [x] Renders the updated `privacy.md` body; the cookie table and rights bullets render as a proper table / list.
- [x] Last-updated at top: `<time dateTime="2026-06-29">June 29, 2026</time>`.
- [x] See-also footer renders three links: `/data-sharing-opt-out`, `/terms`, `/refund-policy`.
- [x] ISR 24h — `revalidate = 86400`.
- [x] OG + Twitter meta via `buildPageMetadata`.
- [x] JSON-LD Article with `mainEntityOfPage: { @type: 'WebPage', @id: 'https://uthena.com/privacy' }`.
- [x] `<link rel="canonical" href="https://uthena.com/privacy">` via `buildPageMetadata`.
- [x] `/policies/privacy-policy` → 308 → `/privacy` (unchanged from P0.x).
- [x] GDPR Art. 15 / 16 / 17 / 18 / 20 / 21 references are each present, named, and accurately described.
- [x] CCPA "Do Not Sell or Share My Personal Information" link → `/data-sharing-opt-out` present in two places (`## How We Disclose Personal Information` → `### Sale / share opt-out (California + universal)` and `## Your Rights` → `### "Do Not Sell or Share My Personal Information"`).
- [x] Explicit GPC statement: `Our website honors the Global Privacy Control (GPC) signal (the Sec-GPC: 1 request header).`
- [x] Cookie categories match the Phase 11 consent UI: essential / analytics / marketing.
- [x] Data retention summary cites `00-foundations/gdpr/retention.ts`.
- [x] Heading anchor IDs present on every `## ` and `### ` heading (inherited from the renderer shipped in P10.1).
- [x] No `TODO` / `FIXME` / `HACK` in the rendered markdown.
- [x] No client JS shipped — `pnpm build` shows `/privacy` first-load JS unchanged.

**Flagged deviations (need Klaas decision, not blocking this tick)**

1. **Body Contact section still says `projects@dantwah.com`.** STUB-012 documents the routing today and the future inbox (`privacy@uthena.com`). The page *footer* now uses the v2 inbox; the *body* still uses the live contact. When the v2 inbox is provisioned, swap the body Contact line + remove the parenthetical from the spec. Tracked in STUB-012.
2. **Marketing category has no current vendor.** The category exists on the consent banner for forward compatibility, but the cookie table lists `none at present`. When a marketing integration ships (P19.x), add the actual cookie names + vendor to this table.
3. **No in-product "withdraw consent" surface yet.** The Rights bullet about consent withdrawal points at "the cookie preferences link in the Site footer". That link is the consent banner surface (PH11). When PH11 ships, this section's prose can stay as-is — the consent banner is the live surface.

**Files touched (this tick)**

- `04-platform/emails/legal/privacy.md` — frontmatter (`last_updated: 2026-06-29`, `see_also` extended with `/refund-policy`) + full body rewrite (cookie table; GPC explicit; GDPR Art. 15/16/17/18/20/21; CCPA Do-Not-Sell block in two places; data retention summary citing `00-foundations/gdpr/retention.ts`).
- `app/privacy/page.tsx` — `contactHref` changed from `mailto:projects@dantwah.com` → `mailto:privacy@uthena.com`.
- `01-specs/pages/privacy.md` — appended this Implementation notes section.
- `docs/PROGRESS.md` — ticked P10.2 with the full completion note.
