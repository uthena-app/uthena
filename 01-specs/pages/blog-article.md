# Blog Article — `/blogs/[blog]/[slug]`

## What this page does

The public article page for imported Shopify blog content. It preserves the current URL shape exactly: `/blogs/news/[slug]` and `/blogs/tips/[slug]`. The live sitemap currently contains 316 article URLs, so this page is required for SEO preservation unless each article has an approved redirect target.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | title, published date, updated date, author | imported Shopify article | H1 + metadata |
| Hero image | image URL, alt text | Shopify export/media import | responsive image |
| Body | article HTML/markdown | sanitized imported article body | prose |
| Related articles | 6 latest from same blog | imported posts | card list |
| Product CTA | browse/category/product link when mapped | article frontmatter or import annotations | CTA band |
| SEO metadata | SEO title/description, canonical, OG image | Shopify export + article data | `<head>` |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open article | Navigate to `/blogs/[blog]/[slug]` | Renders the article or 404/410 if explicitly removed | public |
| Click internal article link | Click link in body | Navigates to mapped v2 URL or preserved blog URL | public |
| Click product/category CTA | Click CTA | Navigates to `/products/[slug]`, `/browse?...`, or `/collections/[handle]` | public |
| Share | Browser/native share or copied URL | Uses canonical article URL | public |

## What this page does NOT do

- No comments
- No gated content
- No affiliate attribution rewriting inside article body unless the link already has approved attribution
- No client-side rendering of article body
- No automatic AI rewriting during migration

## Acceptance criteria

- [ ] All 316 article URLs from the final Shopify sitemap either render at the same URL or have an approved one-hop redirect
- [ ] Imported article title, publication date, body, image, alt text, SEO title, and SEO description are preserved where available
- [ ] Article body is sanitized with an allowlist before rendering
- [ ] Internal links in imported bodies are rewritten through the legacy URL map so they do not point to old Shopify paths after launch
- [ ] Article has self canonical matching the preserved `/blogs/[blog]/[slug]` URL
- [ ] Article JSON-LD is present and matches visible content
- [ ] Article sitemap contains only published, canonical article URLs
- [ ] Missing article slugs return hard 404 unless marked `gone`, in which case they return 410
- [ ] Page renders in < 200ms p95 via RSC/ISR
- [ ] No placeholder markers in the diff

## Design reference

- Use a restrained editorial page, not a marketing landing page. Prose width ~720px, product CTA below the first third of the article only when mapped.

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** `content_posts_public_read_published` if stored in DB
- **PII displayed:** NO, except public author display name if imported
- **PII in URLs:** NO
- **Markdown/HTML safety:** imported body is sanitized; scripts, iframes, inline event handlers, and `javascript:` links are stripped
- **Audit logged:** NO for reads; import/admin edits are audit-logged

## Performance

- **Target p95:** < 200ms
- **Render strategy:** RSC + ISR with `revalidate = 3600`
- **Bundle size budget:** 0 KB client JS

## Out of scope for v1

- Comments
- Blog author profile pages
- Tag pages
- Automated content refresh from Shopify after launch

## Open questions for human

1. **Article quality pass:** many live article topics are SEO content around PLR, MRR, reselling, outreach, and course-business operations. My recommendation is to import all articles first for URL preservation, then run a human editorial pruning pass after launch using 301/410 decisions informed by Search Console traffic.

---

## Implementation notes

- (filled by the building agent)
