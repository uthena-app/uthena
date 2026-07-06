# Collection detail — `/collections/[handle]`

## What this page does
Renders a category-filtered product grid. Distinct from `/browse?category=...`
for SEO reasons: the legacy Shopify collection URLs map here, preserving
search equity.

## Data this page shows
- Header with the category name
- Grid of products filtered to that category

## Acceptance criteria
- [x] Server component, ISR 60s
- [x] 404 if the category doesn't exist
- [x] `generateMetadata` returns category-specific title
- [x] Empty state designed
- [x] RLS-aware reads

## Out of scope for v1
- Subcategory drill-down
- Featured products within a collection

## Open questions
None.
