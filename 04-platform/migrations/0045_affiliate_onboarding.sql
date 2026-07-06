-- ============================================================================
-- 0045_affiliate_onboarding.sql — P13.1 affiliate onboarding wizard foundation.
--
-- Adds the wizard's per-user draft table + the race-safe handle-reservation
-- table. Per the spec at `01-specs/pages/affiliate-onboarding.md`:
--
--   - 6-step wizard at `/affiliate/onboarding`:
--       Welcome → Handle & bio → Payout → Promo methods → Agreement → Submit
--   - One draft row per user_id (UNIQUE) so the wizard can leave and resume
--   - The handle chosen on step 2 is RESERVED immediately (separate table)
--     so two concurrent users can't both pick "alice" before submit lands
--   - On submit, the reservation is transferred (in a transaction: insert
--     into `affiliates`, delete the reservation). Deferral: the submit
--     server action lands in P13.1 Slice 2+ — Slice 1 only ships the
--     foundation (draft + reservation) + the saveStep server action that
--     upserts the draft + reserves the handle.
--
-- **Why a separate `handle_reservations` table?**
-- The spec (§"`handle_reservations` — race-safe handle uniqueness"):
-- `affiliates.handle` is the long-lived artifact (a row there means "this
-- handle is permanently taken by an approved affiliate"). The reservation
-- table is the soft-hold ("this handle is in use by a wizard that may or
-- may not finish"). Putting reservations on `affiliates` directly would
-- block the handle for the lifetime of an abandoned row. A separate table
-- + a 7-day janitor (cron lands in P13.x follow-up — STUB-103) lets
-- abandoned wizards release their handle without admin intervention.
--
-- **Schema differences from `partner_onboarding_drafts`:**
--   - Per-step jsonb columns (`handle_bio` / `payout` / `promo_methods` /
--     `agreement`) instead of one `payload` jsonb. The spec pins each
--     step's column explicitly, which makes the Zod schemas narrower
--     (each step validates its OWN column shape, not an arbitrary key
--     inside a generic payload).
--   - `current_step` is the `affiliate_onboarding_step` enum (named steps)
--     instead of an int 1..N. The spec lists steps by name; using the
--     enum keeps the URL `?step=` value + the DB value + the Stepper
--     label in lock-step (single source of truth).
--   - `affiliate_id` column reserved for the post-submit link to the
--     `affiliates` row. Nullable in v1 because Slice 1 doesn't create
--     the affiliates row yet (the submit server action lands later).
--
-- **RLS model** (mirrors partner_onboarding_drafts):
--   - affiliate_onboarding_drafts: self_read + self_write + admin_read
--   - handle_reservations:        self_read + self_write + admin_all
--
-- **IDEMPOTENT** — CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- / DROP POLICY IF EXISTS + CREATE POLICY. Safe to re-run against a
-- partially-applied state. The enum uses the `exception when
-- duplicate_object then null $$;` guard pattern.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. New enum: affiliate_onboarding_step (named steps, not ints)
-- ---------------------------------------------------------------------------
-- The enum mirrors the spec's step names exactly so the URL ?step=value,
-- the DB current_step, the Stepper labels, and the Zod schema are all in
-- lock-step. Order matches the wizard left-to-right: welcome →
-- handle_bio → payout → promo_methods → agreement → submit.
do $$ begin
  create type affiliate_onboarding_step as enum (
    'welcome',         -- step 1: copy + "What you'll need" + Start
    'handle_bio',      -- step 2: handle (race-safe reservation) + bio + avatar (later)
    'payout',          -- step 3: paypal_email + confirm
    'promo_methods',   -- step 4: multi-select (informational only)
    'agreement',       -- step 5: TOS + Affiliate Terms + submit gate
    'submit'           -- step 6: read-only summary + "Submit application" button
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. affiliate_onboarding_drafts — one row per user, wizard state + per-step
--    jsonb payloads
-- ---------------------------------------------------------------------------
-- The `submitted_at` column is the wire between the wizard and the admin
-- approval queue (P13.x follow-up / Phase 14). Setting it freezes the
-- draft — the server action refuses further writes (matches the
-- partner_onboarding_drafts contract).
--
-- `affiliate_id` is reserved for the post-submit back-link to the
-- affiliates row (nullable in v1; Slice 2+ populates it on successful
-- submit). We deliberately do NOT FK-enforce it to `affiliates(id)`
-- because the FK would block the draft insert before the affiliates
-- row exists.
create table if not exists affiliate_onboarding_drafts (
  id bigserial primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  -- Wizard state (named enum — mirrors the spec)
  current_step affiliate_onboarding_step not null default 'welcome',
  -- Per-step payloads (shallow-merged per step; each step writes its OWN
  -- column so the merge never clobbers another step's data).
  --
  -- Step 2 (handle_bio):   { handle, bio, avatar_storage_path? }
  -- Step 3 (payout):       { paypal_email, paypal_email_confirm }
  -- Step 4 (promo_methods):{ methods: ['twitter',...], other_text? }
  -- Step 5 (agreement):    { affiliate_terms_accepted, tos_accepted, accepted_at }
  handle_bio jsonb not null default '{}'::jsonb,
  payout jsonb not null default '{}'::jsonb,
  promo_methods jsonb not null default '{}'::jsonb,
  agreement jsonb not null default '{}'::jsonb,
  -- Back-link to the affiliates row once submit lands (nullable; populated
  -- by Slice 2+ when the submit server action runs)
  affiliate_id bigint references affiliates(id) on delete set null,
  -- Submission state — set by the submit server action (Slice 2+).
  -- When NOT null, the wizard is frozen (saveStep refuses further writes).
  submitted_at timestamptz,
  -- Standard bookkeeping
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table affiliate_onboarding_drafts enable row level security;

-- Self read: the user can see their own draft.
drop policy if exists "affiliate_onboarding_drafts_self_read" on affiliate_onboarding_drafts;
create policy "affiliate_onboarding_drafts_self_read" on affiliate_onboarding_drafts
  for select using (user_id = auth.uid());

-- Self write: the user can save + (eventually) submit their own draft.
-- Defense in depth: the server action never accepts a user_id from the
-- wire (it's always derived from the session via
-- getServerSupabase().auth.getUser()). The policy's WITH CHECK is the
-- second gate — even a forged client payload cannot target another
-- user's row.
drop policy if exists "affiliate_onboarding_drafts_self_write" on affiliate_onboarding_drafts;
create policy "affiliate_onboarding_drafts_self_write" on affiliate_onboarding_drafts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin read: the admin can see all drafts (for the approval queue +
-- decision audits). Slice 2+ writes the admin decision columns.
drop policy if exists "affiliate_onboarding_drafts_admin_read" on affiliate_onboarding_drafts;
create policy "affiliate_onboarding_drafts_admin_read" on affiliate_onboarding_drafts
  for select using (is_admin());

-- Index for the admin queue (submitted, oldest first). The query is
-- "all submitted drafts, oldest first".
create index if not exists affiliate_onboarding_drafts_submitted_idx
  on affiliate_onboarding_drafts (submitted_at asc)
  where submitted_at is not null;

-- Explicit per-user index (the UNIQUE on user_id already covers
-- point lookups; this is for query-planner clarity).
create index if not exists affiliate_onboarding_drafts_user_idx
  on affiliate_onboarding_drafts (user_id);

-- updated_at trigger (consistent with the rest of the schema)
drop trigger if exists affiliate_onboarding_drafts_set_updated_at on affiliate_onboarding_drafts;
create trigger affiliate_onboarding_drafts_set_updated_at before update on affiliate_onboarding_drafts
for each row execute function set_updated_at();

comment on table affiliate_onboarding_drafts is
  'P13.1 — Affiliate onboarding wizard draft. One row per user_id (UNIQUE). Per-step jsonb columns (handle_bio / payout / promo_methods / agreement) match the spec exactly; each step writes its OWN column so the merge never clobbers another step''s data. current_step is the named affiliate_onboarding_step enum (single source of truth for step labels + URL ?step= values). The submitted_at column freezes the wizard on submit (Slice 2+). The affiliate_id back-link is nullable in v1; populated when the submit server action lands.';
comment on column affiliate_onboarding_drafts.handle_bio is
  'Step 2 payload. Shape: { handle: string, bio?: string, avatar_storage_path?: string }. The handle is reserved on save via handle_reservations (race-safe); avatar upload is a P13.x follow-up.';
comment on column affiliate_onboarding_drafts.payout is
  'Step 3 payload. Shape: { paypal_email: string, paypal_email_confirm: string }. Encryption-at-rest of paypal_email mirrors the partner payout_method pattern (Slice 2+ wires the encryption helper).';
comment on column affiliate_onboarding_drafts.promo_methods is
  'Step 4 payload. Shape: { methods: (''twitter''|''youtube''|''blog''|''email_list''|''tiktok''|''linkedin''|''other'')[], other_text?: string }. Informational only — no validation that at least one is checked.';
comment on column affiliate_onboarding_drafts.agreement is
  'Step 5 payload. Shape: { affiliate_terms_accepted: boolean, tos_accepted: boolean, accepted_at?: string }. Both must be true to enable the Submit button on step 6.';

-- ---------------------------------------------------------------------------
-- 3. handle_reservations — race-safe handle uniqueness during affiliate
--    onboarding (per spec §"handle_reservations — race-safe handle
--    uniqueness")
-- ---------------------------------------------------------------------------
-- The PRIMARY KEY on `handle` is the race-safety arbiter: two concurrent
-- users picking the same handle race in the DB; exactly one INSERT
-- succeeds, the other gets a unique-violation (Postgres SQLSTATE 23505).
-- The saveStep server action catches the 23505 and returns
-- { handleConflict: true } to the client.
--
-- The 7-day TTL is enforced by a janitor cron (`04-platform/ci/scripts/
-- cron/cleanup-handle-reservations.ts`) — STUB-103. The cron is
-- deliberately NOT shipped in Slice 1; the migration's data shape is
-- ready when the cron lands.
--
-- Lowercased on insert (the wizard UI normalizes before the call).
-- `created_at` is the TTL anchor (oldest first sweep by the cron).
create table if not exists handle_reservations (
  handle text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_id bigint not null references affiliate_onboarding_drafts(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Lasts at most 7 days; cron (STUB-103) sweeps expired rows.
  expires_at timestamptz not null default (now() + interval '7 days')
);

-- Lookup indexes (the PRIMARY KEY on handle already covers point lookups)
create index if not exists handle_reservations_user_idx
  on handle_reservations (user_id);
create index if not exists handle_reservations_expires_idx
  on handle_reservations (expires_at);

alter table handle_reservations enable row level security;

-- Self read: the user can see their own reservations (for the wizard's
-- "you've already reserved X" UX + admin support queries).
drop policy if exists "handle_reservations_self_read" on handle_reservations;
create policy "handle_reservations_self_read" on handle_reservations
  for select using (user_id = auth.uid());

-- Self write: the user can INSERT/DELETE their own reservation.
-- Note: this is a write-only policy — it allows ALL operations
-- (insert + delete + update) on rows where user_id = auth.uid().
-- The saveStep server action INSERTs the reservation inside the same
-- transaction as the draft upsert; the eventual submit server action
-- DELETEs the reservation after the affiliates row is created.
-- The application layer is responsible for ONLY calling INSERT
-- (cron janitor + submit server action are the only DELETE callers
-- in v1).
drop policy if exists "handle_reservations_self_write" on handle_reservations;
create policy "handle_reservations_self_write" on handle_reservations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin all: admin can clean up stuck reservations.
drop policy if exists "handle_reservations_admin_all" on handle_reservations;
create policy "handle_reservations_admin_all" on handle_reservations
  for all using (is_admin());

comment on table handle_reservations is
  'P13.1 — Race-safe handle uniqueness during affiliate onboarding. PRIMARY KEY on handle is the race-safety arbiter (two concurrent users picking the same handle race; exactly one INSERT succeeds, the other gets SQLSTATE 23505 which the saveStep action maps to { handleConflict: true }). 7-day TTL via expires_at + cron janitor (STUB-103). On successful submit, the reservation is transferred: in one transaction, INSERT into affiliates (with the handle) + DELETE from handle_reservations — the affiliates.handle UNIQUE then becomes the long-lived arbiter.';

comment on column handle_reservations.expires_at is
  'Reservation TTL. Default 7 days from creation. Swept by the cron (STUB-103) — abandoned wizard users lose their handle hold after a week and must re-pick on return.';

-- ---------------------------------------------------------------------------
-- STUB REGISTER
-- ---------------------------------------------------------------------------
-- STUB-103 — P13.1 affiliate onboarding wizard foundation. Migration 0045
-- ships the wizard's draft table + the handle_reservations table + RLS +
-- indexes + the affiliate_onboarding_step enum. The Slice 1 surface
-- (/affiliate/onboarding route shell + stepper + WelcomeStep + HandleBioStep
-- + PendingReview + StepPlaceholder for steps 3-6) reads from these
-- tables; the submit server action lands in Slice 2+ (creates the
-- affiliates row, transfers the reservation, enqueues the 2 emails).
-- The 7-day janitor cron lands separately as STUB-103a.