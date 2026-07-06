# LMS Watch — `/learn/[productSlug]/lessons/[lessonId]`

> The course player surface. Authenticated buyers + subscribers stream lessons, save progress, bookmark, and earn certificates.

## What this page does

The single watch UI for every lesson in every product the user has access to. The URL shape is `/learn/{productSlug}/lessons/{lessonId}`. The page renders:

1. A video player (HLS or MP4) sourced via the existing `mintStreamUrlAction`. Falls back to the demo HLS stream when no file is attached.
2. The lesson's title + summary.
3. "Mark complete" + "Bookmark" actions (separate client islands; debounced progress writes every 5s on `timeupdate`).
4. A `<LessonList>` sidebar with sections + lessons, progress indicators (✓ / ▶ / ○), preview pills (`is_preview=true`), and resume CTAs.
5. A `<CourseTabs>` surface below the player: Overview / Bookmarks / Resources / Certificate.
6. Prev/Next nav (server-rendered anchors — no JS).

The route co-locates with the existing `/library/[slug]` (P7.2) owner-view surface. The two are different intents: `/library/[slug]` = download hub, `/learn/{slug}/lessons/{id}` = playback. Linking `<LibraryRow>` to `/learn/{slug}/lessons/{firstLesson}` is a future enhancement (deferred).

## Data this page shows

| Surface | Source | Notes |
|---|---|---|
| Video src | `mintStreamUrlAction` over `product_lessons.file_id` | Fallback to Mux demo HLS |
| Curriculum | `product_modules` + `product_lessons` (curriculum tabs) | Public-read RLS |
| Progress | `progress` per (user_id, lesson_id) | Self-RLS |
| Bookmark | `bookmarks` per (user_id, lesson_id) | Self-RLS |
| Course completion % | `get_course_completion_percent(p_user_id, p_product_id)` RPC | SECURITY DEFINER |
| Certificate | `certificates` per (user_id, product_id) | Self-RLS, public-read by code |
| Resume position | `progress.position_seconds` for the watched lesson | Auto-seeks on mount via `initialSeekSeconds` |

## User actions

| Action | Surface | Auth/RBAC |
|---|---|---|
| Watch lesson | Player + lesson list | Auth required + product access (via `user_accessible_products`) |
| Mark complete | `<MarkCompleteButton>` client island | self (RLS on `progress`) |
| Bookmark | `<BookmarkButton>` client island | self (RLS on `bookmarks`) |
| Navigate prev/next | Server-rendered links | Auth + access |
| Resume at M:SS | `?t=` URL param (parseable by `parseResumeSeconds`) | public |

## What this page does NOT do (v1)

- No "I just clicked play" mini-overlay notification.
- No keyboard shortcut help UI (the `<VideoPlayer>` already has shortcut support; LMS does not re-skin).
- No per-lesson notes UI (P15.6 = v2).
- No Q&A / comments per lesson (P15.7 = v2).
- No Drip content / schedule release (P15.16 = v2).
- No course review form on the LMS surface (P15.15 routes through `/products/[slug]` review form).

## Acceptance criteria (v1)

- [ ] URL `/learn/{slug}/lessons/{id}` is auth-gated via `requireUser`; non-authed users redirect to `/login?next=...`.
- [ ] The user gets a 404 (not 403) when they don't own / subscribe to the course.
- [ ] `<LessonList>` renders every module + lesson from `product_modules` + `product_lessons`, sorted by `display_order`.
- [ ] The active lesson is visually marked (`data-state="current"` + `aria-current="page"`).
- [ ] A completed lesson shows ✓; a partially-watched lesson shows the resume time pill.
- [ ] Preview lessons (`is_preview=true`) carry a "Preview" pill.
- [ ] The player's `initialSeekSeconds` is `progress.position_seconds` for the current lesson (or `?t=` if no progress yet).
- [ ] Debounced progress write fires every 5 s on `timeupdate` (via `updateLessonProgressAction`).
- [ ] `<MarkCompleteButton>` toggles `progress.completed` optimistically + rolls back on failure.
- [ ] `<BookmarkButton>` adds/removes the bookmark via `toggleBookmarkAction`.
- [ ] `<CourseTabs>` renders the per-user bookmark note when present, the lesson's attached resources (via `product_lessons.file_id` → `product_files`), and the per-course certificate (link to `/verify-certificate/{code}`) when issued.
- [ ] `?t=` URL param parses via `parseResumeSeconds` and overrides `initialSeekSeconds`.
- [ ] Token-only CSS (no inline colors).
- [ ] No PII in logs.
- [ ] Mobile responsive (the player keeps 16:9; the sidebar collapses below 1024 px).
- [ ] All 6 checks green + `pnpm build` clean.
- [ ] No new `TODO` / `FIXME` in diff.

## Design reference

The mockups at `/mockups/library.html` (the "Watch" surface, not yet built). The page is an opinionated take inspired by Linear/Udemy's lesson shell — sidebar nav on the right, player on top, tabs below.

## Security

- **Auth required.** Public route is the marketing site only.
- **RLS:** every LMS table is self-only on writes (`progress`, `bookmarks`); admin-all on reads.
- **No PII in logs.**
- **Signed URLs:** every video stream goes through `mintStreamUrlAction` (24h download, 4h stream TTL, 60/h rate limit per `00-foundations/files/signed-url.ts`).
- **No raw IP / email in URL params.** The `?t=` param is a whole-second integer.

## Performance

- The watch page is `force-dynamic` — auth + access is per-request, no static optimization.
- 5 sequential round-trips at most (per `getCourseWithLessons`): product → modules → lessons → progress → access. Could be reduced to 1 round-trip via a SECURITY DEFINER RPC; deferred as a v1+1 optimization.
- The player bundle (`hls.js` + `VideoPlayer`) is route-scoped via the `app/learn/*` segment — not loaded on `/library`.

## Out of scope for v1

- **P15.6** — per-lesson notes.
- **P15.7** — Q&A per lesson.
- **P15.16** — drip content scheduling.

## Open questions for human

1. **Should `<LibraryRow>` link to the new `/learn/{slug}/lessons/{firstLesson}` route instead of `/library/[slug]`?** That would replace the download hub entry point with the watch entry point. I lean "no" — `/library/{slug}` is the right home for download + share; `/learn/...` is for users coming from the Continue watching rail or a deep link.

## Phase coverage

- **P15.1** — schema (`progress` + `bookmarks` + `certificates`) shipped in `0042_*` style migrations (this page's data layer).
- **P15.2** — this page IS the course player shell.
- **P15.3** — `<VideoPlayer>` was shipped in P7.6; LMS wraps it without modifying it.
- **P15.4** — `updateLessonProgressAction` with debounced 5s timer; auto-completion at `position >= duration - 5`.
- **P15.5** — `toggleBookmarkAction` + `<BookmarkButton>`.
- **P15.8** — Resources tab surfaces lesson-attached product_files.
- **P15.9** — `getLibraryProgress` populates `<CourseProgressBar>` on `/library` rows.
- **P15.10** — `getContinueWatching` powers the "Continue watching" rail.
