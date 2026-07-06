# Watch — `/library/watch/[lessonId]`

> **Note:** this spec covers the P15.2 surface (full course player
> shell with lesson list + tabs + Q&A). P7.6 ships the player
> **component** + a demo mount at `/library/watch/demo`. The actual
> `/library/watch/[lessonId]` page wires the player into a real
> lesson context (Phase 15).
>
> The P7.6 player is the canonical video surface that P15.2 composes
> into its lesson view. P7.6 owns the player; P15.2 owns the shell.

## What this page does

The buyer's per-lesson learning surface. Wires the responsive video
player (P7.6) to a real lesson's HLS stream (signed + IP-bound via
`mintStreamUrlAction`), with the lesson's notes / Q&A / resources
panels alongside. Auto-resumes from the last watched position via
`lesson_progress`.

This page is the focal point of the LMS — it's where the buyer
spends the most time, and the quality of the experience directly
maps to retention + completion rate.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Lesson header | `lesson.title`, `lesson.position_in_product`, `lesson.duration_seconds`, `product.title`, `partner.display_name` | `lessons` + `products` + `profiles` joins | sticky header with breadcrumb |
| Video player | HLS manifest URL | `mintStreamUrlAction(fileId)` | VideoPlayer client island |
| Captions track | VTT URL | `lesson.captions_vtt_url` (when present) | `<track kind="subtitles">` inside the player |
| Resume position | `lesson_progress.position_seconds`, `lesson_progress.completed` | `lesson_progress` (RLS self-only) | auto-seek on mount |
| Lesson notes | markdown body | `lesson.notes` | rendered markdown panel |
| Q&A | public questions + instructor answers | `lesson_qa` | list with reply form |
| Resources | downloadable files for this lesson | `product_files` joined to lesson | file rows with `mintDownloadUrlAction` |
| Lesson nav | prev / next lesson IDs + titles | `lessons` adjacent rows | bottom nav buttons |

**Queries:** all in `02-features/library/queries/` (new
`getLessonById`, `getLessonNotes`, `getLessonQa`,
`getLessonResources`) — Phase 15.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Play / pause | Click player or Space | VideoPlayer internal | self |
| Seek | Click seek bar or ←/→ | VideoPlayer internal | self |
| Change playback rate | Rate dropdown | VideoPlayer internal | self |
| Toggle captions | CC button or C key | VideoPlayer internal | self |
| Toggle fullscreen | Fullscreen button or F key | VideoPlayer internal | self |
| Save resume position | Debounced `timeupdate` (5s) | Server action writes `lesson_progress` | self |
| Mark lesson complete | "Mark complete" button or video ended | Server action writes `progress.completed = true` | self |
| Post Q&A question | Submit form | Server action inserts `lesson_qa` row | self |
| Reply to Q&A | Submit form on a question | Server action inserts `lesson_qa` reply | instructor (for own lessons) + admin |
| Download resource | Click "Generate link" | `mintDownloadUrlAction(fileId)` | self |

## What this page does NOT do

- No social features (no share progress, no compare with friends)
- No live-stream or multi-user sync
- No in-player quizzes (separate Quiz feature, future)
- No DRM beyond signed HLS + IP-binding (per `mintStreamUrlAction`)
- No auto-issue certificates on completion (Phase 15 P15.11)

## Acceptance criteria

- [ ] Page is auth-gated — unauth users redirect to
      `/login?next=/library/watch/[lessonId]`
- [ ] Access check — user must have an active `library_grant` for the
      product the lesson belongs to (subscription or purchase)
- [ ] Video player mounts with the signed HLS manifest URL from
      `mintStreamUrlAction` (rate-limited + IP-bound)
- [ ] Player resumes from `lesson_progress.position_seconds` on mount
- [ ] Player saves `lesson_progress.position_seconds` on debounced
      `timeupdate` (5s debounce; RLS self-only)
- [ ] "Mark complete" CTA writes `lesson_progress.completed = true`
      and surfaces a toast
- [ ] Lesson notes panel renders the markdown body
- [ ] Q&A panel lists questions + replies; new question form works
- [ ] Resources panel shows the lesson's downloadable files with
      "Generate link" buttons (calls `mintDownloadUrlAction`)
- [ ] Prev / next lesson nav works at lesson boundaries
- [ ] All player keyboard shortcuts work (Space, ←/→, j/l, m, f, c, 0-9)
- [ ] Player is responsive at all viewports (mobile, tablet, desktop)
- [ ] Captions toggle works when a captions track is provided
- [ ] Page renders in < 1.5s p95 for first frame of the player
- [ ] All server actions audit-logged (signed URL mints, lesson
      progress writes, Q&A posts)

## Design reference

- Player component: `02-features/library/components/VideoPlayer.tsx`
  (P7.6 — responsive, fullscreen, captions, playback rate, quality switcher)
- Mockup: TBD (Phase 19 marketing surface will provide)
- Lesson nav + tabs: TBD (P15.2 design)

## Security

- **Auth required:** YES — `requireUser('/library/watch/[lessonId]')`
- **Access check:** user's `user_accessible_products` RPC result must
  include the lesson's product_id. Subscription OR purchase grant.
- **Signed URLs:** HLS manifests are IP-bound + 4h TTL (per
  `mintStreamUrlAction`); resources are 24h TTL, NOT IP-bound (per
  `mintDownloadUrlAction`).
- **Rate limit:** 60 signed URLs per user per hour (shared across
  downloads + streams).
- **RLS:** `lesson_progress` is self-only; `lesson_qa` public-read
  + author-write; `lessons` inherits product RLS; `product_files`
  public-read for published rows.
- **PII:** no PII surfaced. `file_downloads` row per URL mint logs
  the user's IP hash (not raw) for abuse detection.
- **Audit:** `lesson_progress` writes are not audited (volume is
  high; abuse-detection is via the lesson_progress aggregate); Q&A
  posts + replies ARE audited.

## Performance

- **Target p95:** < 1.5s for first frame of the player
- **Render strategy:** RSC shell + VideoPlayer client island
- **Cache:** none on this page (user-specific)
- **DB indexes:**
  `lessons (product_id, position_in_product)`,
  `lesson_progress (user_id, lesson_id)` UNIQUE,
  `lesson_qa (lesson_id, created_at desc)`
- **Bundle size budget:** the VideoPlayer client island adds ~15 KB
  (component + hls.js tree-shaken for the level-set in use). The
  /library landing page does NOT bundle this (the page route is
  code-split).

## Out of scope for v1

- Live-stream or multi-user sync
- In-player quizzes
- DRM beyond signed HLS + IP-binding
- Auto-issue certificates on completion (Phase 15 P15.11)
- Notes export (P15.6)
- Bookmarks (P15.5)
- Chapter markers inside a single video (P15.16 drip content)

## Open questions for human

- **Captions VTT hosting:** where do VTT files live? Bunny Storage
  as `captions/<lesson_id>.vtt`? Or an external CDN? My
  recommendation: Bunny Storage as `captions/<lesson_id>.vtt`,
  served via a public read URL (captions are not sensitive).
- **Q&A moderation:** should new questions require instructor
  approval before they're public, or are they public-by-default
  with the instructor able to hide? My recommendation: public by
  default (matches Skillshare / Udemy), with a "hide" affordance.
- **Resume position precision:** should `position_seconds` be saved
  per-device (so resuming on iPad picks up where you left off on
  iPhone) or per-user (one position across devices)? My
  recommendation: per-device — matches Netflix / YouTube, and avoids
  the "resume to a position that doesn't match the playback rate
  on this device" bug.

## Implementation notes

### P7.5 Slice 1 — Resume from URL (this tick)

P7.5 splits into slices. Slice 1 lands the parts that don't depend on
Phase 15's `lesson_progress` schema (P15.1) — the resume-from-URL
surface is fully usable today via a `?t=<seconds>` URL param, and the
Phase 15 watch page just swaps the URL param for `lesson_progress.
position_seconds` when P15.1 lands.

#### What Slice 1 ships

- New `initialSeekSeconds?: number` prop on `<VideoPlayer>`. The
  player seeks to this offset the first time the video's duration
  becomes finite AND a non-zero seek target is supplied. Guarded by
  a `useRef`-keyed "seek applied" guard so a re-render with the same
  prop doesn't re-seek mid-playback.
- New pure helper `parseResumeSeconds(raw)` in
  `02-features/library/components/VideoPlayer.types.ts`. Validates a
  raw URL string into a non-negative finite seconds value ≤ 12 hours,
  with the same defensive hardening as the rest of the URL-param
  surface (`parseOrderId`, `parseRefundId`): rejects negatives,
  scientific notation, hex/octal, non-numeric chars, SQL/shell
  injection strings, control characters, and zero-width / full-width
  unicode digit tricks. 28 unit tests.
- New `RESUME_SECONDS_MAX = 43,200` (12 hours) constant — the longest
  video on the catalog is well under 4h, but a tampered `?t=999999999`
  should not produce a NaN / Infinity that the player's
  `loadedmetadata` handler can't reason about.
- The `/library/watch/demo` route now accepts a `?t=<seconds>` URL
  param and passes the parsed value to `initialSeekSeconds`. A new
  "Resume at M:SS" hint banner sits above the player when a valid
  `?t=` is present, so the resume UX is visible without playing the
  video. Five example links in the help section cover the
  happy / invalid / negative / empty / oversize paths.
- Library barrel (`02-features/library/index.ts`) re-exports
  `parseResumeSeconds` + `RESUME_SECONDS_MAX` alongside the existing
  pure helpers.

#### What Slice 1 doesn't ship (Phase 15 territory)

- **`lesson_progress` table** — the schema for saved position
  per `(user_id, lesson_id)` lands in P15.1. Slice 1 has no DB
  surface; the resume target is purely URL-driven.
- **Debounced `timeupdate` save** — the player fires
  `onTimeUpdate` already (via the `currentTime` state); P15.2 wires
  the parent's debounced server-action write.
- **Range-request proxy endpoint** — Bunny CDN handles HLS segment
  range requests natively (signed URL segments respond with
  `Accept-Ranges: bytes` + `Content-Range` headers per
  `00-foundations/files/README.md` line 47). The P7.5 PHASES.md line
  "range request support" is satisfied by Bunny's edge behavior; we
  do not proxy segments through our API in v1. If a future need
  emerges (e.g. per-segment audit logging) a dedicated route can
  proxy through `mintStreamUrlAction`'s signed URL.
- **`?t=<seconds>` enforcement on the production watch page** —
  `/library/watch/[lessonId]` (P15.2) accepts the same URL param but
  resolves it from `lesson_progress` first, falling back to `?t=`
  when no progress row exists (so deep-linkable resume URLs work
  even when the user is logged out / hasn't started the lesson).

#### Decisions worth remembering

- **`initialSeekSeconds` is seek-on-mount, not seek-on-render.** The
  effect waits for `duration` to be finite (the video has loaded
  metadata) before applying the seek. Without this guard, setting
  `video.currentTime` before metadata loads throws on most browsers
  and is a no-op on the rest. The 3-tuple `(src, initialSeekSeconds,
  duration)` dep array means a re-render with the same inputs is
  a no-op (the `seekAppliedRef.current` guard prevents double-seek).
- **The cap is 12 hours, not "video duration - 1".** The duration
  isn't known at URL-parse time (the player is async), and a
  separate `if (target > duration - 0.1)` clamp in the effect
  handles "seek past EOF" gracefully. Splitting the two guards means
  the parser is deterministic (testable) and the player effect is
  defensive against runtime values.
- **`Math.floor(n)` floors to whole seconds.** The saved resume
  position is always whole-second (the lesson_progress schema will
  use `integer` not `numeric(10,3)`), and fractional seek targets
  add jitter without value. `0` is a valid return — the parent
  passes 0 to `initialSeekSeconds`, the player effect no-ops on
  `target <= 0` (no seek to start — that's the default anyway).
- **The example links in the help section are clickable** — they
  use the same `<a href>` pattern as a normal link, no client JS.
  A user clicking `?t=512` lands on the page with the resume banner
  visible. Power-user affordance: the URL is shareable, so a user
  can copy a `?t=512` link to a coworker and they'll resume at the
  same offset.
- **No new DB migration, no new RLS.** Slice 1 is purely a
  client-side surface change. The lesson_progress schema arrives
  with P15.1.

### P7.6 — Mobile player (this surface's canonical video component)

P7.6 ships the player **component** + a demo mount at
`/library/watch/demo`. P15.2 wires the player into the real
`/library/watch/[lessonId]` lesson view with lesson data + auto-
resume + Q&A + resources + nav.

#### Component contract

`<VideoPlayer>` is a self-contained client island that accepts:

- `src: string` — MP4 URL or HLS `.m3u8` URL
- `poster?: string` — poster image URL
- `captions?: { src: string; lang: string; label: string }` — WebVTT
- `qualities?: VideoPlayerQuality[]` — quality presets (HLS levels)
- `title?: string` — accessible name
- `autoPlay?: boolean` — autoplay on mount (default false)
- `muted?: boolean` — initial mute (default false)
- `initialPlaybackRate?: number` — start rate (default 1)
- `className?: string` — outer container class

It handles HLS via `hls.js` (top-level import; ~30 KB gzipped to
the watch route's bundle only — `/library` does NOT include it).
Native HLS (Safari) takes the direct-attach path with no library.

#### Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` / `k` | play / pause |
| `←` / `→` | seek ±5s |
| `j` / `l` | seek ±10s (YouTube-style) |
| `m` | mute toggle |
| `f` | fullscreen toggle |
| `c` | captions toggle |
| `0`–`9` | jump to 0% / 10% / … / 90% |

Modifier-held keys (ctrl/alt/meta) pass through to browser shortcuts
(reload, devtools, etc.).

#### Files (P7.6)

- `02-features/library/components/VideoPlayer.tsx` (~440 LOC) — main client island
- `02-features/library/components/VideoPlayer.types.ts` (~190 LOC) — types + pure helpers
- `02-features/library/components/VideoPlayer.types.test.ts` (~180 LOC, ~60 unit tests) — pure helper coverage
- `02-features/library/components/VideoPlayer.module.css` (~330 LOC) — token-only styles
- `03-app/library/watch/demo/page.tsx` — demo mount (RSC)
- `03-app/library/watch/demo/page.module.css` — demo layout (token-only)
- `03-app/library/watch/demo/loading.tsx` — Suspense fallback (RSC)
- New dep: `hls.js@^1.5.17` (resolved to 1.6.16)
- `02-features/library/index.ts` — barrel re-exports the component + helpers + types
- `01-specs/pages/library-watch.md` — this spec
- `02-features/library/README.md` — P7.6 section

#### Tests

60 unit tests covering the pure helpers (`isHlsSrc`,
`formatTime`, `nativeHlsSupport`, `buildQualityPresets`,
`keyToAction`, `PLAYBACK_RATES`, `DEFAULT_QUALITIES`). The
component itself is hard to unit-test (hls.js + DOM events); the
helper coverage is the contract surface that matters. E2E coverage
lands in Phase 20 P20.3 (Playwright).

#### Decisions worth remembering

- **Top-level import of `hls.js`** rather than dynamic — the player
  is only ever loaded on `/library/watch/...`, so the bundle impact
  is bounded to that route. Dynamic import would add complexity for
  no bundle savings.
- **Quality preset derivation** — for HLS, the player builds the
  quality dropdown from `hls.js`'s reported `levels` via
  `buildQualityPresets` (always prepends `Auto`; skips levels with
  height=0; dedupes by height; sorts descending). For MP4 sources
  with a single bitrate, the dropdown hides itself.
- **Volume slider is desktop-only** (CSS `@media (max-width: 720px)`
  hides it). iOS Safari's system volume overlay conflicts with
  in-page volume sliders; Android devices use hardware buttons.
  This is the YouTube / Netflix / Vimeo convention.
- **Auto-hide delay is 3s** (not the desktop-player standard 2s).
  Touch users need more time to register the controls after tapping
  — 2s feels too aggressive on small screens.
- **Native `<select>` for rate + quality** — not custom popovers.
  The platform picker is the right UX on iOS/Android (saves us
  building a touch-friendly popover), and it's keyboard-navigable
  on desktop for free.
- **Big center play button** covers the entire video surface on
  tap-to-toggle. Per the design-system 44×44px touch-target minimum,
  but the visual is a single 88×88px circle (or 72×72 on tiny
  phones) — the visual focal point is the play icon, not the
  hit area; the hit area is the full surface.
- **Buffered region via inline CSS variable** — the seek bar uses
  `style={{ '--seek-progress': '...', '--seek-buffered': '...' }}`
  + a gradient track that consumes the variables. RSC-friendly (no
  inline `style={{ color }}`), one source of truth per render.
- **CAPTCHA-style `<kbd>` styling** for the help section — uses
  `--font-mono` + `--bg-elev-2` + `--r-xs`. Matches the design
  system's keyboard-shortcut pattern (used in checkout's
  Stepper + the search overlay).

#### Out of scope (deferred for P15.2 + beyond)

- Resume from last position — the watch page owns `lesson_progress`,
  not the player. P15.2 wires `onLoadedMetadata` + the parent's
  `lesson_progress` to auto-seek the video element.
- Save progress on debounced `timeupdate` — same; P15.2 adds the
  debounced server-action write.
- Q&A panel — P15.7.
- Resources panel — P15.8.
- Prev / next lesson nav — P15.2.
- Auto-issue certificates on completion — P15.11.
- Notes panel — P15.6.
- Bookmarks — P15.5.
- Drip content gating — P15.16.