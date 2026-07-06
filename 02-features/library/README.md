# Feature: library

The buyer's owned content. Reads access from a single SQL function (`user_accessible_products` from migration 0009) that unions `library_grants` (purchase / admin_grant / free_promo) + the active subscription's catalog access. The /library page renders the result in one roundtrip.

- **Spec:** [`01-specs/pages/library.md`](../../01-specs/pages/library.md)
- **Migration:** [`0009_user_accessible_products.sql`](../../04-platform/migrations/0009_user_accessible_products.sql)
- **Owner:** Mavis
- **Depends on:** `@features/checkout` (for `library_grants` writes), `@features/subscriptions` (for `has_active_subscription`), `@foundations/files` (Bunny signed URLs), `@foundations/auth`, `@foundations/data`
- **Depended on by:** none in v1 (admin grant management is PH15)
- **Status:** P7.1 Slice 1 — stats header + grouped file vault. The
  Personal Access / Purchased rails landed in P5.8; the stats tiles +
  grouped vault + 22 unit tests landed in P7.1. **P7.3 — last
  accessed per file** shipped: `last_accessed_at` hydrated from
  `file_downloads` (minimal PII-safe select + JS dedupe), shown as
  "Last accessed: 3 days ago" / "Never accessed" on every VaultItem.
  +6 new unit tests (28 total in the feature). **P7.7 — download
  history (`/library/downloads`)** shipped: new query
  `getDownloadHistory` + filter island + table component + IP-mask +
  UA-shorten helpers. 48 new unit tests (76 total in the feature).
  **P7.9 — file vault search** shipped: three URL-driven filter
  dimensions (product / format / date added) on `/library`'s file
  vault. New `filterVaultFiles` pure helper + new `VaultFilterBar`
  client island + `created_at` added to the `getUserAccessibleFiles`
  select (was sorting by it but not returning it). 20 new unit tests
  (96 total in the feature). **P7.4 — bulk download** shipped (Slice 1):
  per-vault-row checkbox + `<form action="/api/library/bulk-download">`
  + `BulkDownloadBar` client island (count + size + select all +
  download-as-zip) + new `validateBulkRequest` pure validator +
  `buildBulkZip` pure helper (fflate) + POST route handler that
  streams the in-memory zip with one `file_downloads` row per file.
  53 new unit tests (149 total in the feature). **P7.6 — mobile player**
  shipped: a self-contained `<VideoPlayer>` client island (responsive
  16:9, fullscreen, captions, playback rate 0.5×–2×, quality switcher
  with HLS level derivation via hls.js) + a `/library/watch/demo`
  demo route that mounts it with Mux's Big Buck Bunny HLS test stream.
  60 new unit tests on the pure helpers.
  **P7.8 Slice 1 — concurrent-stream limit** shipped: new
  `MAX_CONCURRENT_STREAMS = 3` constant + pure
  `evaluateConcurrentStreamLimit(count, limit)` helper +
  `countActiveStreams(now?)` DB query (RLS-gated to the user's own
  `file_downloads` rows, fail-soft to 0 on read errors). Wired into
  `mintStreamUrlAction` after auth + before the existing rate-limit
  check; returns a new typed error code
  `'too_many_concurrent_streams'`. 26 new unit tests (194 total in
  the feature). **Slices 2+ deferred** (filed as STUB-P7.8):
  token-rotation-on-suspicious-activity + geo anomaly detection +
  admin-side flag (Phase 18 / Phase 14 follow-ups — needs the
  cron + detection-rule surface, ~2-3 more ticks). Slice boundary
  noted in PROGRESS log.
  Phase 15 features (continue watching, progress bars, certificates,
  achievements, watch-page shell that wires the player into a real
  lesson context) still owed.
- **Test locally:** `pnpm test 02-features/library`; with no `BUNNY_SIGNING_KEY` the download endpoint fails closed with a typed error
- **Open follow-ups:** see `01-specs/pages/_followups.md`

## Layout

```
02-features/library/
├── queries/
│   ├── getUserLibrary.ts          — single read via user_accessible_products(user_id)
│   ├── getUserAccessibleFiles.ts  — vault files scoped to owned products
│   ├── getDownloadHistory.ts      — P7.7 user's own file_downloads audit log
│   ├── countActiveStreams.ts      — P7.8 count of unexpired stream URLs (head:true + count:exact)
│   ├── formatIp.ts                — P7.7 IPv4 mask + UA shortener (pure)
│   └── getContinueWatching.ts     — PH15 stub (returns null)
├── actions/
│   ├── mintDownloadUrl.ts         — 24h signed URL after auth + audit
│   └── mintStreamUrl.ts           — 4h IP-bound signed URL for HLS
├── components/
│   ├── LibraryRow.tsx
│   ├── VaultItem.tsx              — + P7.4 checkbox at the left
│   ├── GenerateLinkButton.tsx
│   ├── EmptyLibraryState.tsx
│   ├── LibraryStats.tsx           — 2-tile header stats (Courses + Files)
│   ├── DownloadHistoryTable.tsx   — P7.7 history table
│   ├── DownloadHistoryFilters.tsx — P7.7 history filter bar
│   ├── VaultFilterBar.tsx         — P7.9 file vault filter bar
│   ├── BulkDownloadBar.tsx        — P7.4 selection count + submit button (client)
│   ├── VideoPlayer.tsx            — P7.6 responsive HLS/MP4 video player (client)
│   └── VideoPlayer.types.ts       — P7.6 types + pure helpers (isHlsSrc / formatTime / ...)
├── groupVaultFilesByProduct.ts    — pure helper: flat files → per-product groups
├── filterVaultFiles.ts            — P7.9 pure helper: productId + kind + sinceDays
├── validateBulkRequest.ts         — P7.4 pure validator: Zod + size + count + dedupe
├── buildBulkZip.ts                — P7.4 pure helper: fflate wrapper + name sanitization
├── format.ts
└── index.ts

03-app/library/
├── page.tsx + page.module.css     — + P7.4 <form action="/api/library/bulk-download"> wrapper
├── GenerateLinkButton.tsx (client island)
└── watch/
    └── demo/
        ├── page.tsx               — P7.6 demo route: mounts <VideoPlayer> with Mux HLS test stream
        ├── page.module.css        — token-only demo layout
        └── loading.tsx            — P7.6 Suspense fallback (skeleton header + player skeleton)

03-app/api/files/[id]/
├── download/route.ts              — mints a 24h signed URL, writes file_downloads, 302
└── stream/route.ts                — mints a 4h IP-bound signed URL for HLS playback

03-app/api/library/bulk-download/
└── route.ts                       — P7.4 POST handler: streams zip, writes audit per file
```

## P7.6 design decisions

- **Self-contained `<VideoPlayer>` client island, not coupled to the LMS data model.** The component accepts a `src` (MP4 or HLS) and a few optional props (`poster`, `captions`, `qualities`, `title`, `autoPlay`, `muted`, `initialPlaybackRate`). It doesn't read `lesson_progress`, doesn't know about courses, and doesn't know about signed URLs. The future `/library/watch/[lessonId]` page (P15.2) owns all of that — it passes a `mintStreamUrlAction` result into `<VideoPlayer src={url}>`. The split keeps the player small and re-usable across surfaces (marketing demos, course previews, future admin previews).
- **HLS via `hls.js` as a top-level import.** The library is ~50 KB gzipped and only loads on the `/library/watch/...` route (Next.js code-splits by route). A dynamic import would add complexity for no bundle savings. Native HLS (Safari / iOS Safari) takes the direct-attach path with no library.
- **Pure helpers in a separate module.** `isHlsSrc`, `formatTime`, `nativeHlsSupport`, `buildQualityPresets`, `keyToAction`, `PLAYBACK_RATES`, `DEFAULT_QUALITIES` live in `VideoPlayer.types.ts` (no React, no DOM, no hls.js imports). Unit-tested in 60 tests; the component itself is hard to unit-test (hls.js + DOM events) so the helpers are the contract surface that matters.
- **Quality presets derive from hls.js's reported levels.** When the HLS `MANIFEST_PARSED` event fires, `buildQualityPresets(levels)` produces the dropdown options: always "Auto" + each unique height level sorted descending. For MP4 sources with a single bitrate, the dropdown hides itself (`showQualityDropdown` is `false` when `options.length === 1`).
- **Volume slider is desktop-only.** CSS `@media (max-width: 720px)` hides the in-page volume slider; the mute button stays. Mobile devices use hardware volume buttons (iOS Safari's system overlay conflicts with in-page sliders — same convention as YouTube / Netflix / Vimeo).
- **Auto-hide controls after 3s (not 2s like desktop players).** Touch users need more time to register the controls after tapping — 2s feels too aggressive on small screens. The timer resets on every `mousemove` / `timeupdate` / state change; controls stay visible during pause.
- **Big center play button covers the entire video surface.** Tapping anywhere outside the controls bar toggles play/pause (when controls are visible) or reveals the controls (when hidden). The 88×88px visual circle is the focal point; the hit area is the full surface — easier on small screens than a tiny play button.
- **Native `<select>` for rate + quality dropdowns.** Not custom popovers. The platform picker is the right UX on iOS / Android (saves us building a touch-friendly popover), and it's keyboard-navigable on desktop for free.
- **Buffered region via inline CSS variables.** The seek bar uses `style={{ '--seek-progress': '...', '--seek-buffered': '...' }}` + a gradient track that consumes the variables. The values change on every `timeupdate` / `progress` event; the gradient re-renders without JS state churn.
- **`<track kind="subtitles">` for captions** + `track.mode = 'showing' | 'hidden'` for the toggle. Standard WebVTT rendering — the browser handles positioning, sizing, font, etc. The player doesn't render its own captions overlay.
- **CAPTCHA-style `<kbd>` styling for the help section** uses `--font-mono` + `--bg-elev-2` + `--r-xs`. Matches the design-system keyboard-shortcut pattern (used in checkout's Stepper + the search overlay + the future P15.2 watch page).
- **Keyboard shortcuts** (`Space`, `←/→`, `j/l`, `m`, `f`, `c`, `0-9`) are decoded via `keyToAction` (pure helper) — modifier-held keys pass through to browser shortcuts (reload, devtools, etc.). The decoded action is one of: `play`, `mute`, `fullscreen`, `captions`, or a number (`±5` for ArrowLeft/Right, `±10` for j/l, `0..0.9` for digit keys).
- **Auto-hide timer doesn't run during pause.** Paused state means controls stay visible — the user needs them to be able to play again. Timer kicks in only after the first `play` event fires.
- **Demo URL is a public HLS test stream** (Mux's Big Buck Bunny) — well-known stable URL that exercises ABR (multiple quality levels) so the quality switcher dropdown has something to render. The URL is NOT IP-bound or signed; the component is agnostic to that. Production streams from `mintStreamUrlAction` are IP-bound + signed; the future P15.2 watch page passes them in.

## Hot-path design (500+ courses, 10k+ users)

- **No N+1** — the /library page calls one RPC (`user_accessible_products`) and gets the full product list in a single rowset. The query plan uses the existing `library_grants_user_idx` and `subscriptions_active_lookup_idx`; both are index-only scans.
- **Subscription access is computed at read time** — there are no per-product INSERTs for the subscription case. When a subscription is canceled, the next /library render simply excludes the PLR catalog from the user's view.
- **Signed URLs are minted on demand** — the "Generate link" button posts to a server action that:
  1. Verifies the user has access to the file's product (via `user_accessible_products` or the `library_grants` direct check for purchase grants).
  2. Mints a 24h signed URL via `signCdnUrl`.
  3. Writes a `file_downloads` row (append-only audit log).
  4. Returns the URL + expiry.
- **No CDN side access** — Bunny rejects requests without a valid signed token. Even if a URL leaks, the 24h TTL bounds the blast radius. The `file_downloads` table is the abuse-detection source.
- **Rate limit is in-process for v1** — 60/hour per user (the spec's number). v2 backs this with a Supabase `rate_limit_events` table when we go multi-instance. STUB-013.

## What this page is NOT

- **No video player on `/library`** — the player is `<VideoPlayer>` (P7.6) mounted at `/library/watch/[lessonId]` (P15.2). The /library landing page just lists the user's owned products + file vault + download history; it does NOT embed the player. Phase 15 P15.2 owns the lesson view (player + notes + Q&A + resources + nav).
- **No progress tracking UI** — `lesson_progress` table exists (P15.1) but the /library page only reads the `library_grants` + `subscriptions` union. The watch page (P15.2) owns progress write/read + resume.
- **No certificates UI** — the `certificates` table exists (P15.1); the cards are P15.11 + P15.12.

## P7.1 Slice 1 design decisions

- **Header stats tiles use the same shape as `/admin/categories` and `/partner/payouts`** — 11px uppercase label, 24px tabular-numeric value, hairline border, no shadow. Token-only CSS; no inline `style={{ color }}` (the ledger's `LedgerSummary` still has one — that's flagged elsewhere; this slice stays clean).
- **2 tiles now, 4 when Phase 15 lands** — `grid-template-columns: repeat(2, minmax(0, 1fr))` so the grid extends cleanly. The Watch-seconds and Certificates tiles wait on the Phase 15 progress + certificate aggregates.
- **`groupVaultFilesByProduct` is a pure helper** — no DB, no I/O. Stable order: groups sorted by `product_title` (case-insensitive), per-product file list preserves the source's `created_at desc` order. The first file sighting for a product_id wins the `product_title` / `product_slug` (defensive — the query joins the product so this shouldn't diverge in practice).
- **Vault empty state has 2 flavors** — "no library items at all" routes through the existing `<EmptyLibraryState>` early-return; "has library items but no files attached" shows a smaller inline "No downloadable files for any of your courses yet." + Browse CTA.

## P7.3 design decisions

- **`last_accessed_at` is hydrated from `file_downloads`, not stored on `product_files`.** Storing it on the file would require a trigger or write path that touches every download mint — and `file_downloads` is already the audit log, so we read what we already write. The cost is one extra query per `/library` render; bounded by the user's owned file count.
- **Minimal select on the audit-log read.** `file_id, created_at` only. `ip_hash`, `ip_raw`, `user_agent`, `range_start`, `range_end`, `bytes_served`, `edge_location`, `url_expires_at` are NOT pulled — the vault page has no use for them, and shipping PII into RSC payloads is forbidden by AGENTS.md. The unit test asserts the exact select payload to catch a regression.
- **JS dedupe over the newest-first page.** The query sorts `created_at DESC`; the dedupe keeps the first sighting per `file_id`, which IS the latest because of the order. The result Map is iterated in source order — no sort needed because the input is already ordered.
- **`null` file_id rows are skipped.** The FK is `ON DELETE SET NULL`, so audit rows whose source `product_files` row was deleted have `file_id = null`. We skip them before the dedupe — they don't correspond to any current vault row, and the JS Map is keyed by `file_id` so they would never match anyway, but skipping them explicitly is the contract.
- **`formatTimeAgo` from `account/profile/queries/`** — pure, server-safe, no DB. Reused across features rather than duplicated. The "Never accessed" fallback is the same string the formatter returns for `null`, so the helper is the single source of truth.
- **No new index.** The existing `file_downloads_user_created_idx (user_id, created_at desc)` covers the new read. Volume is bounded by the rate limit (60/h/user), so the dedupe loop runs in single-digit ms even at the high end.

## P7.7 design decisions

- **New page (`/library/downloads`), not a section of `/library`.** The download log is large (could be hundreds of rows for a power user), filterable (kind + window), and conceptually separate from the "what do I own" surface. Embedding it in `/library` would either force the filter UI on every page load or split the page into tabs. A dedicated route gives the page its own loading state, its own nav entry, and its own `noindex` — same surface class as `/library` for privacy.
- **Filter state in the URL, not in server state.** The two filter dimensions (kind + window-days) compose into 12 valid combinations; URL-driven means back-button works, links share, and the page re-fetches on every nav. The `DownloadHistoryFilters` client island owns the URL push, the page reads `searchParams` and re-runs the query. Same pattern as `BrowseSortSelect` (P0.16).
- **Default-strip in the URL.** When `kind = 'all'` or `days = '365'` (the most common case), the param is omitted from the URL. The canonical URL stays `/library/downloads` rather than `/library/downloads?kind=all&days=365`. A user who wants to share a specific view adds the param; the default doesn't bloat the URL.
- **365-day default window.** Matches the spec's "every signed URL mint" intent while bounding the query for p95. The signed URL itself is 24h / 4h TTL so anything older than a year is rarely actionable for the user — the row still exists for audit purposes (RLS-gated, no PII redaction at row level). The `?days=all` URL param lifts the cap for users who want the full log; the page notes the truncation in the summary line when the result hits `MAX_HISTORY_ROWS`.
- **Defensive mapping for both joins.** `file_id` AND `product_id` are `ON DELETE SET NULL`, so the page can render rows whose source product/file was deleted. The query uses array-embed defensive mapping (`Array.isArray(r.file) ? r.file[0] : r.file`) to handle PostgREST's varying response shapes — same pattern as `getUserAccessibleFiles`. The page renders "(product deleted)" / "(file deleted)" placeholders so the row is still informative.
- **`windowSince` is the single source of truth for date math.** Pure helper, takes `days | 'all' | null | undefined` + injectable `now` for tests. Exported so any future surface (admin downloads log, partner uploads log) can reuse the same "last N days" semantics.
- **PII at render time, not at query time.** `ip_raw` is selected from the DB; `maskIp()` masks the last octet at render. Same for `user_agent` + `shortUserAgent()`. The query is simple (no `CASE WHEN ip4` SQL gymnastics), the masking is in one helper, and a future admin surface can opt out of the mask by importing the raw value. Defense in depth.
- **`ip_hash` is never selected.** It's an internal abuse-detection hash (SHA-256 of `ip + date`). Showing it to the user is meaningless — they can't act on it. The query select omits the column; the unit test asserts the omission.
- **`getDownloadHistory` echoes the normalized filters in the result.** The page reads `result.filters` to render the summary line ("Showing N downloads in the last 365 days") rather than re-parsing the URL. Same pattern as `getPartnerLedger` (P6.3) — filters echo is the contract.
- **Failed read = empty list + `total_in_window: -1`.** The page distinguishes "0 rows" from "couldn't tell" via the `-1` sentinel. The error state copy explains the gap ("We could not load your download history. This is usually a temporary read error."). The query never throws — the page never crashes.
- **`(empty filtered list)` vs `(no rows at all)` are different empty states.** When the user has filters active and gets 0 rows, the page says "No downloads match the current filter. Try widening the window." When they have no filters and 0 rows, the page says "You haven't generated any download links yet." Both have a Go-to-library link. The two copies match the spec's two intent branches.
- **No new index.** The existing `file_downloads_user_created_idx (user_id, created_at desc)` covers the new read. The page adds a `.gte('created_at', since)` filter — that's a single range scan on the same index, no extra index needed.
- **The library nav link is between "All content" and "Orders".** Matches the surface priority (downloads is a library-side concern; orders is account-side). The link is a sibling of the existing links, no active-state styling (the page is RSC, doesn't know the active route without `usePathname`; active state is a future improvement).

## P7.9 design decisions

- **Pure helper, not a query.** The filter lives in `filterVaultFiles(files, opts)` — a pure function over the existing `getUserAccessibleFiles` result. No second DB call. The query stays the canonical read (used by the page, the future partner "my files" panel, the future admin download log); filtering by URL params is a UI concern that doesn't belong in the data layer. Pure functions are trivial to test (20 unit tests, 2ms wall time).
- **Filter the full vault, then group.** The page reads the full vault from `getUserAccessibleFiles`, applies `filterVaultFiles`, then re-runs `groupVaultFilesByProduct` on the filtered rows. The grouped shape survives filtering — one `<h3>` per product that still has rows, with a count badge that updates per group. The summary line "Showing N of M files" is computed once (full vs filtered) and gives the user a stable reference point.
- **`created_at` added to `VaultFile`.** The query was sorting by `created_at` desc but not returning it. The date filter needs the column, so it's now in both the `.select()` payload and the `VaultFile` type. The mapper defaults to `null` for a missing column (defensive — the schema is NOT NULL, so this only fires on a malformed row). Two existing tests updated to assert the new field; both groups' helper tests default it to `null` so the helper test stays decoupled from the query hydration path.
- **URL-driven, default-strip.** Three filter dimensions compose into ~8 × 8 × 4 = ~256 valid combinations. URL-driven means back-button works, links share, and the page re-fetches on every nav. Default-strip (`product` omitted when "all", `kind` omitted when "all", `since` omitted when "all") keeps the canonical URL clean. The page reads `searchParams` and the bar syncs from `useSearchParams` on every change — same pattern as `DownloadHistoryFilterBar` (P7.7) and `BrowseSortSelect` (P0.16).
- **Product chip group is dynamic, not fixed.** The bar receives `availableProducts` as a prop from the RSC, derived from the unfiltered vault rows. The chip group only shows products the user owns — defense in depth: even if the URL contains a `product_id` the user doesn't own, the filter returns `[]` and the page renders the "No files match" empty state.
- **No new query, no new index.** The date filter operates on rows already in the page payload. The volume is bounded by the user's owned file count (rarely > 50) so the per-render filter is microsecond-fast. The existing `product_files (product_id, kind)` index from the data model still serves the (unchanged) vault read.
- **`tabular-nums` on the summary count.** The "Showing N of M files" line uses `font-variant-numeric: tabular-nums` so the digit count doesn't shift the layout when filters change the result count. Same UX touch as the `payout_ledger` summary cards (P6.3).
- **`sinceDays = 0` returns empty.** Defensive guard for invalid input — the page's parser rejects `0` and negative values upstream and passes `null` instead, but the helper stays safe if called directly (returns `[]` instead of matching everything). Same shape as `windowSince` in `getDownloadHistory.ts` (P7.7).
- **Empty state copy is filter-aware.** Two empty-state branches: (a) "No downloadable files for any of your courses yet." when the user's vault has 0 rows (the existing state), and (b) "No files match the current filter." when the vault has rows but the active filters exclude all of them (new). The diagnostics differ — "your courses don't have source files" vs "the filters are too narrow" — so the copy differs. Both branches offer a path forward (Browse catalog vs Clear filters).
- **Product chip wrapping vs scroll.** Power users might own 50+ products. The Product chip group is `flex-wrap: wrap` (not a horizontal scroll) so the user sees every option without scrolling. Long titles get `white-space: nowrap` so they don't break mid-word, but the parent wraps when it runs out of room — the next filter row (Format) starts on its own line below.

## P7.4 design decisions

- **In-memory ZIP via fflate, not streaming.** fflate's `zip()` is the only ZIP API it offers; streaming-zip libs (archiver, yazl) aren't in this project's deps. The 256 MiB `MAX_BULK_BYTES` cap keeps the in-memory working set bounded — comfortably below the default Node heap ceiling on Coolify. Larger bulk requests are rejected with a friendly message at the boundary.
- **Files grouped by product in the archive.** `<ProductTitle>/<OriginalFilename>` — same-name collisions across products stay safe (each lives in its own folder). The pure helper `bulkEntryName(productTitle, originalFilename)` + `sanitizePathSegment()` does the path joining + traversal defense (drop `:`, escape `\` and `/`, cap at 200 chars). Once the `/` is escaped, `..` can't escape the archive root.
- **Pure validator + pure zip builder.** Both `validateBulkRequest` and `buildBulkZip` are pure (no DB / no I/O) and unit-tested independently. The route handler is a thin glue layer: read form data → validate → resolve rows from DB → sign URLs → fetch bytes → build zip → write audit → return response. End-to-end smoke is the dev-server round-trip.
- **Rate limit counts as N hits per request.** A 10-file bulk request consumes 10 of the 60/hour quota. Matches the cost the user would pay by minting each URL individually. Charged AFTER validation (malformed requests don't eat quota) but BEFORE the fetches (a mid-stream rate-limit denial is much worse than a fast 429).
- **Per-file audit, not per-zip.** One `file_downloads` row per file (kind='download'), same shape as the single-file surface. The user's `/library/downloads` history (P7.7) reflects every bulk-downloaded file as if they had generated the URL one by one.
- **Plain HTML form, no client JS for submission.** The vault groups are wrapped in `<form action="/api/library/bulk-download" method="post">`. Standard browser submission streams the zip back via the `Content-Disposition: attachment` response header. The `BulkDownloadBar` client island only owns the count display + select-all/clear + submit-button enabled state. Falls back gracefully if JS fails — the user can still tick boxes and submit manually.
- **`checkboxes` rather than URL params.** File ids can be in the dozens; URL-encoded query params would blow past length limits and make the link un-shareable. Form-data body + `Content-Type: application/x-www-form-urlencoded` (the browser default for `<form method="post">`) is the right shape for "many ids at once."
- **Files fetched in parallel, capped at 5 concurrent.** Pure parallelism would let a 50-file request open 50 simultaneous CDN connections; 5 is a polite middle ground that bounds the bandwidth spike without making the request sequential. Each worker reads the full body into a `Uint8Array` so fflate has a complete payload to zip.
- **Defensive mapping for the product join.** The route handler's row-shape mapper handles array-embed / object-embed / null for the `product:products(title)` join, with a `'Untitled'` fallback. Matches the `getUserAccessibleFiles` defensive-mapping pattern.
- **256 MiB cap, not 2 GiB.** Originally drafted at 2 GiB; lowered to 256 MiB for v1 because the in-memory zip pipeline holds every file's bytes simultaneously. 256 MiB covers the "non-video vault" use case (slide decks + transcripts + graphics for a typical PLR course). Video source uploads are typically larger and should be downloaded individually. The cap is in `validateBulkRequest.ts` as a single source of truth.
- **No new DB index.** The new reads (single SELECT by id-set, single INSERT batch of N rows) hit existing indexes (`product_files` PK on `id`, `file_downloads` PK on `id`).

## P7.8 design decisions (Slice 1 — concurrent-stream limit)

- **`MAX_CONCURRENT_STREAMS = 3`, not configurable in v1.** Hardcoded as a module constant in `00-foundations/files/concurrent-streams.ts`. 3 covers "laptop + phone + tablet" — the realistic multi-device ceiling — without inviting the "one user farming 10+ streams" abuse pattern. A per-tier override (subscribers get 5) is a one-line change in `mintStreamUrlAction` if/when needed; the helper signature stays the same.
- **Pure decision helper + thin DB query.** `evaluateConcurrentStreamLimit(count, limit)` is pure (no DB / no env / no clock) and trivially unit-testable in 13 tests. `countActiveStreams(supabase, userId, now?)` is the thin DB read. Splitting them keeps the policy decision testable without Supabase and the query swappable for a different data source if the audit log ever moves.
- **`countActiveStreams` reads `url_expires_at`, not a derived `is_active` flag.** The signed URL's TTL is the source of truth — Bunny enforces it. A dedicated boolean would drift. The query is `head: true` + `count: 'exact'` (no row payload — just the integer), and selects only `id` (zero PII crosses the wire).
- **Fail-soft to 0 on read errors.** The concurrent-stream limit is a courtesy, not a security boundary. A failed read should NOT block the legitimate user from watching their videos — they get a successful mint instead of a confusing 500. Same shape as `getDownloadHistory`'s fail-soft contract. The warning log surfaces ops-visible abuse signals without bricking the player.
- **Check runs BEFORE the mint-volume rate limit.** The 60/hour limit bounds mint *volume* (rapid cycling). The 3-concurrent limit bounds mint *state* (long-lived unexpired URLs). They complement each other; a user can't cycle 60/hour past the concurrent ceiling because each mint costs an extra active slot. Both checks are independent failures (typed error codes `rate_limited` and `too_many_concurrent_streams`).
- **IP-binding is NOT a substitute for this limit.** Stream URLs are IP-bound (per spec), so a user can't share them with a second device in a different network. But the limit prevents the same user from minting N URLs and starting N players on their OWN devices — bandwidth abuse at the CDN's expense. Different threat model, complementary defense.
- **No new DB index for the count query.** The existing `file_downloads_user_created_idx (user_id, created_at desc)` covers the user_id predicate; the planner falls back to a seq scan for the `kind` and `url_expires_at` filters. Volume per user is bounded by the in-process rate limit (60/hour) so the scan is microseconds in practice. A partial index `WHERE kind='stream'` is a v2 optimization if p95 ever shows the scan.
- **Bigint-as-string defensive coercion.** PostgREST may return `count` as a string in some configs. The helper coerces: `typeof count === 'number'` → use it; `string` → `Number.parseInt` (NaN → 0); `null` → 0; negative → 0. The unit test asserts all four branches.
- **`_resetConcurrentStreamLimitForTests` is a no-op.** The helper is pure — there's nothing to reset. Kept as a re-export for symmetry with `rate-limit.ts` so the test-harness can pattern-match against the existing module.
- **Slices 2+ deferred.** Token-rotation-on-suspicious-activity + geo anomaly detection + admin-side flag (Phase 14 P14.18) require a detection-rule surface and a cron — different scope than Slice 1's read-and-check. Filed as STUB-P7.8 to land in a later phase.
