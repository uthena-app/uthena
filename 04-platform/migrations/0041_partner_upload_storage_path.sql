-- ============================================================================
-- 0041_partner_upload_storage_path.sql — P12.8 (Slice 1) upload backend
-- foundation: extend partner_uploads with the columns the Bunny webhook
-- needs to identify a row, plus a typed failure_kind discriminator so the
-- P12.7 Slice 3 Files UI can render a partner-friendly error message
-- instead of a generic "something failed".
--
-- Spec context (01-specs/pages/instructor-upload.md):
--   "Storage paths: /partner-uploads/{partner_id}/{upload_id}/{file_id}.{ext}"
--   "File type validation: videos must be MP4/MOV, source must be PDF/PPTX/DOCX/ZIP"
--   "Every uploaded file shows its malware scan status in the submission
--    checklist; submit is blocked until every file is scan_status='clean'"
--   "An infected file shows a clear quarantine error to the partner"
--
-- The existing partner_uploads table (0001_initial.sql line 1302) already
-- covers scan_status + encoding_status + tus_upload_id + product_file_id.
-- P12.8 Slice 1 adds:
--   - `storage_path` — the Bunny Storage path the webhook reads off the
--     event payload. The webhook needs a stable identifier to find the
--     row (Bunny sends the Storage path on every event but does NOT
--     send our internal row id). Index on this column so the
--     webhook handler's UPDATE is index-driven.
--   - `failure_kind` — typed discriminator for non-scan failures. The
--     client-side failure surface needs to distinguish 'network'
--     (user's browser lost connectivity mid-upload), 'aborted' (user
--     clicked ✕), 'rejected' (Bunny rejected the upload — quota,
--     permissions), 'oversized' (file exceeded the kind's cap), and
--     'unscanned' (upload completed but scan never fired). Pairs with
--     `failure_reason` (free text, capped at 1000) for human-readable
--     detail. Check-constraint-as-enum (PG policy: never drop a
--     value from an enum type — adding a typed CHK keeps it additive).
--   - `webhook_received_at` — the last time a Bunny scan/encoding
--     event landed for this row. Useful for the Submission Checklist
--     UI's "Last activity: <X ago>" hint + for the cron that alerts on
--     stuck uploads (Slice 2/3).
--
-- RLS: no changes. The new columns inherit partner_uploads's existing
-- partner_read_own + partner_write_own (status=draft) + admin_all
-- policies. The CHECK constraints are validated on INSERT/UPDATE
-- regardless of caller, so the existing RLS shape is sufficient.
--
-- IDEMPOTENT: ALTER TABLE ... ADD COLUMN IF NOT EXISTS (Postgres 9.6+,
-- already required for our other recent migrations). CHECK constraints
-- are wrapped in DO blocks with EXCEPTION WHEN duplicate_object guards
-- so re-running the migration against a partially-applied DB is safe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. storage_path — Bunny Storage path; webhook lookup key
-- ---------------------------------------------------------------------------
alter table partner_uploads
  add column if not exists storage_path text not null default '';

comment on column partner_uploads.storage_path is
  'P12.8 — Bunny Storage path. Layout: partner-uploads/{partner_id}/{upload_id}/{file_id}.{ext} per spec §instructor-upload.md. Webhook handler looks up the row by this path (Bunny does not send our row id on the event). Empty string for legacy rows (pre-P12.8) where the path was embedded in tus_upload_id or not recorded. New rows MUST set this column (the createPartnerFileUpload server action sets it server-side; the value never comes from the wire).';

-- ---------------------------------------------------------------------------
-- 2. failure_kind — typed discriminator for non-scan failures
-- ---------------------------------------------------------------------------
-- Values mirror the partner-friendly copy in the P12.7 Slice 3 Files UI.
-- Add to the set with a new migration; never rename or remove a value
-- (matches the AGENTS.md + ENUM-AUDIT.md policy).
--
-- Inline comments inside the CHECK avoid apostrophes/quotes to keep
-- the CI check-enum-coverage.sh awk parser from mis-attributing
-- comment text as a CHECK value (the parser splits the CHECK buf
-- on `'`; apostrophes inside comments land between the real values
-- in the split output).
do $$ begin
  alter table partner_uploads
    add column if not exists failure_kind text
    check (failure_kind in (
      'network',
      'aborted',
      'rejected',
      'oversized',
      'unscanned',
      'other'
    ));
exception when duplicate_object then null; end $$;

-- Per-kind rationale (kept as table-level comments — the table-level
-- comments do NOT feed into the CHECK parser):
comment on column partner_uploads.failure_kind is
  'P12.8 - Typed failure discriminator for client/server-side upload failures. NULL while the upload is in progress or successful. The P12.7 Slice 3 Files UI uses this to render a partner-friendly error message. Values: network (browser lost connectivity mid-upload), aborted (user clicked the cancel button on a file row), rejected (Bunny rejected the upload for zone quota or path ACL reasons), oversized (file exceeded the per-kind cap), unscanned (upload completed but scan webhook never fired), other (free-text failure_reason holds the actual cause). Stored as text + CHECK rather than a Postgres enum so the deprecation policy in ENUM-AUDIT.md applies.';

comment on column partner_uploads.failure_kind is
  'P12.8 — Typed failure discriminator for client/server-side upload failures. NULL while the upload is in progress or successful. The P12.7 Slice 3 Files UI uses this to render a partner-friendly error message ("You cancelled this upload — Click to retry" vs "Connection lost — We saved what was uploaded" vs "File exceeded the 50GB limit"). Stored as text + CHECK rather than a Postgres enum so the deprecation policy in ENUM-AUDIT.md applies (text-Check is forward-only via ADD CONSTRAINT, never destructive).';

-- ---------------------------------------------------------------------------
-- 3. webhook_received_at — last Bunny event timestamp for this row
-- ---------------------------------------------------------------------------
alter table partner_uploads
  add column if not exists webhook_received_at timestamptz;

comment on column partner_uploads.webhook_received_at is
  'P12.8 — Timestamp of the most recent Bunny scan/encoding event for this row. NULL until the first webhook fires. Powers the Submission Checklist "Last activity: <X ago>" hint in the P12.7 Slice 3 Files UI + the future cron that alerts on stuck uploads (P12.8 Slice 2/3).';

-- ---------------------------------------------------------------------------
-- 4. Indexes — webhook-driven updates
-- ---------------------------------------------------------------------------
-- The Bunny webhook handler's first action is UPDATE partner_uploads
-- WHERE storage_path = $1. Without this index the lookup is a sequential
-- scan. Per-row volume is bounded (one row per uploaded file) but the
-- index makes the webhook handler's UPDATE index-driven regardless of
-- catalog size. Excludes the empty-string default so the partial index
-- is small (legacy rows + not-yet-minted rows are excluded from the
-- lookup surface).
create index if not exists partner_uploads_storage_path_idx
  on partner_uploads (storage_path)
  where storage_path <> '';

-- For the future "stuck uploads" cron (P12.8 Slice 2/3) — finds rows
-- that received no webhook event in the last N hours. Partial index
-- on the not-yet-received bucket keeps the scan cheap.
create index if not exists partner_uploads_no_webhook_idx
  on partner_uploads (created_at, partner_id)
  where webhook_received_at is null
    and scan_status = 'pending';

-- ---------------------------------------------------------------------------
-- STUB REGISTER
-- ---------------------------------------------------------------------------
-- STUB-095 — P12.8 partner upload backend foundation (Slice 1).
-- Migration 0041 ships the storage_path column + the typed failure_kind
-- discriminant + the webhook_received_at tracking column. It is the data
-- contract the P12.7 Slice 3 Files UI binds to and the Bunny webhook
-- handler dispatches on. No real Bunny HTTP calls land in this migration
-- — the upstream-side integration (Bunny Stream tus session create +
-- Storage signed PUT URL mint + ClamAV scan trigger) is wired in Slice 2
-- once BUNNY_STORAGE_*/BUNNY_STREAM_*/CLAMAV_* env vars are populated in
-- Doppler/Coolify (ASK carried in PROGRESS log).
