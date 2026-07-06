# Blog Index — `/blogs/[blog]`

## What this page does

The public blog index for a content pillar, preserving the current Shopify blog index URLs `/blogs/news` and `/blogs/tips`. It lists published articles in that blog, newest first, with title, excerpt, image, date, and category/pillar metadata. This page exists primarily for SEO preservation and internal discovery of PLR education content.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | blog title, description, canonical URL | imported Shopify blog metadata | H1 + intro |
| Article list | `title`, `slug`, `excerpt`, `featured_image_url`, `published_at`, `updated_at`, `author_name` | imported blog posts | cards/list |
| Pagination | page number, total pages | query result | links |
| SEO metadata | title, description, canonical, OG image | blog metadata | `<head>` |

**Data source:** Shopify blog export imported into a v2 content store before launch. If stored in Postgres, RLS allows public read of `status='published'` posts and admin-only writes.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open index | Navigate to `/blogs/news` or `/blogs/tips` | Renders the blog index | public |
| Open article | Click an article card | Navigate to `/blogs/[blog]/[slug]` | public |
| Change page | Click pagination | Navigate to `?page=N`; page 1 canonicalizes to the bare index | public |

## What this page does NOT do

- No comments
- No author profile pages
- No tag archive pages unless present in the final Shopify export
- No newsletter modal
- No client-side article fetching

## Acceptance criteria

- [ ] `/blogs/news` and `/blogs/tips` return 200 and keep those paths as canonical
- [ ] The blog sitemap includes both blog index URLs
- [ ] Article links preserve current `/blogs/[blog]/[slug]` paths
- [ ] Pagination links are crawlable anchors
- [ ] Page 1 has a self canonical; page 2+ canonical policy is explicit and consistent with sitemap exclusion
- [ ] Open Graph and `Blog`/`CollectionPage` JSON-LD are present
- [ ] Empty blog state returns 404 only if the blog handle is not in the approved import list
- [ ] Page renders in < 200ms p95 via RSC/ISR
- [ ] No placeholder markers in the diff

## Design reference

- Use the legal/content prose rhythm from `mockups/home.html` and marketplace card density from `mockups/browse.html`.

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** `content_posts_public_read_published` if stored in DB
- **PII displayed:** NO
- **PII in URLs:** NO
- **Audit logged:** NO for reads; admin edits are audit-logged

## Performance

- **Target p95:** < 200ms
- **Render strategy:** RSC + ISR with `revalidate = 3600`
- **Bundle size budget:** 0 KB client JS

## Out of scope for v1

- Blog search beyond browse/global search
- Comments and reactions
- Author profile routes
- Related product personalization

## Open questions for human

1. **Content owner:** should blog content be managed as markdown in git or imported into Postgres/admin? My recommendation: import static markdown or MDX from Shopify export for v1. Add admin editing in a separate approved spec if the blog remains active.

---

## Implementation notes

- (filled by the building agent)
