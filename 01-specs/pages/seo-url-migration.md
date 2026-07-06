# SEO URL Migration Infrastructure — `/robots.txt`, `/sitemap.xml`, legacy redirects

## What this page does

This is the cross-cutting route contract for preserving search equity during the Shopify to Uthena v2 migration. It owns three public infrastructure surfaces: `robots.txt`, XML sitemap indexes, and legacy URL redirects. Page-specific behavior still lives in the relevant page spec (`product.md`, `catalog.md`, `blog-article.md`, legal pages, etc.); this spec defines the shared rules and launch checks.

Live Shopify baseline captured on 2026-06-16:

| Type | Current pattern | Observed count |
|---|---:|---:|
| Products | `/products/[handle]` | 465 |
| Collections | `/collections/[handle]` | 81 |
| Blog indexes + articles | `/blogs/[blog]`, `/blogs/[blog]/[slug]` | 318 |
| Shopify pages | `/pages/[handle]` | 9 |
| Agent discovery | `/agents.md` | 1 |
| Home | `/` | 1 |

The parent sitemap currently lists 875 URL entries, excluding image sitemap entries. Policies are footer-linked at `/policies/*` but are not in the page sitemap, so they must be included in the redirect audit even though they are not counted above.

## Data this page shows

| Surface | Field | Source | Format |
|---|---|---|---|
| `robots.txt` | allow/disallow rules, sitemap URL | route config | plain text |
| Sitemap index | links to product, browse/category, blog, clean page, policy, and provisional agent-discovery sitemaps | database + static route registry | XML sitemap index |
| Child sitemaps | absolute canonical URLs, `lastmod`, optional image refs | products, categories, blog posts, legal markdown, static route registry | XML |
| Redirect map | `source_path`, `target_path`, `status_code`, `entity_type`, `reason`, `last_verified_at` | Shopify export + approved migration map | server-only lookup |
| Launch report | count of old URLs tested, redirects, 200s, 404s, 410s, chains, loops | crawl script | CI artifact |

**Recommended redirect storage:** generate a versioned redirect manifest from the Shopify export at build time, committed as data or loaded from a table with RLS enabled. The redirect lookup must be exact and allowlisted; it must not generate arbitrary target URLs from request params.

**Canonical route decisions as of 2026-06-16:**

| Surface | Canonical v2 route | Legacy handling |
|---|---|---|
| Products | `/products/[slug]` | Existing `/products/[handle]` stays canonical when the handle is unchanged; variant URLs and collection-product aliases redirect to `/products/[slug]` |
| All-products catalog | `/browse` | `/collections/all` and `/search?q=...` redirect to `/browse` equivalents |
| Category pages | `/collections/[handle]` | Approved category collection handles render canonical category pages |
| Shopify custom pages | clean top-level routes such as `/contact`, `/faq`, `/bundles`, `/data-sharing-opt-out` | `/pages/[handle]` permanently redirects to the approved clean route or business-flow target |
| Policies | `/privacy`, `/terms`, `/refunds`, `/delivery` | `/policies/[handle]` permanently redirects to the matching canonical policy |

**Shopify page redirect map:**

| Legacy Shopify page | Clean v2 target |
|---|---|
| `/pages/contact` | `/contact` |
| `/pages/faq` | `/faq` |
| `/pages/bundles` | `/bundles` |
| `/pages/collection-bundles` | `/bundles` unless `/collection-bundles` is approved as a separate landing page |
| `/pages/data-sharing-opt-out` | `/data-sharing-opt-out` |
| `/pages/instructor-application` | `/instructor-application`, then the partner onboarding flow |
| `/pages/apply-as-instructor` | `/apply-as-instructor`, then the partner onboarding flow |
| `/pages/submit-new-course` | `/submit-new-course`, then the partner upload flow |
| `/pages/update-course` | `/update-course`, then the partner course update flow |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Fetch robots | `GET /robots.txt` | Returns public crawl rules and `Sitemap: https://uthena.com/sitemap.xml` | public |
| Fetch sitemap | `GET /sitemap.xml` | Returns a sitemap index with only canonical sitemap children | public |
| Fetch child sitemap | `GET /sitemap-products.xml`, `/sitemap-blog.xml`, etc. | Returns canonical, indexable URLs only | public |
| Open legacy URL | Visit an old Shopify URL | Permanent redirect, hard 404, or 410 according to approved map | public |
| Run launch crawl | CI or release checklist runs old URL map | Fails if redirect chains, loops, homepage catch-alls, or unexpected 404s exist | release owner |

## What this page does NOT do

- No page rendering for products, categories, blog articles, or legal docs. Those pages own their content.
- No client-side redirects. All legacy redirects are server-side.
- No mass redirect of unknown URLs to the homepage.
- No robots-based hiding of private data. Auth, RLS, noindex, or password protection owns privacy.
- No dynamic sitemap entries for authenticated pages, cart, checkout, account, admin, partner, affiliate dashboards, signed files, or certificate codes.

## Acceptance criteria

- [ ] `robots.txt` allows public marketing, browse, collection, product, blog, legal, FAQ, contact, bundles, clean Shopify-page replacement routes, and provisional agent-discovery routes
- [ ] `robots.txt` disallows admin, account, checkout, orders, library, partner, affiliate dashboards, API internals, signed download paths, and crawl-trap filters
- [ ] `robots.txt` references `https://uthena.com/sitemap.xml`
- [ ] `/sitemap.xml` is a sitemap index, not one oversized flat file
- [ ] Every sitemap URL is absolute, canonical, HTTPS, same-host, indexable, and returns 200
- [ ] Product sitemap includes canonical `/products/[slug]` URLs only
- [ ] Browse/category sitemaps include `/browse` and approved `/collections/[handle]` category URLs; `/marketplace` is not emitted
- [ ] Clean page sitemap entries use top-level URLs such as `/contact` and `/faq`; `/pages/[handle]` is not emitted
- [ ] Blog sitemap preserves `/blogs/[blog]` and `/blogs/[blog]/[slug]` URLs if `blog-index.md` and `blog-article.md` are approved
- [ ] Sort URLs, stacked filters, cart, checkout, account, library, admin, partner, affiliate dashboards, signed URLs, and API URLs are excluded from sitemaps
- [ ] The launch redirect map covers every URL from the final Shopify sitemap export plus footer-linked policies
- [ ] Each legacy URL redirects at most once before reaching a 200 target
- [ ] No legacy URL redirects to `/` unless the old URL was already `/`
- [ ] Removed URLs have explicit `404` or `410` reason in the migration map
- [ ] The launch crawl report is attached to the PR or release checklist
- [ ] Search Console sitemap submission and post-launch URL inspection are included in the release runbook

## Design reference

N/A — infrastructure routes return text/XML or redirects.

## Security

- **Auth required:** NO for `robots.txt`, sitemaps, and public redirects
- **Allowed roles:** public
- **RLS policies that apply:** if redirects are stored in Postgres, `legacy_url_redirects` has public read of source/target/status only, admin write only, and no PII columns
- **PII displayed:** NO
- **PII in URLs:** legacy paths are logged only as paths. Query params are stripped from redirect logs except allowlisted `utm_*` and `ref`
- **Open redirect protection:** redirect targets are fixed relative paths or full `https://uthena.com` URLs from the approved map
- **Audit logged:** admin changes to redirect map are audit-logged; public redirect hits are aggregate metrics only

## Performance

- **Target p95:** redirects < 50ms, `robots.txt` < 50ms, sitemap index < 100ms, child sitemap < 250ms
- **Render strategy:** static or cached server routes
- **Cache:** `robots.txt` and sitemaps cache for 1 hour; redirect manifest can cache in memory for 5 minutes
- **Bundle size budget:** N/A

## Out of scope for v1

- Search Console API automation
- Per-URL redirect hit dashboard
- Dynamic image sitemap for every historical Shopify CDN image
- Hreflang, unless localized URL paths are discovered in the final Shopify export

## Open questions for human

1. **Redirect retention.** My recommendation is indefinite retention for product, collection, blog, page, and policy redirects. One year is the absolute minimum. Confirm indefinite retention.
2. **Redirect storage.** My recommendation is a generated manifest for the launch map plus an admin-editable Postgres table for post-launch corrections. Confirm.
3. **Agent commerce/UCP scope.** The current live site exposes `/agents.md` and `/.well-known/ucp`, but the v2 plan is intentionally undecided. Until approved, the launch requirement is preservation without silent 404: return a read-only discovery document or an explicit deprecation response. Full agent checkout is not assumed.

---

## Implementation notes

- (filled by the building agent)
