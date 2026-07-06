-- ============================================================================
-- 0040_partner_upload_drafts.sql — P12.7 course creation wizard foundation.
--
-- Adds the wizard's per-partner draft table. The P12.7 spec
-- (`01-specs/pages/instructor-upload.md`) describes a 5-step wizard at
-- `/partner/upload` (Details → Curriculum → Files → Pricing → Review)
-- that auto-saves each step to a draft row so the partner can leave and
-- come back. The same spec mentions `partner_uploads` as the persistence
-- surface, but `partner_uploads` is ALREADY TAKEN — it's the per-file
-- Bunny tus + scan record table declared in 0001_initial.sql line 1302
-- (one row per uploaded file with tus_upload_id, scan_status,
-- encoding_status, etc.). Conflating wizard state with file records
-- would force every read to filter by a discriminator and break the
-- file-upload pipeline's existing RLS policies.
--
-- Resolution: a dedicated table for the wizard draft, mirroring the
-- `partner_onboarding_drafts` pattern (0001_initial.sql line 1351):
--   - one row per user_id (UNIQUE)
--   - payload jsonb for shallow-merge of per-step form state
--   - current_step int for the stepper's active step
--   - status enum: 'draft' | 'submitted' | 'withdrawn'
--   - submitted_at timestamptz when the partner clicks "Submit for review"
--   - reviewed_at + reviewer_id + decision + decision_notes for the
--     admin's moderation result (the spec table schema at
--     docs/ARCHITECTURE.md line 79)
--
-- The submitted status is NOT terminal in v1: a partner can "Withdraw"
-- (spec line 51) which transitions back to 'draft'. There's no DB-level
-- constraint preventing rewrites after submitted because the partner's
-- withdraw path needs to flip the status; the spec's "read-only after
-- submit" semantics are enforced at the server-action layer.
--
-- The wizard is owned by partners; admins read everything (for review
-- queue + decision audits). The RLS model mirrors partner_onboarding_drafts
-- exactly:
--   - partner_upload_drafts_self_read (SELECT, user_id = auth.uid())
--   - partner_upload_drafts_self_write (ALL, user_id = auth.uid())
--   - partner_upload_drafts_admin_all (ALL, is_admin())
--
-- The 'partner_upload.step_saved' audit action (added in enums.ts this
-- tick) writes one row per save with target_kind='partner_upload_drafts'
-- and metadata={step, next_step, fields_changed} (no payload body — the
-- future curriculum + files step payloads will include file paths and
-- third-party identifiers that must not be logged).
--
-- Indexing strategy (per spec §Performance + AGENTS.md §"DB indexes"):
--   - PRIMARY KEY on id (the UNIQUE on user_id already provides the
--     per-user lookup; no extra index needed)
--   - partner_upload_drafts_status_submitted_idx on (status, submitted_at
--     desc) for the admin review queue (P14.x territory — the query is
--     "all submitted drafts, oldest first")
--   - partner_upload_drafts_partner_idx on (user_id) is implicit via the
--     UNIQUE constraint — added explicitly for query-planner clarity.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- DROP POLICY IF EXISTS + CREATE POLICY. Safe to re-run against a
-- partially-applied state. The new enum value uses the same
-- `exception when duplicate_object then null $$;` guard pattern as the
-- existing product_kind enum (0001 line 56).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. New enum: partner_upload_draft_status
-- ---------------------------------------------------------------------------
do $$ begin
  create type partner_upload_draft_status as enum (
    'draft',        -- partner is editing; autosaves land here
    'submitted',    -- partner clicked "Submit for review"; frozen for admin
    'withdrawn'     -- partner pulled it back to draft (admin queue hides these)
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. partner_upload_drafts — one row per user, wizard state + payload
-- ---------------------------------------------------------------------------
--
-- `short_description` is intentionally NOT a column. The Settings tab
-- (P12.6 Slice 1) uses it on the partner course detail page, but the
-- P12.7 wizard spec lists only `title`, `long_description`, `category_id`,
-- and `kind` for Step 1 (spec line 17). We keep the column set tight
-- and rely on the Settings tab to add short_description on an existing
-- course if/when that's needed.
--
-- `last_saved_step` lets the spec's right-rail "Saved N seconds ago"
-- indicator render without forcing the page to parse every key in the
-- payload jsonb. Updated by the saveUploadDraft server action on every
-- successful save. The column mirrors current_step (one number, two
-- purposes) — the spec's "live preview" + checklist reads current_step,
-- while the "Saved at" footer reads updated_at; last_saved_step is
-- redundant with current_step for v1 but provides a stable sort key
-- for the admin queue without parsing the payload.
--
-- We do NOT add a partner_id FK to `partners(id)` because:
--   - the user may not be a partner yet at draft-creation time (the
--     spec is silent on the partner-status gate, but the auth layer's
--     `requirePartner()` lets pending + suspended + approved all in)
--   - the draft is keyed on user_id to mirror `partner_onboarding_drafts`
--   - the admin review queue joins on user_id → profiles to get the
--     partner display name when it ships
-- ---------------------------------------------------------------------------
create table if not exists partner_upload_drafts (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  -- Wizard state
  current_step int not null default 1 check (current_step between 1 and 5),
  last_saved_step int not null default 1 check (last_saved_step between 1 and 5),
  status partner_upload_draft_status not null default 'draft',
  -- Shallow-merged jsonb: each step writes its own top-level key
  -- (`details` / `curriculum` / `files` / `pricing` / `review`) so the
  -- merge never clobbers another step's keys.
  payload jsonb not null default '{}'::jsonb,
  -- Moderation (admin territory — the partner writes the draft; the
  -- admin writes the decision). Future P14.x review queue surfaces these.
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id),
  decision text check (decision is null or length(decision) <= 1000),
  decision_notes text check (decision_notes is null or length(decision_notes) <= 2000),
  -- Standard bookkeeping
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table partner_upload_drafts enable row level security;

-- Self read: the partner can see their own draft.
drop policy if exists "partner_upload_drafts_self_read" on partner_upload_drafts;
create policy "partner_upload_drafts_self_read" on partner_upload_drafts
  for select using (user_id = auth.uid());

-- Self write: the partner can save + withdraw their own draft.
-- Defense in depth: the server actions never accept a user_id from the
-- wire (it's always derived from the session via getServerSupabase().auth.getUser()).
drop policy if exists "partner_upload_drafts_self_write" on partner_upload_drafts;
create policy "partner_upload_drafts_self_write" on partner_upload_drafts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin all: review queue + decision writes.
drop policy if exists "partner_upload_drafts_admin_all" on partner_upload_drafts;
create policy "partner_upload_drafts_admin_all" on partner_upload_drafts
  for all using (is_admin());

-- Index for the admin review queue (status='submitted', oldest first).
create index if not exists partner_upload_drafts_status_submitted_idx
  on partner_upload_drafts (status, submitted_at desc)
  where status = 'submitted';

-- Explicit per-user index for clarity (the UNIQUE on user_id covers
-- point lookups; this index supports the per-partner list surface that
-- the dashboard's "My drafts" widget will want when it ships).
create index if not exists partner_upload_drafts_user_idx
  on partner_upload_drafts (user_id);

-- updated_at trigger (consistent with the rest of the schema)
drop trigger if exists partner_upload_drafts_set_updated_at on partner_upload_drafts;
create trigger partner_upload_drafts_set_updated_at before update on partner_upload_drafts
for each row execute function set_updated_at();

comment on table partner_upload_drafts is
  'P12.7 — Course creation wizard draft. One row per user_id (UNIQUE). payload jsonb is shallow-merged per step (each step owns its own top-level key: details / curriculum / files / pricing / review). status transitions: draft → submitted (partner clicks Submit for review) → withdrawn (partner pulls it back) → admin writes decision. The table is intentionally separate from partner_uploads (per-file Bunny tus records) — see migration header for rationale.';

comment on column partner_upload_drafts.payload is
  'Shallow-merged jsonb. Each step writes its own top-level key (details, curriculum, files, pricing, review). Future slices tighten the per-key shape via Zod in `02-features/partner-upload/lib/saveUploadDraftSchema.ts`.';

comment on column partner_upload_drafts.current_step is
  'The active step number (1..5). NEVER regressed on save (saving an earlier step must not push the user back). Default 1.';

comment on column partner_upload_drafts.last_saved_step is
  'The step that the most-recent save wrote. Distinct from current_step because current_step is "where the user IS in the wizard" while last_saved_step is "what they last touched" — they can navigate forward without saving, in which case last_saved_step < current_step.';

comment on column partner_upload_drafts.status is
  'Wizard status. draft = editing; submitted = awaiting admin review (read-only for partner); withdrawn = partner pulled back to editing (admin queue hides these). Admin-only moderation columns (reviewed_at / reviewer_id / decision / decision_notes) are populated when status moves through the admin''s review decision.';

-- ---------------------------------------------------------------------------
-- STUB REGISTER
-- ---------------------------------------------------------------------------
-- STUB-093 — P12.7 partner course creation wizard schema foundation.
-- Migration 0040 ships the wizard's draft table + RLS + audit action
-- enum coverage. The Slice 1 surface (`/partner/upload` route shell +
-- stepper + Step 1 Details form + autosave + URL aliases) reads from
-- this table; subsequent slices (Curriculum / Files / Pricing / Review)
-- reuse this table + extend `payload` jsonb with their own top-level
-- keys. See docs/PROGRESS.md 2026-06-30 P12.7 note.
