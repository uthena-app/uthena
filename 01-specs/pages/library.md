# Library — `/library`

## What this page does

The buyer's "my products" hub. Shows every course they own, grouped by status (In progress / Completed / Not started), with a "Continue watching" card pinned at the top for the most-recently-watched lesson. Below the course list, a "File vault" section shows their downloadable source files (transcripts, sales materials, source videos) with on-demand signed-URL generation.

This is also where the user's "Certificates" live (one per completed course). And it's the entry point to the mini-shop (if they're an affiliate) and the affiliate dashboard.

Migration requirement: the current navigation links to `courses.uthena.com` as the Course Portal. After DNS cutover, that host must route users into `/library` with the normal login flow and must not expose course content without auth.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | `display_name` | profiles | greeting |
| Header stats | `total_courses`, `total_files`, `total_watch_seconds`, `total_certificates` | library_grants + progress + certificates aggregate | 4 stat cards |
| Continue watching | `lesson.title`, `lesson.duration_seconds`, `progress.position_seconds`, `product.title`, `product.thumbnail_url` | `getContinueWatching(userId, limit: 1)` | large card with play CTA |
| Achievements | streak, completed count, premium status | progress + certificates | 3 mini cards |
| Course list | `product.title`, `product.thumbnail_url`, `product.total_lesson_count`, `product.total_duration`, `partner.name`, `progress.position_seconds`, `progress.completed`, `library_grant.tier`, `library_grant.granted_at` | `getMyLibrary(userId, status?, sort)` | list rows |
| File vault | `file.original_filename`, `file.kind`, `file.size_bytes`, `expires_at` (if signed URL already generated) | file_downloads (recent) + product_files (owned) | cards grid |
| Certificates | `product.title`, `issued_at`, `certificate_id` | certificates | list with download CTA |

**Queries:** all in `02-features/library/queries/`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Continue watching | Click "Resume at X:XX" on continue card | Navigate to `/library/watch/[lessonId]` | self |
| Start course | Click "Start course" on a Not started row | Navigate to first lesson `/library/watch/[firstLessonId]` | self |
| Continue (in-progress) | Click "Continue" on a row | Navigate to last-watched lesson | self |
| View course details | Click "Details" on a row | Opens a side panel or navigates to `/products/[slug]` (decide: probably a side panel, no nav) | self |
| Review (completed) | Click "Review" on a completed row | Opens a review form (v2; not in v1 — review submission is admin-only) | self |
| Certificate | Click "Certificate" on a completed row | Downloads /library/certificates/[id].pdf | self |
| Generate signed download link | Click "Generate link" on a vault item | Mints a 24h signed URL, logs to file_downloads, shows a copy-to-clipboard button | self |
| Filter by status | Click "In progress" / "Completed" / "Not started" / "All" in left sidebar | URL updates with `?status=` | self |
| Filter by file type | Click "File vault" / "Certificates" in left sidebar | URL updates with `?view=` | self |
| Open mini-shop | Click "My mini-shop" in sidebar | Navigate to `/[handle]` | affiliate |
| Open affiliate dashboard | Click "Earnings" in sidebar | Navigate to `/affiliate` | affiliate |
| Open legacy course portal | Visit `courses.uthena.com` | Redirect to `/library` if authenticated or `/login?next=/library` if anonymous | public URL, library requires auth |

## What this page does NOT do

- No social features (no "share progress", no "compare with friends") — out of scope v1
- No in-page video player (that's the separate `/library/watch` page)
- No bulk downloads of the whole vault (v2; current: one signed URL at a time to prevent abuse)
- No auto-issued certificates (in v1, certificates are issued by a cron job on course completion; in v2 we can add auto-issues on milestone completions)
- No "this course was refunded" state (refunded library_grants are revoked and the course disappears from this page; no UX state)

## Acceptance criteria

- [ ] Page is auth-gated — unauth users redirect to /login?next=/library
- [ ] `courses.uthena.com` redirects into `/library` with the same auth gate and does not render a public course portal
- [ ] Library only shows products where the user has an active (non-revoked, non-expired) library_grant
- [ ] "Continue watching" card appears only if there's a progress row with `position_seconds > 0` and not completed
- [ ] Course list is grouped by status (default: In progress first, then Not started, then Completed)
- [ ] Progress percentage is calculated correctly (lessons with `progress.completed = true` / total lessons in product)
- [ ] Progress bar visual width matches percentage
- [ ] "Resume at 8:32" position text is the last position_seconds value formatted as M:SS
- [ ] File vault shows files from all products the user owns
- [ ] "Generate link" button creates a signed URL via the server action
- [ ] The signed URL is shown in a copy-to-clipboard UI with the expiry time
- [ ] Every "Generate link" action is logged to file_downloads
- [ ] Rate limiting on "Generate link" (max 60 per user per hour, see Security)
- [ ] Page renders in < 400ms p95
- [ ] All stats in header are accurate (verified by a test)
- [ ] No layout shift when the continue-watching card loads
- [ ] Mobile responsive (single column < 768px, sidebar collapses into a top dropdown)
- [ ] Empty state: if user has no library_grants, show "Browse catalog" CTA linking to `/browse`
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/library.html`
- Components: `00-foundations/ui/LibraryRow.tsx`, `00-foundations/ui/ContinueCard.tsx`, `00-foundations/ui/VaultItem.tsx`, `00-foundations/ui/Sidebar.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** any authenticated user (no role gating — partners, affiliates, customers all have a library)
- **RLS policies that apply:** `library_grants` (self only), `progress` (self only), `file_downloads` (self read recent 90d), `products`/`product_files` (inherits)
- **PII displayed:** no (just the user's own stats and progress)
- **PII in URLs:** no
- **Audit logged:** yes — every signed URL generation is logged to `file_downloads` (this is the abuse-detection log)
- **Rate limiting on signed URL generation:** 60 per user per hour, 1000 per user per day. Exceeding triggers a soft block + admin alert.
- **File access:** all files served via signed URLs, 24h TTL, NOT IP-bound (deliberate — see `00-foundations/files/README.md`; streams are IP-bound, downloads are not). The signed URL is one-time-redeemable in spirit (though technically re-redeemable within TTL — we monitor for abuse via the file_downloads log + `cdn_access_stats`).
- **Third-party scripts:** none
- **Legacy host safety:** course portal redirects have fixed targets and never carry signed file URLs or lesson IDs from query params.

## Performance

- **Target p95:** < 400ms (slightly higher than catalog because of personalized data + joins)
- **Render strategy:** RSC + SSR (no caching — user-specific)
- **Cache:** none on this page. The data is too personalized to cache.
- **DB indexes:** `library_grants (user_id, granted_at desc)`, `progress (user_id, product_id)`, `file_downloads (user_id, downloaded_at desc)`
- **Bundle size budget:** < 40KB added to client bundle (sidebar + course rows + vault item interactions)

## Out of scope for v1

- Social features (share, compare)
- Auto-issue certificates (cron-based only in v1)
- "This course was refunded" state (refunded grants just disappear)
- Notes / highlights on lessons (v2)
- "Continue on another device" handoff
- Course recommendations ("you might like this for your collection")

## Open questions for human

- **Rate limit on Generate link:** 60/hour feels right for power users, but might be too low for the "I want to download everything" PLR reseller. Should we offer a higher tier (paid) for higher limits? My recommendation: keep the 60/hour default in v1, observe usage, then tune. Don't pre-build a paid tier.
- **Empty state CTA:** "Browse catalog" is the obvious one. Should we also offer "Take the catalog tour" (a 30-second product walkthrough video) for first-timers? My recommendation: skip in v1, add in v2 if retention is a problem.

---

## Implementation notes

### P7.1 Slice 1 — Stats header + grouped file vault

Status: shipped in this tick. The page now shows:

1. **Header stats tiles** — 2 `<dl>` tiles in the header (Courses, Files) with the same compact shape used by `/admin/categories` + `/partner/payouts`. The spec calls for 4 tiles (Courses, Files, Watch seconds, Certificates); the 2 deferred tiles wait for Phase 15 (the `progress` + `certificates` aggregates need to be designed). The 2-tile grid uses `repeat(2, minmax(0, 1fr))` so the layout extends cleanly to a 4-tile grid in Phase 15 with no layout shift.

2. **Grouped file vault** — extracted `groupVaultFilesByProduct(files)` pure helper (`02-features/library/groupVaultFilesByProduct.ts`). Each product gets its own `<h3>` + file count badge ("X files") + the per-product file list in original created_at-desc order. Groups sorted by product title (case-insensitive). Pure function, 8 unit tests.

3. **Empty state** for the file vault — "No downloadable files for any of your courses yet." + Browse catalog CTA. Separate from the existing `<EmptyLibraryState>` which handles the "no grants at all" case.

4. **Mobile responsive** — added `@media (max-width: 640px)` breakpoint (was already at 900px): tighter page padding, smaller h1, tighter tile padding, smaller stat value.

5. **Tests added** — 22 new unit tests (6 `getUserLibrary` + 8 `getUserAccessibleFiles` + 8 `groupVaultFilesByProduct`). Coverage: anon path, fail-soft on every error path, query shape assertions (RPC params, .in / .eq / .order filters, scan_status='clean' AND encoding_status='ready'), product-join defensive mapping (array embed + object embed + null fallback), grouping invariants (first-sighting wins, no internal re-sort, no mutation), interleaved file separation.

### Phase 15 dependencies (Slice 2 still owed)

- "Continue watching" hero card — Phase 15 `getContinueWatching` already exists as a stub returning null; the real query needs the `progress` table aggregates.
- Progress bars on each `LibraryRow` — Phase 15.
- "Resume at M:SS" position text — Phase 15.
- Achievements row (streak, completed count, premium status) — Phase 15.
- Certificates section — Phase 15 (`certificates` table exists, but the per-user read surface isn't built).
- Course list grouping by status (In progress / Completed / Not started) — Phase 15. The Slice 1 grouping is by `access_source` (Personal Access / Purchased), which is the v1 grouping.

### P7.3 — File vault: last accessed per file

Status: shipped. The vault already showed filename, format badge, size,
and duration; the spec's "last accessed" data point is now wired through.

1. **`last_accessed_at` on every `VaultFile`** — `getUserAccessibleFiles`
   now runs a third query against `file_downloads` scoped to
   `user_id = current AND file_id IN (vault file ids) ORDER BY created_at
   DESC`, then dedupes in JS to keep the latest sighting per file.
   Minimal select (`file_id, created_at` only) — no PII columns. Fail-soft
   on the audit-log read: the vault still renders with `last_accessed_at
   = null` when the read fails (matches the "never accessed" empty
   state, which is the safe default).

2. **"Last accessed: …" line on every `VaultItem`** — uses the existing
   `formatTimeAgo` helper from `02-features/account/profile/queries/`
   (pure, server-safe, cross-feature import). Falls back to "Never
   accessed" when `last_accessed_at` is null.

3. **No new index** — the existing
   `file_downloads_user_created_idx (user_id, created_at desc)` covers
   the new read; the `file_id IN (...)` filter runs against the
   in-memory page. Volume is bounded by the rate limit (60/h/user), so
   the dedupe is fast even at the high end.

4. **PII-safe** — the file_downloads select omits `ip_hash`, `ip_raw`,
   `user_agent`, `range_start`, `range_end`, `bytes_served`,
   `edge_location`, `url_expires_at`. The ISO timestamp itself is the
   only thing serialized to RSC props. Unit-test asserts the exact
   select payload to catch a regression.

5. **No FK orphans surfaced** — `file_downloads.file_id` is
   `ON DELETE SET NULL`, so rows where the source `product_files` row
   was deleted are filtered out before the dedupe. The unit test
   covers this.

   6. **Tests** — 6 new unit tests in `getUserAccessibleFiles.test.ts`:
      empty audit log, latest-per-file dedupe with mixed data, exact
      query shape (PII-safe select payload + .in/.eq/.order), no-query
      path when vault is empty, fail-soft on audit-read error, and
      skip-null-file_id handling. Total library tests: 28 passing
      (was 22 after P7.1 Slice 1).

### P7.7 — Download history (`/library/downloads`)

Status: shipped. The user's own audit log — every signed URL mint, when,
from where. Phase 7's counterpart to the admin-facing `file_downloads`
view; this surface is **self-only** (RLS-gated via `file_downloads_self_read`).

#### What's on the page

1. **Filter strip** — `Kind` (all / downloads / streams) + `Window`
   (last 30 / 90 / 365 days / all time). URL-driven: `?kind=stream&days=90`.
   Default `kind=all, days=365` strips both params from the URL.

2. **Table** — 7 columns: When / What / Kind / IP / Device / Edge /
   Expires. `When` is "Jun 25, 2026 · 10:30 AM UTC" + a relative "3 hours
   ago" line below. `What` is the product title (linked to
   `/products/[slug]` when the product still exists, italic "(product
   deleted)" when it doesn't) + the filename below. `Kind` is a teal-or-
   orange pill matching the design DNA (download = teal, stream = orange).
   `IP` is the masked form (`192.168.1.***` for IPv4; IPv6 passes
   through unmasked — Bunny logs IPv4 in v1). `Device` is the
   shortUserAgent label (`Chrome 124 · macOS` / `Mobile Safari 17 · iOS`
   / `curl 8` / etc.). `Edge` is the Bunny PoP code (`LAX`, `JFK`).
   `Expires` is the URL expiry timestamp, struck-through + "Expired"
   when past.

3. **Summary line** above the table — "Showing N entries · downloads
   and streams in the last 365 days". When the result hits the 500-row
   limit, the summary appends "Showing the most-recent 500 entries.
   Narrow the window to see older ones." — the truncation note is
   honest about the cap rather than hiding it.

4. **Empty state** — "You haven't generated any download links yet.
   Head to your file vault and click 'Generate link' on any file." +
   a Go-to-library link. A different copy when filters are active:
   "No downloads match the current filter. Try widening the window or
   selecting 'All' to see every entry."

5. **Error state** — when the audit-log read fails, render a danger-
   dashed card with "We could not load your download history. This is
   usually a temporary read error." + contact link. The query's
   fail-soft contract (empty list + `total_in_window = -1`) is what
   flips this branch.

6. **Footnote** — "Showing your own data only. IP addresses are masked
   (last octet hidden); user-agents are shortened to browser + OS for
   readability." + a Report-an-issue link.

7. **Library nav** — added a "Downloads" link to `LibraryNav.tsx`
   between "All content" and "Orders" so users discover the page.

#### Data flow

- `getDownloadHistory({ since, kind, limit })` reads `file_downloads`
  scoped to `user_id = current`, joined to `product_files` (filename)
  + `products` (title + slug). Both joins are defensive — the
  `file_id` and `product_id` columns are `ON DELETE SET NULL`, so
  the page must render cleanly when the source rows are gone.
- `since` is computed from `windowSince(days)` (a pure helper in
  `getDownloadHistory.ts`). `'all'` or null → unbounded; otherwise the
  ISO timestamp N days back from `now` (caller can inject `now` for
  tests).
- `kind` is the typed `FileDownloadKind` from `@foundations/data/enums`;
  `'all'` → no kind filter (the query omits the `.eq('kind', ...)`).
- `limit` clamps to `MAX_HISTORY_ROWS = 500` defensively (matches the
  p95 budget on the page; power users narrow the window).

#### PII handling

The page surfaces the user's OWN data (they're looking at their own
audit log). Three defensive measures still apply:

1. **IP last-octet masked** at render time via `maskIp()`. IPv4 only;
   IPv6 passes through. The mask is a defensive habit — the helper
   exists for any future admin / shared view.
2. **User-agent shortened** to "Browser X · OS" via `shortUserAgent()`.
   Order matters: Edge before Chrome (Edge UA contains "Chrome"), Chrome
   before Safari, etc. Unknown UAs truncate to 60 chars.
3. **`ip_hash` is never selected.** It's an internal abuse-detection
   hash, not user-facing data.

The page does NOT show `range_start`, `range_end`, `bytes_served`, or
`edge_location`-less rows. The audit row stays internal for the
abuse-detection cron (P7.8 / P18.8 follow-up).

#### Tests

48 new unit tests:
- `getDownloadHistory.test.ts` — 24 tests. Covers: anon path (no DB
  calls), auth gating, kind filter (download / stream / null), since
  filter (null + valid ISO), limit clamp (oversized / negative /
  default), happy-path mapping (array-embed + object-embed for both
  file + product joins), deleted-FK edge cases (file_id null +
  product_id null), PII safety (ip_hash not selected), filters echoed
  in result, bogus-kind rejection, default sort = created_at DESC,
  windowSince helper (all / null / number / non-positive / non-numeric).
- `formatIp.test.ts` — 24 tests. Covers: maskIp for IPv4 shapes +
  null + IPv6 + garbage; shortUserAgent for Chrome / Edge / Firefox /
  Safari / Mobile Safari / curl / Postman / Android / Opera / Linux +
  long UA truncation + em-dash.

Total library tests: 76 passing (was 28).

### P7.9 — File vault search (filter by product / format / date)

Status: shipped. Three URL-driven filter dimensions live above the file
vault on `/library`. The page's grouped shape (one `<h3>` per product,
count badge, file rows) is preserved — the filter narrows which rows
render, not how they're grouped.

#### What's on the page

1. **Filter strip** — `<VaultFilterBar>` client island with three
   `<fieldset>` chip groups:
   - **Product** — "All" + one chip per owned product (sorted by title,
     case-insensitive). Chip count is dynamic from the unfiltered vault
     rows.
   - **Format** — "All" + 8 chips for the `FileKind` enum (Video /
     Slides / Transcript / Graphics / Audio / Document / Archive /
     Other).
   - **Date added** — "All time" / "Last 30 days" / "Last 90 days" /
     "Last year".

2. **Summary line** — when at least one filter is non-default, the page
   renders "Showing N of M files." + a "Clear filters" link back to
   `/library`. The count uses `font-variant-numeric: tabular-nums` so
   the digits don't shift when filters change.

3. **Filtered empty state** — when the user's vault has files but the
   filters exclude all of them, renders "No files match the current
   filter." + a "Clear filters" link. Distinct from the existing
   "No downloadable files for any of your courses yet." state because
   the diagnostic differs ("filters too narrow" vs "no files attached").

4. **URL state** — `?product=<id>&kind=<kind>&since=<days>`. Default-
   strip: when a dimension is at its default, the param is omitted from
   the URL. The canonical URL stays `/library` rather than
   `/library?product=all&kind=all&since=all`. Back/Forward works because
   the bar syncs from `useSearchParams` on every change.

#### Data flow

- `getUserAccessibleFiles` now selects `created_at` (was sorting by it
  but not returning it) so the date filter can compute recency windows
  client-side without a second query.
- The page composes `filterVaultFiles(files, opts)` (pure helper) with
  `groupVaultFilesByProduct(files)` (pure helper) — both are pure, both
  are unit-tested, and the page stays RSC. The filter narrows the input
  to the grouper; the grouped render shape is unchanged.
- `availableProducts` is derived from the unfiltered vault rows in the
  page (one entry per `product_id` seen, sorted by title). The filter
  bar receives this as a prop so the Product chip group only shows
  products the user owns.

#### Filters

| URL param | Type | Default | Notes |
|---|---|---|---|
| `product` | numeric id | (none) | Invalid → ignored (parser coerces to null) |
| `kind` | `FileKind` (8 values) | `all` | Invalid → ignored |
| `since` | `30` \| `90` \| `365` \| `all` | `all` | Window is inclusive (`>=` cutoff) |

#### PII handling

No change. The filter narrows rows the user already owns. No PII is
added to logs, no new query is run.

#### Tests

20 new unit tests in `filterVaultFiles.test.ts`:
- Empty input + no-filter passthrough.
- Each dimension individually (productId / kind / sinceDays) with
  positive + negative cases.
- Date boundary inclusive (`>=` cutoff).
- Edge cases: `sinceDays = 0`, negative, `'all'`, `null`, `undefined`.
- Defensive: rows with `null` or unparseable `created_at` are excluded
  when a date filter is active, kept when not.
- Combined filters (product + kind, all three) with AND semantics.
- No-mutation: input array is untouched.

Updated `getUserAccessibleFiles.test.ts` (added `created_at: null` to
the mapped-shape assertion — the new select field defaults to null when
the fixture doesn't include it). Updated `groupVaultFilesByProduct.test.ts`
`file()` helper to default `created_at: null` so the helper stays
decoupled from the query hydration path.

### P7.4 — Bulk download (zip multiple files into one request)

Status: shipped (Slice 1 — in-memory zip + signed-URL streaming from
the route handler). The user picks files in the vault, clicks
"Download as zip", and gets a single zip archive with one folder per
product. Resolves the prior "Out of scope for v1 — bulk download"
marker.

#### What's on the page

1. **Checkbox per vault row** — `<input type="checkbox" name="file_ids"
   value="<id>" data-file-size="<bytes>">` rendered inside the existing
   `<li>` of every `VaultItem`. Plain HTML; works without JS. The
   `<label>` wrapper makes the entire 28px cell clickable for touch
   targets. Screen-reader label "Select <filename>" on each label.

2. **`<form action="/api/library/bulk-download" method="post">`** —
   wraps the entire vault render. Standard form submission triggers the
   route handler. The browser receives a `Content-Disposition: attachment`
   response and saves the zip natively; no client-side blob/URL handling.

3. **`<BulkDownloadBar>`** — a tiny client island above the vault
   groups:
   - Count + total size (live: "N files selected · 24.3 MB").
   - "Select all" / "Clear" buttons (button-type=button, dispatch
     synthetic `change` events on each checkbox).
   - "Download as zip" submit button (disabled when count is 0 or
     over the 50-file cap; shows a friendly warning when over the cap).
   - The bar syncs from the form's checkbox events via a delegated
     `change` listener — no prop drilling, no controlled state.

4. **Grouping** — the zip arranges files under their product title:
   `Course A/transcript.pdf`, `Course A/slides.pdf`,
   `Course B/transcript.pdf`. Same-name collisions across products are
   safe (each lives in its own folder). The in-archive path segments
   are sanitized via `sanitizePathSegment` (drop colons, escape
   backslashes + forward slashes, cap at 200 chars) — defense in
   depth against path traversal in filenames.

#### Data flow

- The route handler reads `request.formData()` and hands it to
  `validateBulkRequest(formData, resolveRows, accessible)` — the
  pure validator does:
  - Zod parse (1–50 distinct positive integer ids, via
    `BulkDownloadInput` in `00-foundations/data/schemas.ts`).
  - Row resolution (rejects missing ids with `code: 'not_found'`).
  - Scan/encoding gate (rejects non-`clean` / non-`ready` rows with
    `code: 'file_not_ready'`).
  - Access gate (rejects files whose product isn't in the user's
    `user_accessible_products` RPC result, with `code: 'forbidden'`).
  - Aggregate size cap (256 MiB; rejects with `code: 'too_large'` +
    friendly message).
- After validation succeeds, the handler charges N rate-limit hits
  (one per file; shared `60/hour` bucket with `mintDownloadUrlAction`).
  This is intentional — a 10-file bulk request consumes 10 of the
  60/hour quota, matching the per-URL cost the user would pay by
  minting each URL individually.
- The handler then fetches each file from the signed Bunny CDN URL
  (NOT IP-bound; download kind) in parallel with 5 concurrent
  workers, builds the in-memory zip via `fflate.zip()`, and streams
  the `Uint8Array` back as the response body with
  `Content-Type: application/zip` + `Content-Disposition: attachment;
  filename="uthena-bulk-YYYYMMDD-HHMMSS.zip"`.
- One `file_downloads` row per file (kind='download') is written via
  the service-role client (append-only invariant preserved by the
  absence of UPDATE/DELETE policies on the table). The fail-soft
  contract matches `mintDownloadUrlAction` — a failed audit insert
  doesn't block the download.

#### Security

- **Auth required:** YES — same `getSessionUser()` gate as the
  single-file route handlers; anonymous POSTs return 401.
- **Access check:** every file must be in the user's
  `user_accessible_products` (purchase grant OR active subscription).
  Enforced via the same RPC the single-file surface uses.
- **RLS:** the `product_files_public_read_published` policy lets the
  route handler read any published file's row (the access check is
  the application's job). `file_downloads` inserts are via the
  service-role client (RLS has no INSERT policy for `auth.uid()`).
- **Rate limit:** shared 60/hour bucket. N files in a bulk request =
  N hits. Exceeding mid-charge returns 429 + `Retry-After`.
- **PII:** no PII in logs (the request logs only `file_count` +
  `total_bytes` + `archive_bytes` + the user's session id hash via
  the standard logger). No `email`, no raw IP, no signed URL.
- **Audit:** one row per file, same columns as the single-file surface
  (`kind`, `url_expires_at`, `ip_hash`, `ip_raw`, `user_agent`).
- **Path traversal:** `sanitizePathSegment` collapses `:` + `\ + `/`
  to safe chars before any filename hits the archive. `../`
  becomes `.._.._etc_passwd` (no `/` left to escape with).
- **Size cap:** 256 MiB uncompressed input → comfortably below a 1.5
  GB Node heap. Larger bulk requests are rejected with a friendly
  "narrow your selection" message. The cap is in `validateBulkRequest.ts`
  as a single source of truth.
- **File count cap:** 50 files max (Zod schema + the bar's
  over-cap warning).

#### Performance

- **Target p95:** < 5s for a 50-file / 256 MiB bulk request
  (dominated by the parallel CDN fetches; the in-memory zip build is
  typically < 100ms for that size).
- **Render strategy:** RSC page + client island for the bar. The
  route handler is a streaming `Response` body.
- **Bundle size budget:** BulkDownloadBar is ~1.5 kB (the smallest
  client island in the library feature; the count + size are pure
  DOM reads).

#### Out of scope (deferred for Slice 2+)

- **Asynchronous zip generation** — v1 returns the zip synchronously.
  For very large requests (> 256 MiB), a job-queue pattern with a
  "Your zip is being prepared" landing page would be nicer. Deferred
  until the bulk feature sees real usage.
- **Pre-built zips cached in Bunny Storage** — would let us avoid
  re-fetching + re-zipping on repeat requests. Requires the Phase 12
  partner-side upload helper (Bunny Storage PUT API) to land first.
- **Cross-product dedupe by content** — two products with the same
  source PDF would currently produce two copies in the zip. Content-
  addressed dedupe (hash the bytes, dedupe by hash) deferred to v2.

#### Tests

- **53 new unit tests** (31 in `validateBulkRequest.test.ts`, 22 in
  `buildBulkZip.test.ts`) — covers schema layer (parse + dedupe + caps),
  row resolution (missing / not-ready / not-accessible), size cap
  (bigint math at the cap + 1 over), name validation (path traversal /
  Windows separators / absolute paths / duplicate names), and the
  helper that builds in-archive paths.
- No route-handler unit test — the handler is a thin glue layer
  between the pure validator, the pure zip builder, and the existing
  signed-URL / rate-limit / audit-row primitives. End-to-end smoke
  is the dev-server `:3100` round-trip (verified post-deploy).

#### Files (new + modified)

- **NEW** `02-features/library/validateBulkRequest.ts` (~290 LOC) —
  pure validator. Zod parse → resolve rows → access check → size
  check. Typed outcomes with discriminated `code` per failure mode.
- **NEW** `02-features/library/validateBulkRequest.test.ts` (~280 LOC,
  31 tests).
- **NEW** `02-features/library/buildBulkZip.ts` (~210 LOC) — pure
  helper around `fflate.zip()` with name validation + dedupe + size
  cap + the `bulkEntryName(productTitle, originalFilename)` helper
  that groups files under product folders.
- **NEW** `02-features/library/buildBulkZip.test.ts` (~230 LOC, 22
  tests).
- **NEW** `02-features/library/components/BulkDownloadBar.tsx` (~140
  LOC) — client island for selection count + submit button.
- **NEW** `02-features/library/components/BulkDownloadBar.module.css`
  — token-only styles + `:focus-visible` + responsive.
- **NEW** `app/api/library/bulk-download/route.ts` (~290 LOC) —
  POST handler that orchestrates the validator + zip builder + audit
  + signed URLs + rate limit.
- **MOD** `02-features/library/components/VaultItem.tsx` — added
  `<input type="checkbox" name="file_ids">` + label wrapper + sr-only
  label.
- **MOD** `02-features/library/components/VaultItem.module.css` —
  added the 4-column grid (select / badge / body / action).
- **MOD** `03-app/library/page.tsx` — wrapped the vault groups in a
  `<form action="/api/library/bulk-download">` + rendered
  `<BulkDownloadBar>` above.
- **MOD** `03-app/library/page.module.css` — added `.bulkForm` class
  (no visual styling; just a presentational anchor).
- **MOD** `02-features/library/index.ts` — barrel re-export of
  `BulkDownloadBar`.
- **MOD** `00-foundations/data/schemas.ts` — new `BulkDownloadInput`
  Zod schema (1–50 distinct positive integers).
- **MOD** `package.json` — added `fflate@^0.4.8` to dependencies
  (was already a transitive dep; promoted to direct so the import
  path is explicit).

Total library tests: 96 passing (was 76, +20 new).

### P8.1 — Library access sync

Status: shipped. The sync path between Stripe subscription events
and `/library` access was already wired end-to-end via P5.8 + the
subscription webhook handler (`onSubscriptionEvent.ts`) +
`user_accessible_products(p_user_id)` + `has_active_subscription(p_user_id)`.
P8.1 makes that contract explicit + tested.

#### What "immediately" means

Per the spec, "subscription start/end reflects immediately." Concretely:

1. Stripe fires a webhook to `/api/webhooks/stripe` (typically 1-2s
   after the event, sometimes longer under load).
2. The webhook handler verifies the signature + claims an idempotency
   key (`processed_webhooks`), then dispatches to
   `onSubscriptionCreated` / `onSubscriptionUpdated` /
   `onSubscriptionDeleted` / `onInvoiceEvent` based on the event type.
3. The handler synchronously writes to the `subscriptions` row:
   - **Created / Updated** → `upsert` with `onConflict:
     'stripe_subscription_id'`. The new row mirrors Stripe's state
     (`status`, `current_period_start/end`, `cancel_at_period_end`,
     `canceled_at`, trial timestamps, metadata).
   - **Deleted** → forces `status='canceled'` on the upserted row
     regardless of the incoming status.
   - **Invoice.paid** → `UPDATE` `subscriptions.status='active'` +
     `UPSERT` a `payout_ledger` row (`kind='subscription'`,
     idempotent on `stripe_invoice_id`).
   - **Invoice.open / uncollectible** → `UPDATE`
     `subscriptions.status='past_due'`.
4. The user's next `/library` render (which is `dynamic = 'force-dynamic'`,
   so every request fetches fresh) calls
   `getUserLibrary()` → `user_accessible_products(p_user_id)` RPC →
   `has_active_subscription(p_user_id)`.
5. `has_active_subscription` reads the `subscriptions` row by `user_id`,
   returning true only when `status IN ('active', 'trialing')` AND
   `current_period_end IS NULL OR current_period_end > now()`. The
   subscription access branch of the union returns every published
   product joined to that row.

**Total end-to-end latency: 2-5s** in the happy path (1-2s for the
webhook delivery + <100ms for the DB write + <200ms for the page
re-render + DB read).

#### Edge cases (covered by `onSubscriptionEvent.test.ts`)

| Status transition | Webhook event | Handler action | Resulting library access |
|---|---|---|---|
| `incomplete` → `active` | `invoice.paid` | `subscriptions.status = 'active'` + ledger row | Granted on next render |
| `active` → `canceled` | `customer.subscription.deleted` | `upsert ... status='canceled'` (forced) | Revoked on next render |
| `active` → `past_due` | `invoice.open` | `subscriptions.status = 'past_due'` | Revoked (not in `{active, trialing}`) |
| `active` + `cancel_at_period_end=true` | `customer.subscription.updated` | `upsert` with the new flag | **Continues until `current_period_end`** — the RPC checks `current_period_end > now()`, not `cancel_at_period_end`. At period end, Stripe fires `subscription.deleted` and access is revoked. |
| `trialing` | `customer.subscription.created` (status='trialing') | `upsert` with status='trialing' | Granted (counted as active) |
| `paused` / `unpaid` | `customer.subscription.updated` | `upsert` with the new status | Revoked (not in `{active, trialing}`) |

#### Why the RPC, not per-product inserts

`has_active_subscription(user_id)` is the **only** access check for the
subscription branch. The handler does **not** write per-product
`library_grants` rows for subscribers — at 500+ products × 10k+ users
that's a write-amplification problem (a subscription start would write
500 rows; a cancellation would update 500 rows). The "no library_grants
for subscriptions" comment in `onSubscriptionEvent.ts:118-123`
documents this design. The catalog read uses the RPC's UNION ALL of
`(active library_grants) ∪ (full catalog WHERE subscription is active)`.

#### Why no caching layer between the webhook and `/library`

- `/library` is `dynamic = 'force-dynamic'` (every request fetches).
- `getUserLibrary()` uses React `cache()` for per-request dedup only
  (lifetime = single RSC render, not persisted).
- `user_accessible_products` is `STABLE` in Postgres — cached within a
  single query, never across requests.
- `has_active_subscription` is also `STABLE` — same lifetime.
- The webhook handler writes synchronously inside the request; the
  next `getUserLibrary` call after the request returns will see the
  new row.

#### Tests added (`onSubscriptionEvent.test.ts`, 31 unit tests)

Covers the full webhook-handler matrix without mocking the DB:

- **`onSubscriptionCreated` (7 tests)** — happy path + all-fields
  payload shape + ISO timestamp conversion + status enum
  passthrough + missing `user_id` metadata (no DB writes) +
  upsert error + null-row fallback + PII-safe warn log.
- **`onSubscriptionUpdated` (2 tests)** — same upsert path +
  idempotency on repeat (DB constraint dedupes via
  `onConflict='stripe_subscription_id'`).
- **`onSubscriptionDeleted` (4 tests)** — forces status='canceled'
  (even from `active` or already `canceled`) + no library_grants
  cleanup (defensive — access is computed) + propagates upsert errors.
- **`onInvoiceEvent` (10 tests)** — ignored when no subscription +
  status flips for `paid` / `open` / `uncollectible` + ledger row
  shape (`kind='subscription'`, idempotent on `stripe_invoice_id`,
  `partner_id=null`) + skip-when-no-sub-row + skip-when-`amount_due<=0`
  + non-fatal ledger error (warn log, return ok) + update-fail
  returns `{ ok: false }`.
- **PII safety (3 tests)** — no email, no Stripe customer id, no
  price id leaked to logs. Stripe sub id IS logged (operationally
  useful for support correlation; opaque identifier, not user PII).
- **Library-access-sync contract (4 tests)** — explicitly asserts the
  handler writes the row in the exact shape the RPC reads:
  - status in `{active, trialing}` → RPC includes.
  - `current_period_end` as ISO 8601 with milliseconds → RPC's
    `current_period_end > now()` comparison works.
  - status='canceled' → RPC excludes.
  - status='past_due' → RPC excludes.

#### Open follow-up (not for P8.1)

- **STUB-P8.1.a** — Re-subscribe after cancel hits a UNIQUE constraint
  on `subscriptions.user_id`. The `upsertFromSub` upserts on
  `stripe_subscription_id` only; a new Stripe sub with a different id
  for the same user would try to INSERT a new row, violating
  `subscriptions_user_unique`. The fix is to switch `onConflict` to
  `user_id` (the natural UNIQUE constraint for one-user-one-subscription)
  OR to update the existing row's `stripe_subscription_id` in
  `startSubscription` before the webhook fires. Needs the live Stripe
  account to test (the bug doesn't manifest without a re-subscribe cycle);
  deferred until the Stripe live status ASK is resolved.

Total library tests: 127 passing (was 96, +31 from P8.1).
Total library tests + subscriptions tests: 158 passing (was 127, +31).

### P7.2 — Per-product library detail (`/library/[slug]`)

Status: shipped Slice 1 (2026-06-26). The route + access gate +
product header + per-product file vault + sharing-prevention UI +
lessons/certificate placeholders all live end-to-end. The
"re-watch" surface ships with Phase 15 (P15.2); the "certificate"
surface ships with Phase 15 (P15.11–P15.14). STUB-066 tracks both
deferred sections.

#### What's on the page

1. **Header** (`<LibraryProductHeader>`) — breadcrumb (Home / My
   library / `<product title>`), thumbnail + title + partner +
   short description, source pill (Personal Access / Purchased /
   Granted / Free promo — same shape as the LibraryRow pill), back-
   to-library link. RSC, no client JS.

2. **Files section** (`<LibraryProductFiles>`) — the per-product
   subset of the cross-product file vault on `/library`. Reuses
   `<VaultItem>` so the row shape, last-accessed label, and the
   `<GenerateLinkButton>` client island are byte-identical to the
   library landing. Empty state is distinct from the library landing's
   "no files attached" copy — it points the user at
   `/library/watch/demo` instead.

3. **Sharing rules** (`<LibraryProductSharing>`) — three cards:
   concurrent streams (active count / `MAX_CONCURRENT_STREAMS` with
   a `data-state="cap"` warning state at the limit), rate limit
   (60/hour, shared across downloads + streams), and TTL (4h stream /
   24h download). Plus a footnote linking to `/library/downloads`
   for the user's full per-file log. The cap + TTL numbers are
   constants imported from `@foundations/files/concurrent-streams` —
   no magic numbers in the JSX.

4. **Lessons placeholder** (`<LibraryProductLessons>`) — Slice-1
   placeholder. Shows the expected lesson count + total duration
   from `product.total_lesson_count` + `product.total_duration_seconds`
   so the user sees the scope, plus a "Watch the player demo" CTA to
   `/library/watch/demo` so they can exercise the playback surface
   immediately. The real implementation lands in P15.2 + P15.4
   (lesson list + auto-resume from `lesson_progress`).

5. **Certificate placeholder** (`<LibraryProductCertificate>`) —
   Slice-1 placeholder with a 3-step explainer (finish lessons →
   auto-issue → download PDF) + a link to `/account/certificates`.
   The real implementation lands in P15.11 + P15.12 + P15.13 +
   P15.14 (auto-issue server action + signed PDF + public verify
   route + gallery).

#### Auth + access gates (defense in depth)

Three gates, cheapest first:

1. `requireUser('/library/[slug]')` — anon visitors redirect to
   `/login?next=/library/<slug>` via the same `__next-page-redirect`
   meta-refresh + `NEXT_REDIRECT` mechanism as `/library`.
2. `user_accessible_products(p_user_id)` RPC + JS `.find(slug === X)`
   — products the user doesn't own are filtered out at this layer.
   No product row is fetched for a non-owned slug (no leak).
3. The thin product fetch (`.eq('status', 'published')`) — drafts +
   unpublished rows never surface here even if a future data mistake
   bypasses the access RPC.

The page treats all three failure modes (anon / not-owned /
unpublished / DB error) as 404 — never 403, never a half-rendered
page. The spec's "we do not distinguish 'ineligible' from 'not
found'" rule applies.

#### Data flow (`getLibraryProduct`)

```
┌──────────────────────────────────────────────────────────────┐
│  Step 1: user_accessible_products RPC (1 RT)                 │
│    → find the row matching the requested slug                 │
│    → extract { access_source, granted_at }                    │
│  Step 2: products table (1 RT, .maybeSingle)                  │
│    → thin select (no pricing, no images, no reviews)          │
│    → partner join (public_slug + profile.display_name)        │
│  Step 3: product_files (1 RT) + file_downloads (1 RT)        │
│    → files scoped to this product_id (clean + ready)         │
│    → hydration dedupes newest-first per file_id              │
│  Step 4: countActiveStreams (1 RT, head+count)                │
│    → the user's currently-unexpired stream URL count          │
│  → return LibraryProductPageData                              │
└──────────────────────────────────────────────────────────────┘
```

5 round-trips total (4 from this function + countActiveStreams).
Each step fails soft to a sane default (null / empty array / 0
streams), and any error → null → 404. The two reads that hit the
`file_downloads` audit log are wrapped in fail-soft contracts
identical to `getDownloadHistory` (P7.7) so a transient read error
doesn't break the page.

#### Why we don't reuse `getUserAccessibleFiles` here

That function returns ALL the user's accessible files in one batch,
deduped per product, with the file_downloads hydration done in a
single query. The cross-product `/library` page needs that shape.
The per-product page needs ONE product's files — the in-line fetch
is cheaper (one product_files query against a single product_id
predicate) and avoids loading the full library's audit log just to
filter to one product.

#### Why we don't reuse `getProductBySlug` directly

The public PDP's `getProductBySlug` fetches pricing + images +
reviews + curriculum. The library page doesn't render any of those
(the page is for the owner, not a buyer). Using the slim product
select here keeps the read narrow + the response small + the
defensive mapping minimal.

#### Files

- `02-features/library/queries/getLibraryProduct.ts` (~250 LOC) —
  the query layer. Composed as 4 sequential steps with fail-soft
  defaults.
- `02-features/library/queries/getLibraryProduct.test.ts` (~470
  LOC, 18 unit tests in 3ms) — anon, slug-mismatch, RPC error,
  product error, product missing, happy path, query shape (PII-
  safe select + filters), file_downloads hydration dedupe +
  FK-null skip + read-error fail-soft, partner join defensive
  mapping (array embed + object embed + null), files error
  fail-soft.
- `02-features/library/components/LibraryProductHeader.tsx` +
  `.module.css` (~110 + ~150 LOC) — header with breadcrumb +
  thumbnail + source pill + back-link.
- `02-features/library/components/LibraryProductFiles.tsx` +
  `.module.css` (~55 + ~50 LOC) — per-product file vault
  reusing `<VaultItem>`.
- `02-features/library/components/LibraryProductSharing.tsx` +
  `.module.css` (~110 + ~150 LOC) — three-card grid (concurrent
  streams + rate limit + TTL) + footnote link to
  `/library/downloads`.
- `02-features/library/components/LibraryProductLessons.tsx` +
  `.module.css` (~60 + ~80 LOC) — Slice-1 placeholder. Uses
  `formatDuration` from `@features/product` for the duration
  label.
- `02-features/library/components/LibraryProductCertificate.tsx`
  + `.module.css` (~50 + ~110 LOC) — Slice-1 placeholder with
  3-step explainer.
- `03-app/library/[slug]/page.tsx` (~85 LOC) — RSC route. The
  page composes the 4 sections in a 1fr / 360px layout (main +
  sticky aside on desktop; stacks below 1024px). `force-dynamic`
  for per-user data.
- `03-app/library/[slug]/page.module.css` (~55 LOC) — page
  layout (1fr / 360px grid, mobile breakpoint at 1024px).
- `03-app/library/[slug]/loading.tsx` (~110 LOC) — RSC fallback
  matching the page shape: breadcrumb + thumbnail + title + main
  column (files + sharing) + aside (lessons + certificate).
- `03-app/library/[slug]/loading.module.css` (~120 LOC) —
  token-only fallback styles.
- `03-app/library/[slug]/not-found.tsx` (~30 LOC) — the 404
  surface that fires when `getLibraryProduct` returns null. Two
  CTAs: back to library + browse catalog.
- `03-app/library/[slug]/not-found.module.css` (~80 LOC) —
  token-only 404 styles.
- `02-features/library/components/LibraryRow.tsx` — link target
  changed from `/products/[slug]` to `/library/[slug]` (the
  owner's view, not the public PDP).
- `02-features/library/index.ts` — barrel re-exports the new
  query + 5 components + their prop types.
- `STUBS.md` — new **STUB-066** documents the deferred
  lessons + certificate surfaces.

#### Decisions worth remembering

- **The page is the OWNER's view, not the buyer's view.** The
  `/products/[slug]` page is buy (pricing, gallery, reviews,
  license picker); `/library/[slug]` is own (re-watch, download,
  certificate, sharing). Mixing them would conflate two intents.
  The LibraryRow links to the owner's view because that's where
  the user expects to land when clicking from `/library`.
- **Three security gates, cheapest first.** `requireUser` redirect →
  RPC-based ownership check → DB-row status check. Bad URL or
  non-owned product renders 404, never 403.
- **Slim product select, not full PDP select.** The page doesn't
  render pricing / images / reviews / curriculum. Reading just
  the columns we need keeps the response small and the defensive
  mapping minimal.
- **`valueSep`, not `valueOf`, for the CSS class name.** CSS
  modules export the styles object as a TypeScript module;
  `styles.valueOf` collides with `Object.prototype.valueOf` and
  TypeScript errors. Renamed to `valueSep` (value separator) to
  avoid the reserved name. The semantic is the same.
- **Source pill DNA is `--accent-soft / --accent-line / --accent`
  when access_source === 'subscription'**, matching the existing
  Personal Access pill on LibraryRow + the included banner on the
  public PDP (P8.2). The subscription user gets the same teal-
  driven identity across both surfaces.
- **Sharing card colors are token-only.** At-cap state uses
  `--warn-soft` + `--warn-line` + `--warn` (the design system's
  existing warn trio). The data-state attribute drives the
  variant — no inline colors, no magic values.
- **`<GenerateLinkButton>` is the only client island on the page**
  (inherited from `<VaultItem>`). The page itself is RSC; the
  rate-limit shared across downloads + streams is enforced at the
  server-action boundary (P7.4 bulk-download + P2.4 single-file).
  The /library/[slug] page bundle is `1.29 kB / 115 kB` first-
  load — only +1.3 kB from the new components; shared first-
  load JS unchanged at 101 kB.
- **Lessons + certificate placeholders are shaped for swap-in.**
  Both are standalone RSC components with their own CSS modules.
  When Phase 15 lands, swapping the body of each file to the
  real implementation is a no-op for the page route + the layout.

Total library tests: 145 passing (was 127, +18 from
`getLibraryProduct.test.ts`).
