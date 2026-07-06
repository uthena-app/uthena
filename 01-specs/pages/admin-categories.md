# Admin Categories — `/admin/categories`

## What this page does

The admin's category tree management. The 15 top-level seeded categories (AI, Business, Marketing, Programming, Design, Finance, Health & Fitness, Hobby, Language, Photography, Productivity, Relationship, Technology, Cryptocurrency, Educational — see `_data-model.md`) and their sub-categories (up to 2 levels deep) are managed here. The page shows the tree (collapsible), per-category stats (product count, sales_30d, revenue_30d), and supports add / edit / remove / reorder. Delete is only allowed when the category has 0 products AND 0 sub-categories; otherwise the action is disabled with a tooltip explaining the constraint. Reorder uses drag-and-drop within a parent and across parents (with cycle prevention). All mutations are audit-logged with before/after JSON.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Sidebar | (same admin sidebar as review, reports) | hard-coded | sidebar |
| Top bar | page title, "Add top-level category" CTA, "Export tree" button | hard-coded | top bar |
| Stats row | total categories, top-level count, sub-category count, total products in tree, total revenue_30d in tree | aggregate over `categories` + `products` + `orders` | 5 stat cards |
| Tree panel | full category tree (collapsible nodes) sorted by `display_order` | `categories` (recursive parent_id) | nested list with expand/collapse |
| Tree node | `name`, `slug`, `product_count_cache`, `sales_30d`, `revenue_30d`, drag handle, expand toggle, edit/delete buttons | derived from `categories` + product + order joins | tree row |
| Stats tooltip | hover on a tree node shows: `description`, full path, last edit by/at, partner breakdown (top 3) | derived | popover |
| Filter / search | free-text search filters tree by name or slug, hide-empty toggle (hides categories with 0 products) | local state | search input + toggle |
| Add modal | name, slug (auto-generated from name, editable), description, parent (select from existing top-level for new sub-categories; null for new top-level) | hard-coded | modal |
| Edit modal | name, slug, description, parent (cycle-checked), `display_order` | hard-coded | modal |
| Delete modal | "type DELETE to confirm" + impact summary ("0 products, 0 sub-categories") | derived from counts | modal |
| History | (collapsible) recent category changes | `admin_audit_log` filtered | event list |

**Queries:** `02-features/admin/queries/getCategoryTree.ts`, `getCategoryStats.ts`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Expand / collapse a node | Click the chevron | UI state, no server call | admin |
| Reorder within a parent | Drag a node, drop above/below sibling | Updates `display_order` for affected rows, audit row per change | admin |
| Move to a different parent | Drag a node, drop inside another parent | Updates `parent_id`, validates depth (max 2), validates no cycle, audit row | admin |
| Add top-level category | Click "Add top-level category" | Opens add modal, on submit creates row with `parent_id=null`, `display_order = max+1`, audit row | admin |
| Add sub-category | Click "+" on a parent node | Opens add modal with `parent` pre-filled, on submit creates row, audit row | admin |
| Edit a category | Click the edit icon on a node | Opens edit modal, on submit updates the row, audit row with `before`/`after` JSON | admin |
| Delete a category | Click the delete icon on a node | Opens delete modal; submit only enabled when `product_count=0` AND `no children`; on submit deletes row, audit row | admin |
| Toggle "hide empty" | Click the toggle | Hides nodes where `product_count_cache=0`, URL updates with `?hideEmpty=1` | admin |
| Search the tree | Type in the search input | Filters visible nodes by name/slug, debounced 200ms | admin |
| View category on storefront | Click "View on site" on a node | Opens `/collections/[slug]` in a new tab | admin |
| Export tree | Click "Export tree" | Generates a JSON of the full tree (slug, name, parent_slug, display_order, product_count), signed URL, audit row | admin |
| Bulk reorder | (not in v1) | — | — |
| Bulk delete | (not in v1) | — | — |
| Edit the 15 seeded top-level categories | Allowed, but warn before renaming a category that's referenced by many products (slug change = 404 risk on cached/linked URLs) | confirmation modal lists affected product count | admin |

## What this page does NOT do

- No bulk operations (v1 = one row at a time)
- No "merge two categories" (v2 — a destructive operation that needs careful URL handling)
- No image / icon per category (v1 text-only; the storefront uses a generic icon)
- No per-category marketing copy (the description is the only marketing field; it's plain text)
- No per-locale category names (single-language in v1)
- No automatic category suggestion for products (v2: ML-based; for v1 the partner picks at upload)
- No "feature this category" carousel control (admin-only data change)
- No category access controls (categories are public to everyone in v1)
- No bulk import of categories (the 15 are seeded; new ones are admin-added one at a time)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'admin'`
- [ ] Tree renders the full category hierarchy (max 2 levels) sorted by `display_order asc` within each parent
- [ ] `product_count_cache` is accurate — verified by a test: insert a published product, count is +1; unpublish, count is unchanged (we count all statuses in v1, see OQ); archive, count is -1
- [ ] `sales_30d` and `revenue_30d` reflect the last 30 days of `orders` joined through `order_items` for products in this category
- [ ] Drag-and-drop reorder updates `display_order` for all affected rows in a single transaction
- [ ] Moving a node to a new parent validates depth (rejects if it would exceed 2 levels) and cycle (rejects if it would make a node its own ancestor) with an inline error
- [ ] Add / edit / delete each write a single `admin_audit_log` row with `action='category_create' | 'category_update' | 'category_delete'`, `before`/`after` JSON, and the admin's user_id
- [ ] Delete is disabled (with a tooltip) on any category with `product_count_cache > 0` OR any sub-categories
- [ ] Delete requires typed confirmation ("type DELETE to confirm") and shows the impact summary
- [ ] Slug changes are validated for uniqueness and URL safety (lowercase, hyphens, no leading/trailing hyphens); a slug collision shows an inline error
- [ ] Search filters the tree in-place (the underlying data is unchanged)
- [ ] "Hide empty" toggle hides nodes where `product_count_cache = 0`
- [ ] Reordering the tree does NOT change the data model; only `display_order` and `parent_id` change
- [ ] The page renders in < 400ms p95
- [ ] No `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the admin build
- Components: `00-foundations/ui/AdminSidebar.tsx`, `00-foundations/ui/CategoryTree.tsx`, `00-foundations/ui/CategoryNode.tsx`, `00-foundations/ui/CategoryEditModal.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** admin (only)
- **RLS policies that apply:** `categories` (public read; admin write — data model has public read implicit, admin needs a new `categories_admin_all` policy, see OQ), `products` (admin all), `orders`/`order_items` (admin all for revenue computation)
- **PII displayed:** no (categories are public taxonomy; revenue numbers are aggregate)
- **PII in URLs:** no
- **Audit logged:** YES — every create/update/delete, every reorder, every move-to-parent, with `before` and `after` JSON. Slug changes are particularly important to log (slug = URL; a slug change breaks inbound links).
- **Slug change impact:** when an admin changes a slug, the server action computes the count of products and reviews that reference the old slug, shows the count in the confirmation modal, and the audit row records the slug delta.
- **CSRF:** all mutation server actions are CSRF-protected
- **Rate limiting:** 100 mutations per admin per hour (categories don't change often; this is a sanity limit, not a real defense)
- **Reorder atomicity:** the entire reorder operation is one transaction. If a re-order affects 5 rows, all 5 updates commit together, and one audit row records the operation (with a list of affected ids in `after.affected_ids`).
- **Cycle prevention:** the parent_id change is server-validated using a recursive CTE that walks up the new parent's ancestors; the action rejects the change if the new parent is a descendant of (or equal to) the node being moved. The error message tells the admin which descendant chain would create a cycle.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 400ms
- **Render strategy:** RSC + SSR
- **Cache:** ISR 5min for the tree (categories change rarely; the 5min cache dramatically reduces DB load on the storefront, which reads the same tree)
- **DB indexes:** existing `categories.slug` unique index, NEW: `categories (parent_id, display_order)`, `categories (display_order)`
- **Bundle size budget:** < 30KB added to client bundle (tree + drag-and-drop + modals)

## Out of scope for v1

- Bulk operations (reorder, delete)
- Merge two categories
- Category icons / images
- Per-locale category names
- Auto-suggest categories for products
- "Feature this category" control
- Category access controls / private categories
- Bulk import of categories
- Category-level commission overrides (v2: e.g. "Programming pays partners 70%, others pay 60%")

## Open questions for human

- **`product_count_cache` semantics:** the data model says the count is "updated by trigger on products". My recommendation: count **published** products only (matches what the storefront shows). Alternative: count all products including draft/unpublished/archived. The trigger already exists (implied by the column name); we need to confirm it counts published only. My recommendation is published only; the alternative is a small admin audit-page surprise.
- **Missing admin policy on `categories`:** the data model enables RLS on `categories` and says "Public read" but does not declare an admin write policy. My recommendation: add `categories_admin_all` policy in the same migration as this page, using the same `exists (... role = 'admin')` pattern as the other tables. The public read policy is implicit (or we add `categories_public_read` for explicitness).
- **Slug-change breakage:** when a category slug changes, the storefront URL `/collections/old-slug` breaks inbound links. My recommendation: in v1, changing an indexable category slug must create a redirect row from the old collection handle to the new one, and admins are warned in the edit modal that the slug affects public SEO URLs.
- **"Hide empty" default:** should the page default to showing or hiding empty categories? My recommendation: show (default-on) — admins usually want to see the full taxonomy to spot gaps. Add the toggle for the 5% of sessions where an admin is looking only at populated categories.
- **Depth limit enforcement:** the data model says "2 levels max". My recommendation: enforce this at the application layer in the edit modal (parent select only shows top-level for new sub-categories), AND at the DB layer via a check function. Belt and suspenders. The cost is one extra trigger; the benefit is that a future code path can't bypass the limit.

---

## Implementation notes

- (filled by the building agent)
