# Home — `/`

## What this page does

The marketing homepage. Anonymous visitors land here, understand what Uthena is in 5 seconds, and find the right path in 15 more — browse the catalog, become a partner, or join the affiliate program.

Three pillars (Marketplace, Platform, Toolbox) are surfaced at the top of the page, just below the hero. Below them, a stat strip builds credibility, then the top sellers grid drives browse/category traffic, then a "How it works" 3-step section, then a side-by-side "Earn with Uthena" card (creators + affiliates), then a testimonial, then a final CTA.

Migration requirement: the current homepage is the strongest internal-link source for products, categories, FAQ, policies, affiliate program, instructor sign-up, course portal, reviews, newsletter, and recent blog articles. V2 must preserve these navigational intents even when their target routes change.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Hero | Eyebrow tag text | Hard-coded "v2 — Now in private beta" | text |
| Hero | Headline | Hard-coded | text |
| Hero | Sub-headline | Hard-coded | text |
| Top sellers grid | `title`, `slug`, `short_description`, `thumbnail_url`, `price_cents`, `category.name`, `rating_avg`, `sales_count` | `getTopSellers(limit: 8)` server query | card grid |
| Top sellers | "Featured" / "Hot" / "New" badge | derived from `sales_count` thresholds + `published_at` recency | badge |
| Category strip | `name`, `slug`, `product_count` | `getCategoriesWithCounts()` | text links |
| Stat strip | Dynamic published product count, 100+ partners, $24M+ resold, 4.8/5 | `getPublicProductStats()` with cached fallback | text |
| Testimonial | Body, author name, role, optional product context | `getFeaturedTestimonial()` or hard-coded | card |
| Earn card (creators) | 60%, list of benefits | Hard-coded | text |
| Earn card (affiliates) | 20%, list of benefits | Hard-coded | text |
| FAQ teaser | 4-6 high-intent FAQs or link to `/faq` | legal/support markdown or hard-coded | accordion or link list |
| Footer links | browse/catalog, collections, bundles, FAQ, contact, privacy, terms, refunds, delivery, affiliate, partner, library/course portal | hard-coded route map | footer nav |
| Newsletter opt-in | email, consent copy, list name | `notification_preferences` / email provider | form in footer or dedicated band |

`getTopSellers` and `getCategoriesWithCounts` are server queries in `02-features/catalog/queries/`. They hit published products ordered by sales_count desc, cached in memory for 60s.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Search products | Click search bar, type, press Enter | Navigate to `/browse?q=...` | public |
| Browse catalog | Click "Browse catalog" CTA in hero | Navigate to `/browse` | public |
| Become a partner | Click "Become a partner" CTA | Navigate to `/partner/onboarding` (requires auth, redirects to `/signup?next=/partner/onboarding` if anon) | public CTA, action requires auth |
| Join affiliate program | Click "Join affiliate program" in earn card | Navigate to `/affiliate/onboarding` (same auth flow) | public CTA, action requires auth |
| Open legacy affiliate register URL | Visit `affiliate.uthena.com/register` | Redirect to `/affiliate/onboarding` after DNS cutover, preserving attribution params where safe | public |
| Open legacy instructor URLs | Visit `affiliate.uthena.com/register/become-instructor`, `portal.uthena.com/signup`, `/pages/instructor-application`, or `/pages/apply-as-instructor` | Redirect to `/partner/onboarding` | public |
| Click category | Click any category in the strip | Navigate to `/collections/[slug]` | public |
| Click product card | Click any card in the top sellers grid | Navigate to `/products/[slug]` | public |
| Open course portal | Click "Course Portal" or visit `courses.uthena.com` | Redirect to `/library` with auth flow handled by `library.md` | public CTA, auth for library |
| View mini-shop | Click "Your mini-shop" in footer (only if logged in as affiliate) | Navigate to `/[handle]` | affiliate |
| Sign in | Click "Sign in" in nav | Navigate to `/login` | public |
| Sign up | Click "Get started" in nav | Navigate to `/signup` | public |
| Talk to sales | Click "Talk to sales" in hero | Opens `mailto:sales@uthena.com` (or Calendly link, TBD) | public |

## What this page does NOT do

- No product search results inline (search is a nav bar that goes to `/browse?q=...`)
- No featured instructor profiles (separate page if/when added)
- No full blog feed on the homepage (recent article links are allowed only as lightweight content navigation)
- No live stats ("127 people viewing") — that's browse/catalog behavior, not home
- No recently-viewed (no auth context on this page)

## Acceptance criteria

- [ ] Page renders in < 200ms p95 (ISR with 60s revalidate)
- [ ] All 8 top-seller cards render with real product data (not mocked)
- [ ] "Browse catalog" CTA navigates to `/browse` correctly
- [ ] All category strip links navigate to canonical `/collections/[slug]` category pages
- [ ] The public product count is dynamic from published products or a cached stats query; it is not hard-coded to 465, 600+, or 612
- [ ] Hero CTA "Become a partner" works for both anon (redirects to signup) and logged-in (goes to /partner/onboarding)
- [ ] Header and footer include working replacements for the current live nav intents: all courses, bundles, earn with Uthena, FAQ, course portal/library, affiliate program, partner/instructor onboarding, search, cart, policies
- [ ] Footer links preserve current policy/support targets or redirect them: privacy, terms, refunds, delivery/shipping, contact, FAQ
- [ ] The homepage links to `/faq` or renders a FAQ section that covers PLR, MRR, refunds, instructor participation, and course access
- [ ] Newsletter signup is present in the footer or a homepage band, validates consent, and does not subscribe without explicit opt-in
- [ ] Eyebrow tag renders the small conic-gradient pip (one tri-color moment per page)
- [ ] Page has both dark and light theme variants (theme toggle in bottom-right)
- [ ] Mobile responsive at 360px, 768px, 1280px breakpoints
- [ ] Lighthouse score: Performance > 90, Accessibility > 95, SEO > 95
- [ ] Home has Organization/WebSite structured data and a SearchAction pointing at `/browse?q={search_term_string}`
- [ ] Keyboard navigation: Tab through hero CTAs, all 8 product cards, all footer links, in logical order
- [ ] No PII displayed (this is an anonymous page)
- [ ] No console errors in dev or prod
- [ ] No layout shift (CLS = 0) — all images have width/height, fonts preloaded
- [ ] No `TODO` / `FIXME` in the diff
- [ ] All copy follows the voice guidelines in `docs/BRAND_AND_POSITIONING.md` §5

## Design reference

- Mockup: `mockups/home.html` (dark) + `mockups/home-light.html` (light)
- Design tokens: `00-foundations/design/tokens.css`
- Components: `00-foundations/ui/Button.tsx`, `00-foundations/ui/Badge.tsx`, `00-foundations/ui/ProductCard.tsx`

## Security

- **Auth required:** no — this is a public marketing page
- **Allowed roles:** anyone
- **RLS policies that apply:** `products` (public read on status=published), `categories` (public read)
- **PII displayed:** no
- **PII in URLs:** no
- **Audit logged:** no — this is a read-only public page, no events worth logging
- **Third-party scripts:** none in v1. Plausible analytics later, cookieless.

## Performance

- **Target p95:** < 200ms
- **Render strategy:** RSC + ISR with `revalidate = 60`
- **Cache:** Top sellers and category counts cached in memory for 60s. ISR cache is per-request after that. No CDN cache in v1 (Hetzner + Cloudflare in front, but no edge cache yet).
- **Bundle size budget:** N/A — this is RSC-only, no client JS for the data fetching

## Out of scope for v1

- Live "X people viewing" indicator on hero
- Animated stats counter (count-up on scroll-into-view)
- A/B test variants of hero copy
- Personalized hero for returning visitors
- Geo-based CTA ("Become a partner in Vietnam → local partner program")
- Chat widget / live support
- Exit-intent modal
- Full blog archive on the homepage
- Full instructor directory on the homepage

## Open questions for human

- **Newsletter system:** current Shopify pages show a newsletter signup. My recommendation is Resend Audiences or the existing notification preferences model, with explicit consent and no third-party tracking script. Confirm the system before implementation.

---

## Implementation notes

- (filled by the building agent)
