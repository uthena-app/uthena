# Partner Upload Wizard — `02-features/partner-upload/`

P12.7 — the 5-step partner course creation wizard at `/partner/upload`.

## What this feature does

A partner visiting `/partner/upload` walks through:

1. **Details** — title, long description, category, kind (Slice 1, shipped)
2. **Curriculum** — modules + lessons (Slice 2, shipped)
3. **Files** — Bunny tus uploads + ClamAV scan gate (Slice 3, P12.8)
4. **Pricing** — 3-tier license matrix (Slice 4)
5. **Review** — live preview + submit for review (Slice 5)

Each step auto-saves (debounced 1s) to a `partner_upload_drafts` row keyed
on `user_id`. The partner can close the tab and come back; their draft is
restored. Slices 2-5 extend the `payload.details` JSONB with their own
top-level keys (`payload.curriculum`, `payload.files`, `payload.pricing`,
`payload.review`) — the shallow-merge in `saveUploadDraftAction` keeps them
isolated.

## File map

| File | Purpose |
|---|---|
| `queries/getMyUploadDraft.ts` | RSC read of the partner's draft (with defensive coercion + UPLOAD_STEPS constants) |
| `queries/getMyUploadDraft.test.ts` | Unit tests for the read query |
| `actions/saveUploadDraft.ts` | `'use server'` autosave action (auth + rate-limit + Zod + shallow-merge + audit) |
| `actions/saveUploadDraft.rate-limit.ts` | 60/min/user in-process sliding window |
| `actions/saveUploadDraft.test.ts` | Unit tests for the save action (auth, rate-limit, Zod, merge, PII safety; Step 1 + Step 2) |
| `lib/saveUploadDraftSchema.ts` | Zod wire schema + per-step `payloadForStep()` dispatcher (Step 1 Details + Step 2 Curriculum strict; Steps 3-5 open) |
| `lib/saveUploadDraftSchema.test.ts` | Unit tests for Details/Lesson/Module/Curriculum Zod schemas + dispatcher (Slice 2 surface) |
| `lib/curriculumOps.ts` | PURE add/remove/reorder/moveBounds helpers for modules + lessons (Slice 2 state primitives) |
| `lib/curriculumOps.test.ts` | Unit tests for the ops lib (44 tests covering every mutating op at every boundary) |
| `lib/parseStep.ts` | URL `?step=N` parser with full defensive matrix |
| `lib/parseStep.test.ts` | Unit tests for the URL parser |
| `components/UploadShell.tsx` | Wizard shell (Stepper + body + toolbar; currentStep 1 → DetailsStep, 2 → CurriculumStep, 3-5 → StepPlaceholder) |
| `components/UploadShell.module.css` | Token-only shell styles |
| `components/DetailsStep.tsx` | Step 1 client form (title/description/category/kind) with debounced autosave |
| `components/DetailsStep.module.css` | Step 1 form styles |
| `components/CurriculumStep.tsx` | Step 2 client form (module/lesson tree) with debounced autosave |
| `components/CurriculumStep.module.css` | Step 2 form styles (token-only) |
| `components/StepPlaceholder.tsx` | Generic step body for steps 3-5 (real UI, deferred work filed in STUBS.md) |
| `components/StepPlaceholder.module.css` | Placeholder styles |
| `index.ts` | Public barrel — page routes + tests + future sibling features import from here |

## Schema

The wizard's persistence is `partner_upload_drafts` (migration 0040),
separate from `partner_uploads` (the per-file Bunny tus + scan record
table). Conflating them would force every read to filter by a discriminator
and break the file-upload pipeline's existing RLS policies. See
`04-platform/migrations/0040_partner_upload_drafts.sql` for the rationale.

The Slice 2 (Curriculum) JSONB shape on `payload.curriculum`:

```ts
{
  modules: [
    {
      id: string,           // client-generated UUID via crypto.randomUUID()
      title: string,        // 1..200 chars (trim-normalized)
      summary?: string,     // 0..1000 chars
      display_order: int,   // 0..1000; re-derived 0..N-1 by `appendModule`/etc.
      lessons: [
        {
          id: string,
          title: string,
          summary?: string,
          duration_seconds: int, // 0..86400 (24h)
          is_preview: boolean,
          display_order: int,
        },
      ],
    },
  ],
}
```

The shape mirrors the eventual normalized `product_modules + product_lessons`
tables (migration 0039). The Slice 5 submit-for-review boundary drains the
JSONB into those tables; Slice 2 stays strictly on JSONB.

## URL contract

| URL | Renders |
|---|---|
| `/partner/upload` | Step 1 (Details) — or the draft's `currentStep` |
| `/partner/upload?step=N` (N in 1..5) | Step N |
| `/partner/upload?step=N` (N invalid) | The draft's `currentStep` |
| `/submit-new-course` | Auth-gated redirect to `/partner/upload` |
| `/update-course` | Auth-gated redirect to `/partner/courses` |
| `/pages/submit-new-course` | Permanent redirect to `/submit-new-course` |
| `/pages/update-course` | Permanent redirect to `/update-course` |

## URL alias rationale (spec line 9)

The Shopify-era sitemap exposes `/pages/submit-new-course` and
`/pages/update-course`. The clean top-level replacements are
`/submit-new-course` (a new wizard) and `/update-course` (the existing
partner course edit flow at `/partner/courses`). The alias chain keeps
both legacy URLs working forever, so existing partner muscle memory + any
external backlinks don't 404.

## Slice roadmap

| Slice | Status | Ships |
|---|---|---|
| 1 | ✅ 2026-06-30 | Schema + URL aliases + Stepper + Step 1 (Details) + autosave |
| 2 | ✅ 2026-06-30 | Step 2 (Curriculum) — module/lesson editor reusing P12.6 product_modules + product_lessons JSONB shape |
| 3 | queued (P12.8) | Step 3 (Files) — Bunny tus + ClamAV + scan status indicator |
| 4 | queued (STUB-094) | Step 4 (Pricing) — 3-tier license matrix reusing P12.6 product_pricing |
| 5 | queued (STUB-094) | Step 5 (Review) — live preview + submit-for-review + admin notification |

Each Slice is ≤ 0.75 cron ticks under current complexity. Slice 2
deliverables + design rationale + acceptance-criteria coverage + deferred
work all documented in
`01-specs/pages/instructor-upload.md` §"P12.7 Slice 2".
