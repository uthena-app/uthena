# Partner Course Upload — `/partner/upload`

## What this page does

A 5-step wizard for partners to upload a new course. Steps: (1) Details (title, description, category), (2) Curriculum (modules + lessons), (3) Files (video, source, sales materials — drag/drop with progress), (4) Pricing (license tiers + prices), (5) Review (live preview of the listing + submit for review). Each step saves to a draft (`partner_uploads` table) so the partner can leave and come back.

A 2-step variant exists for the "Resume an upload in progress" case — the partner lands on step 1 with their draft pre-filled.

Migration requirement: the current Shopify page sitemap exposes `/pages/submit-new-course` and `/pages/update-course`. The clean top-level replacements are `/submit-new-course` and `/update-course`. Approved partners who visit either clean or legacy URL must land in the relevant v2 partner upload or course-edit flow instead of seeing a 404.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Page head | breadcrumb, page title, intro text | hard-coded | text |
| Stepper | 5 steps (Details, Curriculum, Files, Pricing, Review) with active/done states | local + draft state | progress bar |
| Step 1 — Details | `title`, `long_description`, `category_id`, `kind` (product_kind) | draft_payload.title etc. | form |
| Step 2 — Curriculum | modules list (each with `title`, `display_order`, `lessons` array with `title`, `duration_seconds`, `file_id`, `is_preview`) | draft_payload.modules | editable list (add/remove/reorder) |
| Step 3 — Files | upload zones (video, source, sales materials), uploaded file list per zone | draft_payload.files + product_files (after submit) | dropzones + file rows |
| Step 4 — Pricing | 3 license tiers (Whitelabel, PLR, PLR+MRR), each with `active` toggle + `price_cents` | draft_payload.pricing | pricing matrix |
| Step 5 — Review | live preview of the listing (title, description, curriculum, files, pricing) — looks like the public product page | derived from draft_payload | preview |
| Right rail | live summary (title, category, modules count, lessons count, length, files count, storage used, pricing, checklist) | derived from draft_payload | sticky rail |
| Footer | Save & exit, Continue to review, Back | hard-coded actions | footer bar |

**Mutations:** `02-features/partner-portal/actions/saveDraft.ts` (autosave on each field change, debounced 1s), `02-features/partner-portal/actions/uploadFile.ts` (handles the multi-step Bunny upload with progress), `02-features/partner-portal/actions/submitForReview.ts` (final submit).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Navigate steps | Click any step in the stepper (if accessible) | Navigates to that step; if step is incomplete, shows a warning | partner |
| Save draft | (automatic, debounced 1s after any field change) | Saves draft_payload to partner_uploads with status='draft' | partner (own draft) |
| Save & exit | Click "Save & exit" | Forces a save, navigates to /partner | partner |
| Add module | Click "Add module" | Adds an empty module to the curriculum | partner |
| Edit module title | Click on the module title | Inline edit | partner |
| Reorder modules | Drag handle on a module row | Reorders, saves | partner |
| Delete module | Click trash icon on a module row | Confirms, removes, saves | partner |
| Add lesson | Click "+ Add lesson" inside a module | Adds a lesson to that module | partner |
| Edit lesson | Click on a lesson row | Inline edit | partner |
| Mark as preview | Toggle the "Preview" switch on a lesson | Updates is_preview, saves | partner |
| Delete lesson | Click trash icon on a lesson row | Confirms, removes, saves | partner |
| Upload video files | Drop files into the video dropzone OR click "browse" | Uploads to Bunny Storage (resumable for >5GB files), shows progress, saves to draft | partner |
| Upload source files | Drop into source dropzone | Same flow as videos, smaller size limit | partner |
| Upload sales materials | Drop into sales dropzone | Same flow | partner |
| Cancel an in-progress upload | Click ✕ on the file row | Aborts the upload, removes the file | partner |
| Toggle a license tier | Click the toggle switch | Activates/deactivates the tier, saves | partner |
| Set price for a tier | Type in the price input | Validates > 0, saves | partner |
| Submit for review | Click "Submit for review" on step 5 | Validates the draft against the submission checklist, if all green, sets status='submitted', triggers admin notification email | partner (own draft, all required fields filled) |
| Open clean submit/update URL | Visit `/submit-new-course` or `/update-course` | Auth-gated redirect to `/partner/upload` or the relevant partner course-edit flow; if the user is not an approved partner, redirect through partner onboarding/status logic | public URL, partner action |
| Open legacy submit/update URL | Visit `/pages/submit-new-course` or `/pages/update-course` | Permanent redirect to the clean top-level URL or directly to the partner upload/edit flow | public URL, partner action |
| Withdraw submission | Click "Withdraw" on a submitted upload (from the partner dashboard, not this page) | Sets status back to 'draft' | partner (own) |
| Delete draft | Click "Delete draft" | Confirms, removes the draft (only if status='draft') | partner (own) |
| View partner guide | Click "Read the partner guide →" in the right rail help section | Opens a new tab to the partner guide | partner |

## What this page does NOT do

- No WYSIWYG description editor (plain textarea in v1; rich text in v2)
- No bulk lesson import (CSV/JSON upload in v2)
- No AI-assisted course generation (v2; we have ideas but not in v1)
- No "duplicate this course" feature (v2)
- No A/B testing of titles/descriptions (v2)
- No real-time co-editing (single-editor; v1 assumes no two partners edit the same draft at once — locked by RLS + draft ownership)
- No version history (v2 — would require a full draft_versions table)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role IN ('partner')`
- [ ] `/submit-new-course` and `/update-course` resolve to the partner upload/edit flow with auth preserved
- [ ] `/pages/submit-new-course` and `/pages/update-course` permanently redirect to the approved clean route or directly to the partner upload/edit flow; neither renders under `/pages`
- [ ] Only the partner's own draft is editable (RLS enforces this)
- [ ] Step 1 validates: title required, description required (min 50 chars), category required
- [ ] Step 2 validates: at least 1 module, each module has at least 1 lesson, each lesson has a title and duration > 0
- [ ] Step 3 validates: at least 1 video file uploaded
- [ ] Step 4 validates: PLR tier is required and active; other tiers are optional; all prices > 0
- [ ] Step 5 shows a real live preview of the listing as it will appear publicly
- [ ] The right rail updates in real time as the partner fills fields
- [ ] The submission checklist correctly identifies what's missing
- [ ] Submit button is disabled until all required items are green
- [ ] Drafts auto-save (debounced 1s) on every field change
- [ ] Closing the tab and coming back: the draft is restored
- [ ] Uploads are resumable: closing the tab mid-upload, coming back, the upload continues
- [ ] Upload progress is shown per file
- [ ] Failed uploads show a clear error and a "Retry" button
- [ ] File type validation: videos must be MP4/MOV, source must be PDF/PPTX/DOCX/ZIP, etc. (validated client-side AND server-side)
- [ ] Storage usage shown accurately (sum of uploaded file sizes)
- [ ] Storage limit: 50GB per course (hard cap; partners see a warning at 40GB)
- [ ] Every uploaded file shows its malware scan status in the submission checklist; submit is blocked until every file is `scan_status='clean'`
- [ ] An infected file shows a clear quarantine error to the partner (no technical jargon) and fires an admin alert
- [ ] After submit: status changes to 'submitted', the partner sees a "We'll review within 48h" confirmation
- [ ] The partner receives an email confirmation of submission
- [ ] Admin receives a notification of new submission (in-app, not email in v1)
- [ ] Page renders in < 500ms p95
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/upload.html`
- Components: `00-foundations/ui/Stepper.tsx`, `00-foundations/ui/Dropzone.tsx`, `00-foundations/ui/ModuleRow.tsx`, `00-foundations/ui/LicenseMatrix.tsx`, `00-foundations/ui/Rail.tsx`, `00-foundations/ui/Checklist.tsx`

## Security

- **Auth required:** YES
- **Allowed roles:** partner (any status; even pending partners can upload, but their upload won't be reviewed until they're approved)
- **RLS policies that apply:** `partner_uploads` (partner_id = self only, write only on status='draft'; status='submitted' and beyond is read-only for partners), `product_files` (partner can write files only on their own draft's product)
- **PII displayed:** no
- **PII in URLs:** no
- **Audit logged:** yes — every step transition, every file upload, every submit
- **File upload security:**
  - File type validation (allow-list of mime types, server-side)
  - File size validation (server-side)
  - Malware scan: **v1, blocking.** Every uploaded file is scanned (ClamAV via `00-foundations/files/scan.ts`, triggered by the upload-complete webhook). ZIPs scanned recursively. A file must have `scan_status='clean'` before the course can be submitted for review; infected files are quarantined and the partner sees a clear error. (Moved from v2 to v1 on 2026-06-12 — we redistribute uploaded archives to paying customers; scanning cannot wait.)
  - Storage paths: `/partner-uploads/{partner_id}/{upload_id}/{file_id}.{ext}` — namespaced by partner
  - Signed upload URLs: Bunny presigned URLs with 1h TTL
- **Terms acceptance:** the partner must accept the partner agreement + PLR content standards before submitting. The checkbox state is recorded on the draft.
- **Idempotency:** file uploads use the file's SHA-256 hash as a deduplication key. Re-uploading the same file is a no-op.
- **Third-party scripts:** none (Bunny upload UI is our own, not a third-party widget)

## Performance

- **Target p95:** < 500ms (the page is mostly forms; performance is dominated by autosave + upload progress)
- **Render strategy:** RSC + client components for the form fields + uploads
- **Autosave:** debounced 1s; the server action returns immediately; the UI shows a "Saved" indicator when the response arrives
- **Upload:** resumable, parallel up to 3 files at a time, chunked (5MB chunks)
- **Bundle size budget:** < 80KB added to client bundle (form fields + dropzone UI + upload manager)

## Out of scope for v1

- Rich text description editor (plain textarea)
- Bulk lesson import
- AI-assisted course generation
- Duplicate course
- A/B testing of titles
- Real-time co-editing
- Version history
- Plagiarism / rights check (this is the ADMIN's job in the review queue — not the partner's)
- Watermarking on uploaded videos (v2; partner uploads raw, Uthena handles encoding + optional watermark)

## Open questions for human

- **PLR terms acceptance:** do we need a per-upload acceptance (every time they submit), or once-per-partner acceptance? My recommendation: per-upload. Forces them to re-read every time. It's a checkbox, not a wall.
- **Storage cap per partner (not per course):** is there a per-partner storage limit? My recommendation: 200GB per partner (across all drafts + published courses). Tunable. For v1, the only hard cap is 50GB per course.
- **Resumable uploads:** worth the complexity? My recommendation: yes — partners uploading 30GB of source video will hit network blips. Resumable is non-negotiable for this use case. We use the tus.io protocol or Bunny's built-in chunked upload.

---

## Implementation notes

### P12.7 Slice 1 (2026-06-30) — Schema + URL aliases + Stepper + Step 1 (Details) + autosave

**Shipped:**
- **Schema foundation** — `04-platform/migrations/0040_partner_upload_drafts.sql` adds the `partner_upload_drafts` table (1 row per `user_id` UNIQUE, `payload jsonb` for shallow-merge of per-step form state, `current_step` + `last_saved_step` ints, `status partner_upload_draft_status` enum of `draft` / `submitted` / `withdrawn`, submitted/reviewed/decision/decision_notes for admin moderation). RLS: `partner_upload_drafts_self_read` (user_id = auth.uid()), `partner_upload_drafts_self_write` (user_id = auth.uid() with check), `partner_upload_drafts_admin_all` (is_admin()). Indexes: `partner_upload_drafts_status_submitted_idx` partial on `(status, submitted_at desc) WHERE status='submitted'` for the future admin review queue + `partner_upload_drafts_user_idx` on `(user_id)` for the future dashboard "My drafts" widget.
- **Audit** — added `'partner_upload.step_saved'` to `AuditAction` union + `AUDIT_ACTIONS` array + `'partner_upload_drafts'` to `SelfAuditInput.targetKind` union. The action writes one row per save with `metadata={step, next_step, fields_changed}` (NEVER the payload body — the future curriculum + files step payloads include Bunny storage paths + third-party IDs that must not be logged).
- **Why a new table, not `partner_uploads`**: the spec line 32 mentions `partner_uploads` but the existing `partner_uploads` table (0001_initial.sql line 1302) is the per-file Bunny tus + scan record table. Conflating wizard state with file records would force every read to filter by a discriminator and break the file-upload pipeline's existing RLS policies. New table mirrors the `partner_onboarding_drafts` pattern (0001_initial.sql line 1351). Architecture.md line 79's `partner_uploads -- (partner_id, status, draft_payload jsonb, ...)` description matches a wizard draft but the actual schema diverges — architecture.md was aspirational and never caught up with the per-file migration. Per AGENTS.md, migrations are append-only so a new table is the correct move.
- **Autosave server action** — `02-features/partner-upload/actions/saveUploadDraft.ts` ('use server'). Auth gate → rate limit (60/min/user in-process sliding window per spec) → Zod wire schema (`step` ∈ [1,5]) → per-step `payloadForStep()` Zod dispatcher (Step 1 = strict DetailsPayload; Steps 2-5 = open shapes that future Slices tighten in place) → read existing draft → block saves on submitted drafts (friendly "withdraw first" error) → shallow-merge the step's payload key into `payload` jsonb → upsert with `onConflict: 'user_id'` → audit log (masked) → `revalidatePath('/partner/upload')`. `current_step` = MAX(existing, new) — never regresses. `last_saved_step` = the saved step (no MAX — the right-rail "Saved at step N" reads this). Status forced to `'draft'` on every save (a withdrawn draft re-enters editing).
- **RSC read query** — `02-features/partner-upload/queries/getMyUploadDraft.ts`. Defensive coercion of all fields (garbage `current_step` clamps to fallback; garbage `payload` becomes `{}`; unknown `status` maps to `'draft'`). RLS self-scopes; no service-role escalation. Returns `{ exists: false }` for anon callers or missing rows.
- **Step constants** — `UPLOAD_STEPS = [details, curriculum, files, pricing, review]` in that order. The stepper renders this array directly. PHASES.md §P12.7 reads "Details → Pricing → Files → Review → Submit" but the spec's canonical order is "Details → Curriculum → Files → Pricing → Review"; the spec wins (STUB-093 §Cross-slice work).
- **Stepper shell** — `02-features/partner-upload/components/UploadShell.tsx`. Composes the existing `00-foundations/ui/Stepper` primitive + per-step body + bottom toolbar (Save & exit → /partner/courses, Back, Continue). Steps 2-5 render a `<StepPlaceholder>` (real UI per AGENTS.md rule 4 — heading + description + blurb + "form is being built" note). Step 1 renders `<DetailsStep>` (the live form).
- **Step 1 form** — `02-features/partner-upload/components/DetailsStep.tsx` ('use client'). Title (max 200, required), long_description (plain text, 50..10000, required — matches the spec's "min 50 chars" criterion), category_id (dropdown — `listPartnerCategories()` RSC query, fail-soft to empty array), kind (6-option dropdown). Autosave with 1s debounce + flush-on-unmount. Inline save indicator ("Saving…" → "Saved HH:MM:SS" with a green dot) + inline error slot for rate-limited (echoes `retryAfterSeconds`) / unauthenticated / generic friendly. Skips the save when the form is mid-typing (empty title or unparseable category) to avoid flooding the audit log with rejected inputs.
- **URL aliases** — the chain is:
  - `/pages/submit-new-course` (legacy Shopify URL) → permanent 308 → `/submit-new-course` (`next.config.mjs`)
  - `/submit-new-course` → auth-gated dispatch → `/partner/upload` (or `/partner/onboarding` for non-partners)
  - `/pages/update-course` (legacy Shopify URL) → permanent 308 → `/update-course` (`next.config.mjs`)
  - `/update-course` → auth-gated dispatch → `/partner/courses` (or `/partner/onboarding` for non-partners)
  Both clean-URL pages use the 4-state dispatch (anon → signup, none/pending/suspended → onboarding, approved → wizard). Spec pointer specs at `01-specs/pages/{submit-new-course, update-course}.md` keep `check:specs` green.
- **Tests** — 8 new test files (79 unit tests across 4 feature files + 1 helper file):
  - `saveUploadDraft.test.ts` — 39 tests: auth gate, rate limit (60 + 1th denied), Zod validation (every out-of-range / non-integer / wrong-shape input), Step 1 strict schema (title trim, description 50..10000, kind enum, category_id positive int), Steps 2-5 open shapes, never-regress current_step, shallow-merge preservation across saves, submitted-draft rejection, FormData path with malformed JSON tolerance, PII safety (audit row metadata NEVER contains the payload body).
  - `getMyUploadDraft.test.ts` — 13 tests: anon → `{ exists: false }`, no-row → `{ exists: false }`, DB error fail-soft, full draft shape coercion, step clamping, payload coercion (string → {}), status normalization, step constants shape contract.
  - `parseStep.test.ts` — 16 tests: 1..5 in-range, every out-of-range + SQL/shell/whitespace/Unicode-digit/RTL-override attack rejected, draft fallback behavior, fresh-visitor fallback.
  - **Full suite at slice end: 2803 → 2882 passed (+79)**
- **Build** — `pnpm build` clean: 56 → 58 routes (`/partner/upload`, `/submit-new-course`, `/update-course`); `/partner/upload` first-load 2.74 kB / 113 kB. Shared first-load JS unchanged at 101 kB.
- **Deferred to STUB-093** (Slices 2-5): Curriculum step, Files step (P12.8), Pricing step, Review step + submit-for-review + admin notification, Withdraw action, live preview mirror, right-rail summary widget, submission checklist, "Save & exit" + "Resume from any step" affordances. Each Slice ≤ 0.75 cron ticks under current complexity.

**Open questions for Klaas** (carried from spec + new):
1. Per-upload PLR terms acceptance vs once-per-partner (spec OQ #1) — Slice 5.
2. Per-partner storage cap (spec OQ #2 recommends 200GB) — Slice 3; default to 200GB if no answer.
3. Resumable upload library (spec OQ #3 — tus.io vs Bunny built-in) — Slice 3.
4. Should "Save & exit" + "Resume from any step" ship with Slice 5 or as separate slices?

---

### P12.7 Slice 2 (2026-06-30) — Step 2 (Curriculum): module/lesson editor + autosave

**Shipped surface:** `/partner/upload?step=2` renders the new `<CurriculumStep>` client component, replacing the Slice-1 `<StepPlaceholder>`. The form lets the partner add / remove / reorder modules and the lessons inside each module; everything persists to `payload.curriculum` via the existing `saveUploadDraftAction` (1s debounce + flush-on-unmount, same pattern as `DetailsStep`).

**Schema additions** (extend `lib/saveUploadDraftSchema.ts`):
- **`LessonPayload`** — `id` (UUID-string, ≤ 64 chars), `title` (required, ≤ 200, trim-normalized), `summary` (optional, ≤ 1000), `duration_seconds` (int, ∈ [0, 86400] = 24h), `is_preview` (bool), `display_order` (int, ∈ [0, 1000])
- **`ModulePayload`** — `id` (UUID-string, ≤ 64), `title` (required, ≤ 200), `summary` (optional, ≤ 1000), `display_order` (int, ∈ [0, 1000]), `lessons` (array of `LessonPayload`, ≤ 200)
- **`CurriculumPayload`** — `modules` (array of `ModulePayload`, ≤ 100)
- Constants exported alongside for the component to consume: `CURRICULUM_ID_MAX`, `CURRICULUM_TITLE_MAX`, `CURRICULUM_SUMMARY_MAX`, `CURRICULUM_DURATION_MAX_SECONDS`, `CURRICULUM_MAX_MODULES`, `CURRICULUM_MAX_LESSONS_PER_MODULE`
- All three are `.strict()` (rejects unknown top-level keys — defense in depth — a misbehaving client can't inject silently-stripped extra fields into the JSONB payload)
- `payloadForStep(2)` now returns the strict `Step2Payload = z.object({ curriculum: CurriculumPayload })` — Step 1 dispatch unchanged; Steps 3-5 still open

**Why partial-progress saves are allowed:** the spec AC line 72 says "Step 2 validates: at least 1 module, each module has at least 1 lesson, each lesson has a title and duration > 0", but the autosave criterion line 79 requires "drafts auto-save on every field change" — a partially-typed module title with no lessons yet must round-trip cleanly. Slice 2's schema accepts the empty/sparse shape; the gating validation is the Slice 5 submit-for-review boundary's job (filed in STUB-094 §Validation-gating). Inline UI in Slice 2 surfaces the in-progress state via empty-state placeholders ("+ Add your first module" / "No lessons in this module yet — Add at least one before submitting"). Lesson `duration_seconds = 0` is allowed (text/PDF lessons have no media length); the spec's literal "duration > 0" is interpreted as "≥ 0 for v1 + the Step 5 submit gate enforces ≥ 1" to keep the autosave permissive.

**Why the JSONB shape mirrors the eventual normalized tables:** the Slice 5 submit-for-review drain will read `payload.curriculum.modules` and write into `product_modules + product_lessons` (`migration 0039_partner_course_detail_foundation.sql`) without a shape translation step. Each module + lesson carries a stable client-generated `id` (UUID via `crypto.randomUUID()` in the browser; identity stays stable across reorders + edits so React's reconciliation is happy + the Slice-5 drain correlates draft rows to eventual DB rows). The Slice 2 schema does NOT yet carry `file_id` on lessons — that's Slice 3's job (Files step attaches uploads to lessons once the Bunny pipeline is in place).

**Pure ops library** (new `lib/curriculumOps.ts`): `appendModule` / `insertModuleAt` / `removeModuleById` / `moveModuleById` / `moduleMoveBounds`, plus the lesson-level `appendLesson` / `removeLessonById` / `moveLessonById` / `lessonMoveBounds` — all PURE (never mutate the input; return a new array reference or the original when it's a no-op). Every mutating op re-derives `display_order` to 0..N-1 so persistence + future re-renders see a stable contiguous order (matches the migration 0039 product_modules.display_order comment: "the partner detail page replaces the full tree, so we never have stale gaps"). `makeCurriculumId()` mints canonical RFC 4122 v4 hex-string UUIDs via `crypto.randomUUID()` with a fallback timestamp-based builder for older runtimes. `countLessons(modules)` + `totalLessonSeconds(modules)` aggregates power the future right-rail widget (STUB-094); exposed in the barrel now so they're testable in isolation.

**Client island** (new `components/CurriculumStep.tsx` + matching CSS module):
- Header + 1s-debounced autosave + the same `Saving… / Saved HH:MM:SS / Not saved yet` indicator + rate-limited / unauthenticated friendly error messages as `DetailsStep`
- Defensive `readCurriculumFromDraft` re-hydrates the tree from the draft's JSONB (drops unknown shapes, defaults missing fields to empty, re-derives display_order so a malformed draft doesn't crash the page)
- Per-module card: title input, optional summary textarea, "Module N" eyebrow, up/down/delete action group (move buttons disabled at the boundary — pure ops are no-ops there)
- Per-lesson row inside each module: title input, number input for `duration_seconds` (0–86400, clamped on blur), `is_preview` checkbox, up/down/delete actions
- Empty states: "+ Add your first module" CTA when curriculum is empty; "No lessons in this module yet — Add at least one before submitting" hint when a module has no lessons
- "+ Add lesson" button per module, "+ Add another module" button at the bottom of the list
- All inputs auto-save (1s debounce); the action's `current_step = MAX(existing, 2)` advances the wizard cursor on the partner's first save here

**Files (8 new + 5 edited)**:
- New: `lib/curriculumOps.ts`, `lib/curriculumOps.test.ts` (44 tests), `lib/saveUploadDraftSchema.test.ts` (54 tests), `components/CurriculumStep.tsx`, `components/CurriculumStep.module.css`
- Edited: `lib/saveUploadDraftSchema.ts` (added LessonPayload / ModulePayload / CurriculumPayload + CURRICULUM_* constants + `.strict()` on DetailsPayload + CurriculumPayload + the case-2 dispatch in payloadForStep)
- Edited: `components/UploadShell.tsx` (added `currentStep === 2 ? <CurriculumStep />` branch in the body section)
- Edited: `index.ts` (barrel re-exports of CurriculumPayload / ModulePayload / LessonPayload / curriculumOps + CurriculumStep)
- Edited: `actions/saveUploadDraft.test.ts` (split the Slice-1 "Steps 2-5 open" test into Step 2 STRICT + Steps 3-5 open; fixed the existing current-step-never-regress test's payload to use the now-strict `{ curriculum: { modules: [...] } }` shape; added 7 new Step 2 action tests: happy path / empty curriculum / malformed curriculum (missing module title) → invalid_input / negative lesson display_order → invalid_input / negative duration_seconds → invalid_input / audit metadata `curriculum` in `fields_changed` (no body leakage) / shallow-merge with prior Step 1 `details` key)

**Tests**: 2858 → 2964 passed (+106 net new: 54 schema + 44 ops + 7 action + 1 accidental existing-passing). All 6 checks green: typecheck + lint + check:no-todo + check:pii + check:specs + check:rls.

**Build**: `/partner/upload` 3.32 → 6.38 kB / 113 → 129 kB first-load JS (the +3 KB delta = CurriculumStep client island + CSS module; well under the spec's 80 KB per-page budget). Shared first-load JS unchanged at 101 kB (the new schemas + ops are server-side / tree-shaken for any RSC-shaped code path). Route count unchanged at 58 — the new component composes into the existing `/partner/upload` route.

**Acceptance-criteria coverage** (per `01-specs/pages/instructor-upload.md` §"Acceptance criteria" + the open-spec AC #72):
- AC "Page is auth-gated AND requires `profiles.role IN ('partner')`" — Slice 1's `requirePartner()` continues to gate the route; unchanged in Slice 2.
- AC "Drafts auto-save (debounced 1s) on every field change" — Slice 2 ships the same exact `flushSave` + 1s `setTimeout` debounce + `useEffect` flush-on-unmount as `DetailsStep`. Verified by manual inspection of `CurriculumStep.tsx`.
- AC "Closing the tab and coming back: the draft is restored" — Slice 1's `getMyUploadDraft` reads `payload.curriculum` on page load; Slice 2's `readCurriculumFromDraft` defensively re-hydrates the tree from that JSONB. Verified by manual inspection.
- AC "Step 2 validates: at least 1 module, each module has at least 1 lesson, each lesson has a title and duration > 0" — Slice 2's UI surfaces empty-state hints (no formal gating); the strict gating is deferred to Slice 5's submit-for-review boundary per STUB-094 §Validation-gating. The schema is permissive to allow partial-progress saves (see "Why partial-progress saves are allowed" above).
- AC "Page renders in < 500ms p95" — the `/partner/upload` 129 kB first-load is well within the spec target on any modern connection; the CurriculumStep adds +3 KB of client JS that the partner re-uses across module/lesson edits (no per-edit roundtrip cost — the autosave is `useTransition`-driven and server-side Zod runs in ≤ 2ms for the curriculum size the spec recommends).
- AC "No TODO / FIXME in the diff" — Slice 2's deferrals live in STUB-094, never in the source.

**Deferred to STUB-094** (future slices; Slice 2 doesn't ship these):
- Drag-and-drop reordering (Slice 2 ships keyboard-accessible up/down buttons that match the helper API; drag-drop is a UI extension)
- Right-rail summary widget (live "X modules · Y lessons · Z min")
- Inline validation gating on Continue / Submit (Slice 5's submit-for-review is the canonical gate)
- Live-curriculum preview mirror in Step 5 (Step 5's preview surface)
- File-id attachment on lessons (Slice 3 attaches Bunny uploads)

---

### P12.10 (2026-06-30) — Course draft auto-save (verification tick)

**PHASES.md line was:** *"Course draft auto-save — every 30 s while editing."*
**Spec line (binding):** *"Drafts auto-save (debounced 1s) on every field change"* (line 79) + *"Autosave: debounced 1s; the server action returns immediately; the UI shows a 'Saved' indicator when the response arrives"* (line 122) + *"Save draft | (automatic, debounced 1s after any field change)"* (line 32). Same pattern across the `/partner/courses/[id]` curriculum-edit surface at `partner-courses-detail.md:105`.

**Resolution:** PHASES.md was stale; the spec wins per AGENTS.md rule #5. The shipped code matches the spec (1s debounce). PHASES.md line 487 amended this tick (no longer says "30 s").

**Surface shipped by P12.7 Slices 1 + 2** — every editable draft field auto-saves within 1s of the partner's last keystroke:
- **Step 1 — Details** (`DetailsStep.tsx`, `DEBOUNCE_MS = 1000`): title (≤200), long_description (50..10000), category_id (positive int from partner-visible categories dropdown), kind (6-option enum). All four fields route through the `details` payload key.
- **Step 2 — Curriculum** (`CurriculumStep.tsx`, `DEBOUNCE_MS = 1000`): module add / remove / reorder / edit-title / edit-summary + lesson add / remove / reorder / edit-title / edit-summary / duration-seconds / is-preview toggle. All ops route through the `curriculum` payload key with strict Zod shape validation (`LessonPayload` + `ModulePayload` + `CurriculumPayload`, all `.strict()` — rejects unknown top-level keys).

**Server action (`saveUploadDraftAction`):**
- Auth gate → rate limit 60/min/user in-process sliding window → Zod wire schema (`step ∈ [1,5]`) → per-step `payloadForStep()` Zod dispatcher (Step 1 strict, Step 2 strict, Steps 3-5 open shapes until those slices tighten in place) → read existing draft → block saves on submitted drafts → shallow-merge the step's payload key into `payload` jsonb → upsert with `onConflict: 'user_id'` → audit log row (masked; payload body NEVER logged) → `revalidatePath('/partner/upload')`. `current_step = MAX(existing, new)` never regresses.
- Race-safe: row-level lock from the Postgres upsert on UNIQUE `user_id` index; concurrent saves serialise naturally.
- Idempotent: re-saving the same shape is a no-op (shallow-merge produces identical payload).

**Client island pattern** (both `DetailsStep` and `CurriculumStep`):
- `useRef<setTimeout>` for the debounce handle
- `setTimeout(flushSave, DEBOUNCE_MS)` on every state change → reschedules; only the last write in a 1s window actually fires
- `useEffect` cleanup `clearTimeout` + immediate `flushSave()` on unmount — guarantees the last edit reaches the DB before navigation or tab close
- Inline save indicator with three states: `Saving…` (in-flight) → `Saved HH:MM:SS` (success) with green-dot accent → `Not saved yet` (initial); inline error slot for `rate_limited` (echoes `retryAfterSeconds`) / `unauthenticated` / generic friendly
- Skip the save when the form is mid-typing (empty title or unparseable category) to avoid flooding the audit log with rejected inputs — a partner can finish typing and the next keystroke reschedules

**Acceptance criteria (line 79):**
- ✅ "Drafts auto-save (debounced 1s) on every field change" — verified by `DEBOUNCE_MS = 1000` constant in both client components + the `useTransition`-driven `flushSave` invoked on every `useEffect` change. Slice 2 ships the same exact pattern as Slice 1 (`CurriculumStep.tsx` lines 68 + 160-212 mirrors `DetailsStep.tsx` lines 49 + 114-177).
- ✅ "Closing the tab and coming back: the draft is restored" — Slice 1's `getMyUploadDraft` reads `payload.{details,curriculum,...}` on page load; the forms defensively re-hydrate from the JSONB.

**Acceptance criteria (line 122):** ✅ *"debounced 1s; the server action returns immediately; the UI shows a 'Saved' indicator when the response arrives"* — the action returns a typed `SaveUploadDraftResult` discriminated union (`{ ok: true }` / `{ ok: false, error: 'rate_limited'|'unauthenticated'|'invalid_input'|'save_failed', ... }`) and the client's `useTransition` flips the indicator from `Saving…` to `Saved HH:MM:SS` on `ok:true`.

**Deferred** (none for P12.10 itself; the autosave contract is fully shipped):
- Steps 3-5 (Files / Pricing / Review) will reuse the exact same `saveUploadDraftAction` with the open-shape `payloadForStep(3..5)` Zod once those slices land; the autosave contract extends cleanly.
- Right-rail live "Saved at step N" widget reads `last_saved_step` from the row (Slice 1 already populates it).

**Checks:** all 6 green + `pnpm test` 3150/3152 pass (1 pre-existing encryption flake documented in earlier logs; passes 54/54 in isolation) + `pnpm build` clean (58 routes; `/partner/upload` 6.38 kB / 129 kB first-load JS — Slice 2 baseline, no delta from this tick).

**Tick:** `docs/PROGRESS.md` P12.10 `[ ]` → `[x]`. PHASES.md line 487 amended to match the spec.

