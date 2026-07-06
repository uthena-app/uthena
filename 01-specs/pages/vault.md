# File Vault — `/library/vault`

## What this page does

A focused view of the buyer's downloadable source files. Separate from `/library` so it can be a power-user view (no course noise, just files). Shows every file the user owns, with on-demand signed-URL generation. The "PLR reseller" persona uses this page heavily — they want to grab the source assets to rebrand.

This page is reachable from the main `/library` page (via the sidebar nav and the "See all files" link) and directly via the URL.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | `display_name` | profiles | greeting |
| Header stats | `total_files`, `total_size_bytes`, `total_products` | aggregate over user's owned products | 3 stat cards |
| Filters | file kind, product, date downloaded | local state + URL params | chips |
| File list | `product.title`, `file.original_filename`, `file.kind`, `file.size_bytes`, `file.duration_seconds` (if video/audio), `product.slug` | product_files via library_grants | list rows |
| Per file | Last generated signed URL expiry (if any), generation count this month | file_downloads aggregate per (user, file) | inline text |
| Per file | "Generate link" button | action | button |
| Per file | Copy URL (after generation), download size | state | button + text |

**Query:** `02-features/library/queries/getMyVault.ts` — `getMyVault({ userId, kind?, productId?, sort, cursor })`. Returns paginated, default 50 per page.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Generate signed URL | Click "Generate link" on a file row | Mints a 24h signed URL via server action, logs to `file_downloads`, shows the URL with a copy-to-clipboard button + expiry time | self (must own the product) |
| Copy URL | Click copy button | URL copied to clipboard, toast confirms | self |
| Filter by file kind | Click a kind chip | URL updates with `?kind=` | self |
| Filter by product | Click a product chip | URL updates with `?productId=` | self |
| Sort by | Change sort dropdown | URL updates with `?sort=` (name, size, date_added, kind) | self |
| Search files | Type in the search input | Filters the list by filename | self |
| Bulk download | (not in v1 — future) | — | — |
| Download history | (not in v1 — would show the file_downloads log; v2) | — | — |
| Delete file | (not applicable — files are source assets, not user uploads) | — | — |

## What this page does NOT do

- No bulk download (v2; one signed URL at a time prevents abuse)
- No in-browser preview of the file (no PDF viewer, no image preview, no audio player — files are downloaded, not viewed)
- No folder/tag organization (v2 — for now files are flat with kind+product filters)
- No share-with-team (v2; not applicable for a single buyer)
- No "this file is no longer available" state (if a partner unpublishes, the buyer's existing grant stays — they keep what they bought)

## Acceptance criteria

- [ ] Page is auth-gated
- [ ] Only files from products the user has a library_grant for are shown
- [ ] Files are sorted by default with newest products first, then by file kind
- [ ] "Generate link" creates a signed URL with 24h TTL
- [ ] The signed URL is shown in a copy-to-clipboard UI with the expiry time clearly displayed
- [ ] Every "Generate link" is logged to `file_downloads` (this is the audit log)
- [ ] Rate limiting: max 60 signed URL generations per user per hour, 1000 per day
- [ ] When rate limit is hit, show a friendly error and suggest waiting
- [ ] Filter chips work and reflect in the URL
- [ ] Search input filters the list as you type (debounced 200ms)
- [ ] File size is human-readable (e.g. "1.2 GB" not "1288490188")
- [ ] File kind has a meaningful icon (using the same icons as the upload page)
- [ ] No layout shift on filter changes
- [ ] Page renders in < 300ms p95
- [ ] Mobile responsive (list rows stack)
- [ ] No PII displayed
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/library.html` (the file vault section is part of that mockup, this page would be a focused version)
- Components: `00-foundations/ui/VaultRow.tsx`, `00-foundations/ui/FileKindIcon.tsx`

## Security

- **Auth required:** YES + active library_grant for the file's product
- **Allowed roles:** any user with a valid library_grant
- **RLS policies that apply:** `library_grants` (self only, must not be revoked/expired), `product_files` (inherits from product visibility)
- **PII displayed:** no
- **PII in URLs:** no
- **Audit logged:** yes — every signed URL generation is logged to `file_downloads` (this is the abuse-detection log)
- **File access:** all files served via signed URLs, 24h TTL, NOT IP-bound (deliberate — see `00-foundations/files/README.md`; streams are IP-bound, downloads are not). URLs must permit HTTP Range requests for 1GB+ resume.
- **Rate limiting:** 60/hour, 1000/day per user. See `00-foundations/files/rate-limit.ts`.
- **Abuse detection:** the file_downloads log is monitored. A user generating > 1000 URLs/day gets flagged for review. A user whose URLs are accessed from > 10 distinct IPs in a day gets flagged.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 300ms (similar to /library but with fewer joins)
- **Render strategy:** RSC + SSR (no caching — user-specific)
- **Cache:** none
- **DB indexes:** `library_grants (user_id)`, `product_files (product_id, kind)`
- **Bundle size budget:** < 20KB added to client bundle (just the filter UI and copy-to-clipboard)

## Out of scope for v1

- Bulk download
- In-browser preview
- Folder/tag organization
- Download history
- Share with team (not applicable for a single buyer)
- Re-download history visible to the user (we log it, but don't surface it in v1)

## Open questions for human

- **Rate limit ceiling:** 60/hour is my recommendation, but PLR power users may legitimately need more. We can tune post-launch. For v1, ship with 60/hour.
- **Watermarking:** v2. The infrastructure is complex (per-user CDN edge function). Skip in v1.

---

## Implementation notes

- (filled by the building agent)
