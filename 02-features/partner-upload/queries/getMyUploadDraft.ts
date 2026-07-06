// getMyUploadDraft — read the current user's partner-upload wizard draft.
//
// P12.7 Slice 1 — schema scaffolding + draft read.
//
// The `partner_upload_drafts` table is declared in migration 0040 with
// columns: id, user_id (UNIQUE), payload jsonb, current_step int,
// last_saved_step int, status enum (draft/submitted/withdrawn),
// submitted_at, reviewed_at, reviewer_id, decision, decision_notes,
// created_at, updated_at. RLS gives the user self read/write and the
// admin full access.
//
// We read with `maybeSingle()` because the row is created lazily on
// the user's first step save — a brand-new visitor has no row yet
// and the page must render the wizard from step 1 anyway.
//
// Defensive: `payload` is `unknown` until we coerce it. We narrow it
// to `Record<string, unknown>` and never destructure past one level —
// any deeper shape is a step-specific contract owned by the step's
// server action. Keeping the read loose here means step payloads can
// evolve without touching this query.

import 'server-only'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'partner-upload.getMyUploadDraft' })

// ---------------------------------------------------------------------------
// Step constants — the wizard's canonical 1..5 model
// ---------------------------------------------------------------------------

/** Step number constants — 1-based, matching the wizard's
 *  `current_step` column. The order is the spec's canonical order
 *  (Details → Curriculum → Files → Pricing → Review).
 *
 *  Per `01-specs/pages/instructor-upload.md` line 16: "5 steps
 *  (Details, Curriculum, Files, Pricing, Review) with active/done
 *  states". PHASES.md §P12.7 reads "Details → Pricing → Files →
 *  Review → Submit" (with Submit collapsed into Review) but the spec
 *  is the contract — see STUB-094 in the implementation notes. */
export const UPLOAD_STEP_DETAILS = 1
export const UPLOAD_STEP_CURRICULUM = 2
export const UPLOAD_STEP_FILES = 3
export const UPLOAD_STEP_PRICING = 4
export const UPLOAD_STEP_REVIEW = 5

export const UPLOAD_FIRST_STEP = UPLOAD_STEP_DETAILS
export const UPLOAD_LAST_STEP = UPLOAD_STEP_REVIEW
export const UPLOAD_TOTAL_STEPS = 5

/**
 * The ordered step list with display labels + short descriptions.
 * The page renders this directly into the `<Stepper>`. Keeping it as
 * a const (not a function) lets the test assert the exact shape
 * without mocking anything.
 */
export const UPLOAD_STEPS = [
  {
    id: 'details',
    step: UPLOAD_STEP_DETAILS,
    label: 'Details',
    description: 'Title, description, category',
  },
  {
    id: 'curriculum',
    step: UPLOAD_STEP_CURRICULUM,
    label: 'Curriculum',
    description: 'Modules + lessons',
  },
  {
    id: 'files',
    step: UPLOAD_STEP_FILES,
    label: 'Files',
    description: 'Video, source, sales materials',
  },
  {
    id: 'pricing',
    step: UPLOAD_STEP_PRICING,
    label: 'Pricing',
    description: '3-tier license matrix',
  },
  {
    id: 'review',
    step: UPLOAD_STEP_REVIEW,
    label: 'Review',
    description: 'Preview + submit',
  },
] as const

export type UploadStepId = (typeof UPLOAD_STEPS)[number]['id']

export type UploadDraftStatus = 'draft' | 'submitted' | 'withdrawn'

export type UploadDraft = {
  /** Always true when this object is returned — distinguishes "draft
   *  exists in DB" from "no draft yet, but the page should still
   *  render". The caller can branch on `exists` if it needs to. */
  exists: true
  currentStep: number
  lastSavedStep: number
  status: UploadDraftStatus
  payload: Record<string, unknown>
  submittedAt: string | null
  reviewedAt: string | null
  reviewerId: string | null
  decision: string | null
  decisionNotes: string | null
  createdAt: string
  updatedAt: string
}

export type UploadDraftResult =
  | { exists: false }
  | UploadDraft

const DRAFT_COLS =
  'id, user_id, payload, current_step, last_saved_step, status, submitted_at, reviewed_at, reviewer_id, decision, decision_notes, created_at, updated_at'

/** Read the current user's upload-wizard draft. Returns
 *  `{ exists: false }` for anon callers OR when the user has no draft
 *  yet (the row is created lazily on first step save). RLS on the
 *  table restricts read to `user_id = auth.uid()`, so even a forged
 *  user object would 0-row. */
export async function getMyUploadDraft(): Promise<UploadDraftResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { exists: false }

  const { data, error } = await supabase
    .from('partner_upload_drafts')
    .select(DRAFT_COLS)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    log.warn(
      { code: 'partner_upload_draft_read_failed', msg: error.message },
      'partner upload draft read failed',
    )
    return { exists: false }
  }
  if (!data) return { exists: false }

  // Defensive coercion — the columns are typed in the DB but
  // PostgREST's `unknown` / `jsonb` round-trip can serialize them
  // as anything. We narrow defensively rather than casting.
  const row = data as {
    current_step?: unknown
    last_saved_step?: unknown
    status?: unknown
    payload?: unknown
    submitted_at?: unknown
    reviewed_at?: unknown
    reviewer_id?: unknown
    decision?: unknown
    decision_notes?: unknown
    created_at?: unknown
    updated_at?: unknown
  }

  const currentStep = clampStep(row.current_step, UPLOAD_FIRST_STEP)
  const lastSavedStep = clampStep(row.last_saved_step, currentStep)
  const status: UploadDraftStatus =
    row.status === 'submitted' || row.status === 'withdrawn' ? row.status : 'draft'

  const payload: Record<string, unknown> =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {}

  return {
    exists: true,
    currentStep,
    lastSavedStep,
    status,
    payload,
    submittedAt: typeof row.submitted_at === 'string' ? row.submitted_at : null,
    reviewedAt: typeof row.reviewed_at === 'string' ? row.reviewed_at : null,
    reviewerId: typeof row.reviewer_id === 'string' ? row.reviewer_id : null,
    decision: typeof row.decision === 'string' ? row.decision : null,
    decisionNotes: typeof row.decision_notes === 'string' ? row.decision_notes : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString(),
  }
}

/** Pure helper — clamp a raw step number from the DB into the
 *  canonical [UPLOAD_FIRST_STEP, UPLOAD_LAST_STEP] range, defaulting
 *  to `fallback` when the value isn't a valid integer. */
function clampStep(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return fallback
  return Math.max(UPLOAD_FIRST_STEP, Math.min(UPLOAD_LAST_STEP, raw))
}
