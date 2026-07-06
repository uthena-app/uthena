# LMS — Learning management system (Phase 15)

Module for course playback, lesson tracking, bookmarks, and certificates.

## Layout

```
02-features/lms/
├── README.md
├── index.ts                  — server barrel (queries + actions + types)
├── client.ts                 — client barrel (VideoPlayer + buttons)
├── lib/
│   ├── formatLessonDuration.ts   — pure: ms/seconds → "M:SS"
│   └── completionDetector.ts     — pure: position >= duration - 5 → mark complete
├── queries/
│   ├── getCourseWithLessons.ts   — RLS-scoped read; auth + access gates
│   ├── getLessonProgress.ts      — per (user, lesson) progress + bookmark
│   ├── getLibraryProgress.ts     — bulk completion % per owned product
│   ├── getContinueWatching.ts    — most-recently-watched lessons
│   └── getCertificate.ts         — per (user, product) certificate
├── actions/
│   ├── updateLessonProgress.ts   — debounced: position + completed
│   ├── toggleBookmark.ts         — add/remove + optional note
│   ├── markLessonComplete.ts     — explicit "mark complete" CTA
│   └── ensureCertificate.ts      — issuance (called by completion cron)
├── components/
│   ├── CoursePlayer.tsx          — CLIENT island; lesson shell + nav
│   ├── LessonList.tsx            — SERVER; sidebar with section + lesson items
│   ├── LessonNav.tsx             — SERVER; prev/next buttons
│   ├── MarkCompleteButton.tsx    — CLIENT; "Mark complete" CTA
│   ├── BookmarkButton.tsx        — CLIENT; add/remove bookmark
│   ├── Tabs.tsx                  — SERVER; tabbed content (Overview / Notes / Resources / Certificate)
│   └── CourseProgressBar.tsx     — SERVER; per-course completion bar
└── lib/
    └── ...
```

## Data flow

```
/learn/[productSlug]/lessons/[lessonId]
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│ RSC: getCourseWithLessons(productSlug, lessonId)         │
│  → 5 parallel reads:                                     │
│     (1) user_accessible_products RPC                     │
│     (2) slim products select                             │
│     (3) product_modules + product_lessons (curriculum)   │
│     (4) lesson_progress for current lesson               │
│     (5) bookmark                                          │
│  → 404 if access denied / lesson not in product          │
└──────────────────────┬───────────────────────────────────┘
                       ▼
                CoursePlayer (client)
                       │
                       ▼
        updateLessonProgressAction (debounced 5s on timeupdate)
        markLessonCompleteAction (on `ended` or explicit click)
        toggleBookmarkAction (on click)
```

## Cross-feature dependencies

- **Library** (`02-features/library`): the `VideoPlayer` client island + `mintStreamUrlAction`. The LMS module imports them via deep import paths to avoid the barrel-pulls-server-only-into-client-land bug from P0.5.
- **Auth** (`00-foundations/auth`): `requireUser` + `user_accessible_products` RPC.
- **Money** (`00-foundations/money`): none (no financial transactions).
- **Files** (`00-foundations/files`): signed URL minting via library's `mintStreamUrlAction`.

## Phase coverage

| Phase | Component |
|---|---|
| P15.1 | Schema (`progress` + `bookmarks` + `certificates`) + RPCs + getCourseWithLessons |
| P15.2 | CoursePlayer + LessonList + Tabs (/learn/[productSlug]/lessons/[lessonId]) |
| P15.3 | `<VideoPlayer>` (already shipped in P7.6, no LMS work — the LMS wraps it) |
| P15.4 | updateLessonProgressAction (debounced) + resume from progress |
| P15.5 | toggleBookmarkAction + BookmarkButton |
| P15.8 | Tabs → "Resources" surface (lesson_resources reuse product_files) |
| P15.9 | CourseProgressBar in library + getLibraryProgress |
| P15.10 | Continue watching rail + getContinueWatching |

## Out of scope (deferred)

- **P15.11/15.12/15.13/15.14 — certificates** — v2. The schema + RPCs land in P15.1; UI/auto-issuance is a follow-up tick.
- **P15.6 — per-lesson notes** — v2.
- **P15.7 — Q&A** — v2.
- **P15.16 — drip content** — v2.
- **P15.15 — course reviews** — Phase 14 admin moderation; depends on the partner Reviews tab (P12.6 Slices 2+).
- **P15.17 — free preview** — depends on `product_lessons.is_preview` (already exists); the preview modal ships as a follow-up.

## Anti-patterns watched for

- **No inline styles** — token-only `*.module.css` per AGENTS.md.
- **No PII in logs** — progress writes are not audited (high volume; spec-out per `01-specs/pages/library-watch.md:111`).
- **No `useEffect` for video setup** — `VideoPlayer` (P7.6) owns the `<video>` element + HLS attach. The LMS wrapper passes props in; it never touches the video DOM.
- **Server actions are the only writer** — there is no direct PostgREST client write path for `progress`/`bookmarks` (matches the existing `cart_items`/`payout_ledger` pattern).
