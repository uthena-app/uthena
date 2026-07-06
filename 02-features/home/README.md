# Home feature

The marketing homepage. Anonymous visitors land here, understand what Uthena
is in 5 seconds, and find the right path in 15 more — browse the catalog,
become a partner, or join the affiliate program.

## Sections (top to bottom)

| Section | Component | Data | Notes |
|---|---|---|---|
| Hero | `Hero` | `getPublicProductStats()` + `getHomeHeroCells()` | 2-column desktop, stacked mobile. Stats are dynamic. Art cells: first 4 published products, fallback to mockup cells when empty. |
| Trust strip | `TrustStrip` | `TRUST_STRIP` copy constant | 3 numbered cells "How it works". Anchor target for the hero's "How it works" CTA. |
| Featured grid | `FeaturedSection` | `getFeaturedProducts()` + `getPublishedProductCount()` | Uses shared `ProductCard`. `EmptyState` when catalog is empty. |
| Reviews block | `ReviewsSection` | `getPublicProductStats().avgRating` + `FEATURED_TESTIMONIAL` | Anchor copy when no reviews exist. Phase 9 (P9.14) swaps for the live reviews table. |
| Categories grid | `CategoriesSection` | `getActiveCategories()` | Cards use initials-derived icons. Each card links to `/browse?category=<slug>`. |
| Newsletter band | `NewsletterBand` | (client component) | UI only — Phase 17 wires SES. Form has a real input + email validation; submit shows an inline "we'll let you know" message. |
| FAQ | `FaqSection` | `HOME_FAQ` copy constant | Native `<details>` / `<summary>`. Phase 10 (P10.8) swaps for the admin-editable FAQ list. |

## Queries

- `getPublicProductStats()` — `courseCount`, `partnerCount`, `paidOutCents`,
  `avgRating`. All four derive from published data + paid-out ledger
  rows. Returns 0 / null (never placeholder text) for empty cases.
- `getHomeHeroCells()` — first 4 published products, formatted as
  `{ title, licenseTag }`. Falls back to 4 mockup-faithful cells
  (`AI Personal Branding / Python Data Science / Deep Learning /
  AI Copywriting`) when the catalog has fewer than 4 products.

`getActiveCategories()` and `getPublishedProductCount()` are re-exported
from `02-features/catalog/queries.ts` for the home page's single-import
convenience.

## Token-only styles

All sections use design tokens (`var(--accent)`, `var(--bg-elev-1)`,
`var(--font-display)`, `var(--space-7)`, etc.) — no inline hex, no magic
pixel values. The `.module.css` per section matches `mockups/styles/main.css`
sections 124–208 exactly. Light theme support is automatic via the
design-system CSS variable layer (P0.1b deferred; current tokens are
dark-mode-tuned).

## Accessibility

- Hero `<h1>` carries an `id` so the `<section>` can be `aria-labelledby`'d.
- "How it works" CTA in the hero targets the trust-strip section via
  fragment URL (`#how-it-works`) — no JS required.
- FAQ uses native `<details>` / `<summary>` — keyboard accessible by
  default, screen-reader announces open / close.
- Featured grid + categories grid both render `<EmptyState role="status">`
  when the underlying query returns empty, so screen readers announce
  the change.
- The newsletter input has a real `<label>` (visually hidden via
  `srOnly`), `type="email"`, `autoComplete="email"`, and `required`.

## What's deferred

- **Newsletter subscribe action** — STUB-046. The form's submit handler
  is a UI placeholder. Phase 17 wires the SES adapter + suppression
  list + double opt-in.
- **Real reviews on the homepage** — Phase 9 P9.14. The reviews block
  currently shows the spec's anchor copy + a live `avg_rating` if the
  catalog has reviews. When P9.14 lands, this section reads from the
  reviews table.
- **Admin-editable FAQ** — Phase 10 P10.8. The home FAQ is a
  hand-picked subset of the canonical FAQ. Replacing it with the
  live list (filtered by an `is_featured` flag) is a small data
  shape change in this component.
- **Hero art real images** — Phase 0 P0.13. The art cells currently
  use gradient surfaces so the empty-database case still reads
  visually. When `product_images` migration lands + the product
  query selects the primary image, swap the gradient for an `<img>`.
- **"Become an instructor" CTA in the hero** — currently "How it works"
  scrolls to the trust strip. The spec lists a separate "Become a
  partner" CTA in the data row but it conflicts visually with the
  two CTAs already there; deferred to a future tick as a third
  tertiary CTA.
