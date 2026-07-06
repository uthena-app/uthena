// saveUploadDraftSchema — pure Zod schemas + types for the partner
// upload wizard's `saveUploadDraftAction` server action (P12.7).
//
// Split from `actions/saveUploadDraft.ts` because Next.js `'use server'`
// files can ONLY export async functions. The pure schema + types +
// the per-step payload dispatcher live here so the call site is stable
// as Slices 3-5 (Files / Pricing / Review) plug in their own Zod
// refinements.
//
// The contract:
//   - `SaveUploadDraftInput` validates the wire input — step ∈ [1, 5]
//     + optional `payload` object. Used by the action + tests.
//   - `payloadForStep(step)` returns the per-step Zod schema for the
//     payload body. Step 1 (Details) + Step 2 (Curriculum) ship real
//     schemas; Steps 3-5 ship permissive open shapes that Slices
//     3-5 tighten in place.
//
// Step model (per spec `01-specs/pages/instructor-upload.md` line 16):
//   1. Details    — title, long_description, category_id, kind
//   2. Curriculum — modules + lessons (Slice 2, P12.7)
//   3. Files      — Bunny tus uploads + scan state (Slice 3, P12.8)
//   4. Pricing    — 3-tier license matrix (Slice 4)
//   5. Review     — preview + submit-for-review (Slice 5)
//
// Each step writes its own top-level key in the row's `payload` jsonb
// (`details` / `curriculum` / `files` / `pricing` / `review`) so the
// shallow-merge in `saveUploadDraftAction` never clobbers another
// step's keys. Slice 2 ships `curriculum` as a strict module/lesson
// tree matching the eventual `product_modules + product_lessons`
// tables (migration 0039). The drain into those tables is deferred
// to the Slice 5 submit-for-review flow (the wizard owns the
// JSONB shape as the draft surface; the normalized tables are the
// post-submit canonical form).

import { z } from 'zod'

/** The wizard's first step (Details). 1-based, matches the stepper. */
export const UPLOAD_FIRST_STEP = 1
/** The wizard's last step (Review). */
export const UPLOAD_LAST_STEP = 5
export const UPLOAD_TOTAL_STEPS = 5

// ---------------------------------------------------------------------------
// Per-step payload schemas
// ---------------------------------------------------------------------------

/** Step 1 — Details. The four fields spec line 17 calls out:
 *  `title` (required, 1..200), `long_description` (required, ≥ 50 chars
 *  plain-text — the spec validates on plain-text length, not TipTap JSONB
 *  size, so we validate the plain string the partner types), `category_id`
 *  (positive int, required — the spec's "category required" criterion),
 *  `kind` (one of the six `product_kind` enum values). */
export const DetailsPayload = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(200, 'Title must be 200 characters or fewer'),
    long_description: z
      .string()
      .min(50, 'Description must be at least 50 characters')
      .max(10_000, 'Description must be 10,000 characters or fewer'),
    category_id: z
      .number()
      .int('Category must be a whole number')
      .positive('Category is required'),
    kind: z.enum([
      'video_course',
      'ebook',
      'template_pack',
      'audio_course',
      'bundle',
      'asset_pack',
    ]),
  })
  // `.strict()` rejects unknown top-level keys (defense in depth —
  // a misbehaving client shipping `{ title, ..., evil_field: 'x' }`
  // gets `invalid_input` instead of a silently-stripped payload).
  .strict()
export type DetailsPayloadT = z.infer<typeof DetailsPayload>

// ---------------------------------------------------------------------------
// Step 2 — Curriculum (P12.7 Slice 2)
// ---------------------------------------------------------------------------

/** Max length for an `id` field on a module or lesson. We use
 *  client-generated UUIDs (`crypto.randomUUID()` returns a 36-char
 *  hex string), but defensively cap to 64 chars so a misbehaving
 *  client can't blow up the JSONB column with a megabyte-id. */
export const CURRICULUM_ID_MAX = 64

/** The 200-char title cap (matches the DB CHECK constraints on
 *  `product_modules.title` and `product_lessons.title` from
 *  migration 0039). Single source of truth for both column writes. */
export const CURRICULUM_TITLE_MAX = 200

/** The 1000-char summary cap (matches the DB CHECK constraints on
 *  both tables' `summary` columns). */
export const CURRICULUM_SUMMARY_MAX = 1000

/** The 86 400-second cap on a lesson duration = 24 hours. Beyond
 *  that the lesson is malformed; the DB allows up to int max, but
 *  no legitimate course lesson is longer than a day. */
export const CURRICULUM_DURATION_MAX_SECONDS = 86_400

/** Maximum modules per curriculum. 100 modules is comfortably
 *  above the seed catalog's largest course (~20 modules) and well
 *  under the JSONB column's practical limit. */
export const CURRICULUM_MAX_MODULES = 100

/** Maximum lessons per module. 200 lessons per module is far
 *  above any realistic module (a 200-lesson module would be a
 *  book); it's a defensive cap to prevent runaway-pagination
 *  saves. */
export const CURRICULUM_MAX_LESSONS_PER_MODULE = 200

/** Step 2 — Curriculum. JSONB shape that mirrors the eventual
 *  `product_modules + product_lessons` rows so the Slice 5
 *  submit-for-review flow can drain the JSONB into the
 *  normalized tables without a shape translation step.
 *
 *  Each module + lesson carries a client-generated `id` (a
 *  UUID minted by `crypto.randomUUID()` at row-add time). The
 *  id is stable across reorders + edits, which lets the UI
 *  reuse React keys + lets the Slice 5 drain correlate the
 *  draft rows with the eventual normalized rows.
 *
 *  Why allow zero modules + zero lessons: the autosave pattern
 *  is "save on every keystroke"; an in-progress module with no
 *  lessons yet (and a curriculum with no modules yet) is a
 *  legitimate draft state. The spec's "at least 1 module /
 *  at least 1 lesson per module" rule (line 72) is enforced at
 *  the *navigate-to-Step-3* / *submit-for-review* boundary, NOT
 *  on every keystroke (per the spec's "Drafts auto-save …
 *  on every field change" criterion line 79 — partial state
 *  must round-trip cleanly). Slice 2 keeps the schema lenient
 *  here; Slice 5 adds the gating validation. */
export const LessonPayload = z.object({
  id: z
    .string()
    .min(1, 'Lesson id is required')
    .max(CURRICULUM_ID_MAX, 'Lesson id is too long'),
  title: z
    .string()
    .trim()
    .min(1, 'Lesson title is required')
    .max(CURRICULUM_TITLE_MAX, 'Lesson title is too long'),
  summary: z
    .string()
    .max(CURRICULUM_SUMMARY_MAX, 'Lesson summary is too long')
    .optional()
    .default(''),
  duration_seconds: z
    .number()
    .int('Lesson duration must be a whole number of seconds')
    .min(0, 'Lesson duration must be ≥ 0')
    .max(CURRICULUM_DURATION_MAX_SECONDS, 'Lesson duration is too long'),
  is_preview: z.boolean(),
  display_order: z
    .number()
    .int('Lesson order must be a whole number')
    .min(0, 'Lesson order must be ≥ 0')
    .max(1_000, 'Lesson order is too large'),
})
export type LessonPayloadT = z.infer<typeof LessonPayload>

export const ModulePayload = z.object({
  id: z
    .string()
    .min(1, 'Module id is required')
    .max(CURRICULUM_ID_MAX, 'Module id is too long'),
  title: z
    .string()
    .trim()
    .min(1, 'Module title is required')
    .max(CURRICULUM_TITLE_MAX, 'Module title is too long'),
  summary: z
    .string()
    .max(CURRICULUM_SUMMARY_MAX, 'Module summary is too long')
    .optional()
    .default(''),
  display_order: z
    .number()
    .int('Module order must be a whole number')
    .min(0, 'Module order must be ≥ 0')
    .max(1_000, 'Module order is too large'),
  lessons: z.array(LessonPayload).max(CURRICULUM_MAX_LESSONS_PER_MODULE),
})
export type ModulePayloadT = z.infer<typeof ModulePayload>

export const CurriculumPayload = z
  .object({
    modules: z.array(ModulePayload).max(CURRICULUM_MAX_MODULES),
  })
  // `.strict()` rejects unknown top-level keys (defense in depth — a
  // misbehaving client that ships `{ modules: [...], extra: 'noise' }`
  // gets `invalid_input` back instead of a silently-stripped shape
  // that quietly inflates the JSONB payload). Matches the Step 1
  // `DetailsPayload` shape contract in this file.
  .strict()
export type CurriculumPayloadT = z.infer<typeof CurriculumPayload>

// ---------------------------------------------------------------------------
// Wire-input schema
// ---------------------------------------------------------------------------

/** Wire-input schema for `saveUploadDraft`. The step number is in the
 *  canonical 1..5 range; the payload is an object (its shape is
 *  step-specific, validated by `payloadForStep`). `payload` is optional
 *  so a Step 1 save with no fields yet passes (the wizard lets the
 *  partner navigate to Step 1 from step 0 without a save — the URL
 *  is the source of truth, not the DB). */
export const SaveUploadDraftInput = z.object({
  step: z
    .number()
    .int()
    .min(UPLOAD_FIRST_STEP)
    .max(UPLOAD_LAST_STEP),
  payload: z.record(z.unknown()).optional(),
})
export type SaveUploadDraftInputT = z.infer<typeof SaveUploadDraftInput>

/** Action result. Typed union so callers can branch on `ok: false`
 *  without parsing stringly-typed errors. Mirrors the partner-
 *  onboarding `SaveStepResult` shape (P12.2) for consistency. */
export type SaveUploadDraftResult =
  | { ok: true; savedAt: string; currentStep: number; lastSavedStep: number }
  | {
      ok: false
      error: string
      code: 'unauthenticated' | 'rate_limited' | 'invalid_input' | 'save_failed'
      retryAfterSeconds?: number
    }

// ---------------------------------------------------------------------------
// Per-step payload dispatcher
// ---------------------------------------------------------------------------

/** Wire-shape for Step 1 — the client sends `{ details: {...} }` so
 *  the action's shallow-merge puts `details` as the row's payload key.
 *  Inner strictness comes from `DetailsPayload`. */
const Step1Payload = z.object({
  details: DetailsPayload,
})

/** Wire-shape for Step 2 — the client sends `{ curriculum: { modules:
 *  [...] } }` where `modules` is the strict Module / Lesson tree.
 *  The action's shallow-merge stores it under the row's `curriculum`
 *  JSONB key, so saving Step 2's tree never clobbers Step 1's
 *  `details` key (or any future step's key). */
const Step2Payload = z.object({
  curriculum: CurriculumPayload,
})

/** Pure helper: pick the Zod schema for the per-step payload. Step 1
 *  ships the strict Details schema wrapped in `{ details: ... }` (the
 *  wire shape); Step 2 ships the strict Curriculum schema wrapped in
 *  `{ curriculum: ... }`; Steps 3-5 are open until their slices
 *  tighten them. The function signature stays the same across slices
 *  so `saveUploadDraftAction` never needs to change.
 *
 *  Returning a permissive open schema for unset steps means a save that
 *  somehow hits the wire (e.g. an attacker probing step 3 before Slice
 *  3 ships) is still shape-validated at the boundary but can't write
 *  a Step 1 fields-with-constraints payload under a wrong step key. */
export function payloadForStep(step: number): z.ZodTypeAny {
  switch (step) {
    case 1:
      return Step1Payload
    case 2:
      return Step2Payload
    case 3:
    case 4:
    case 5:
      // Open shape — each Slice ships its own Zod refinement and
      // replaces this branch. We refuse `null` to keep the merge
      // well-typed.
      return z.record(z.unknown()).optional()
    default:
      // The wire-level `step` range is enforced by SaveUploadDraftInput;
      // this is defense-in-depth for an impossible input.
      return z.never()
  }
}
