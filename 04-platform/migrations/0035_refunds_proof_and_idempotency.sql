-- ---------------------------------------------------------------------------
-- 0035_refunds_proof_and_idempotency.sql
-- ---------------------------------------------------------------------------
-- Resolves STUB-082 (the open idempotency follow-up called out at the
-- bottom of `02-features/account/profile/actions/createRefundRequest.test.ts`)
-- + ships the P9.12 acceptance-criterion surface for the optional
-- refund-proof upload.
--
-- Three new columns on the existing `refunds` table:
--
--   1. proof_path        — Bunny Storage path where the user-uploaded
--                          proof of issue lives. Nullable: proofs are
--                          optional (spec acceptance criterion: "File
--                          upload ... optional"). Layout follows the
--                          existing avatar pattern: `refund-proofs/{userId}/{uuid}.{ext}`
--                          (the userId namespace sandbox bounds a
--                          forged request's write surface; the UUID
--                          suffix prevents collisions on concurrent
--                          uploads from the same user).
--
--   2. proof_filename    — the user's original filename, sanitized
--                          (a-zA-Z0-9._- per the spec §Security
--                          line 100). Stored so admins see what the
--                          user saw when they uploaded — not the
--                          UUID'd path. Nullable for the same reason
--                          as proof_path.
--
--   3. client_request_id — a UUID generated client-side per form
--                          submission. Spec §Security line 97
--                          prescribes idempotency: a network retry
--                          (user double-clicks Submit, browser
--                          reconnects mid-flight) must not create a
--                          duplicate refund row. The unique partial
--                          index enforces "one refund per
--                          client_request_id" at the DB level — the
--                          server action's idempotency check is the
--                          primary defense, the unique index is the
--                          safety net.
--
-- Why partial (WHERE ... IS NOT NULL) rather than full:
--   - Admin-issued refunds (the P14.9 admin queue / `admin.refund_approve`
--     audit path) do NOT have a client_request_id — they originate
--     server-side and a NULL value is the legitimate signal "this
--     refund was not user-initiated". A full unique index would
--     reject multiple NULL rows (Postgres treats NULLs as distinct
--     in UNIQUE indexes, but only one NULL per the SQL standard
--     when not using NULLS DISTINCT). The partial index lets
--     unlimited admin refunds coexist with at most one user
--     refund per client_request_id.
--
-- RLS: no policy changes. The existing `refunds_self_read` /
-- `refunds_self_request` / `refunds_admin_all` policies cover all
-- three new columns (they reference the row, not the columns). The
-- `check:rls` static check is satisfied because no new table is
-- created — only columns on the existing `refunds` table.
--
-- Idempotent: every ALTER is `ADD COLUMN IF NOT EXISTS`; the unique
-- index is `CREATE UNIQUE INDEX IF NOT EXISTS`. A re-run against a
-- partially-migrated DB is a no-op.
--
-- Used by:
--   - 02-features/account/profile/actions/createRefundRequest.ts
--     (idempotency check on client_request_id + insert includes
--     proof_path/proof_filename)
--   - 02-features/account/profile/actions/requestRefundProofUpload.ts
--     (P9.12 file-upload mint action; mints the Bunny signed PUT URL
--     and the storagePath is passed back to the form, which then
--     includes it as proof_path when creating the refund row)
--   - admin/refunds queue (P14.9 — surfaced via the admin UI; admins
--     can request a signed download URL via the existing bunny.ts
--     signed-URL helpers, logged to file_downloads)
-- ---------------------------------------------------------------------------

alter table refunds
  add column if not exists proof_path text;

alter table refunds
  add column if not exists proof_filename text;

alter table refunds
  add column if not exists client_request_id text;

-- Unique partial index — the idempotency safety net. The action's
-- pre-check is the primary defense; this index is what catches a
-- race condition where two parallel requests with the same
-- client_request_id slip past the pre-check (one wins on INSERT, the
-- other hits a unique-violation and the action recovers by looking
-- up the winner).
create unique index if not exists refunds_client_request_id_key
  on refunds (client_request_id)
  where client_request_id is not null;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------

-- check:rls static check — no new tables, only columns on `refunds`.
-- Existing RLS policies cover the new columns.

-- end of migration