-- ---------------------------------------------------------------------------
-- 0017_auth_failed_attempts.sql — rate-limit counters for login (P1.2)
-- ---------------------------------------------------------------------------
-- Track failed sign-in attempts per-IP and per-email so the auth action
-- can enforce the spec's "max 5 failed per email per 15 min" + "max 20
-- failed per IP per 15 min" limits without holding state in memory (which
-- doesn't survive multi-instance deploys). The signup action also reads
-- this table for per-IP throttling on the IP-edge rate limit (STUB-038).
--
-- Schema notes:
--   - We store each ATTEMPT (not just a counter) because:
--       (a) the table doubles as an audit trail the admin can review
--           (the admin_audit_log table requires auth.users.id as FK and
--           pre-signup / pre-signin users have no row there),
--       (b) the 15-min window is a sliding one — recomputing "how many
--           attempts in the last 15 minutes" against a raw event log is
--           O(few rows) per query and correct at any cutoff,
--       (c) a counter would need periodic GC; an event log needs only
--           "delete rows older than the longest window" (we keep 24h to
--           cover the 15-min window + admin review).
--   - `kind` lets us extend the table to other auth events (signup,
--     password-reset) later without schema changes.
--   - `email_hash` + `ip_hash` are SHA-256 with the AUDIT_HASH_SALT env
--     (PII-safe storage; admins with the salt can recover the raw value
--     for abuse investigation).
--   - The table is INSERT-only from the auth action (anonymous callers
--     can read ONLY the count, not the rows themselves, so the response
--     can't leak per-attempt metadata).
--   - Indexes are tuned for the two read paths the rate-limit helper
--     hits on every login attempt:
--       (a) "rows in the last 15 minutes where email_hash = X" — covered
--           by auth_failed_attempts_email_window_idx.
--       (b) "rows in the last 15 minutes where ip_hash = Y" — covered
--           by auth_failed_attempts_ip_window_idx.
--   - GC: the application deletes rows older than 24h on a best-effort
--     basis (the helper does this lazily — every Nth call, or when a
--     lockout triggers). This keeps the table small (~5 MB per 100k
--     attempts) without a separate cron job.
--
-- RLS:
--   - No `auth_failed_attempts_self_*` policies. Anon and authenticated
--     users can NOT read or write rows directly — only the service-role
--     client (via the rate-limit helper) touches the table.
--   - The `auth_failed_attempts_service_all` policy lets is_admin()
--     read all rows for the future admin audit log UI (P14.18). For now,
--     no UI consumes this; the policy is here for forward compatibility.

create table if not exists auth_failed_attempts (
  id bigserial primary key,
  kind text not null check (kind in ('signin', 'signup', 'reset_password')),
  email_hash text,                     -- nullable: email may be empty/invalid
  ip_hash text,                        -- nullable: header may be absent
  ip_raw text,                         -- retained ONLY for the rate-limit
                                       -- helper's IP-edge "lockout now"
                                       -- response (the client needs to
                                       -- echo its IP for the cooldown
                                       -- display). Stripped at 24h by
                                       -- GC. Hashed PII is the durable
                                       -- record.
  user_agent text,                     -- truncated to 200 chars at insert
  reason text not null check (reason in (
    'invalid_credentials',             -- wrong email/password combo
    'rate_limited',                    -- blocked by the rate limiter
    'email_not_verified',              -- account exists but unverified
    'unknown_user',                    -- email not in the system
    'malformed_input',                 -- Zod / shape failure
    'server_error'                     -- 5xx-equivalent failure
  )),
  created_at timestamptz not null default now()
);

alter table auth_failed_attempts enable row level security;

-- No policies for anon or authenticated. The service-role client
-- bypasses RLS, so the rate-limit helper (which uses
-- `getServiceSupabase()`) can read + insert freely.

drop policy if exists "auth_failed_attempts_admin_read" on auth_failed_attempts;
create policy "auth_failed_attempts_admin_read" on auth_failed_attempts
  for select using (is_admin());

-- Sliding-window read paths. Both indexes are composite with created_at
-- DESC so the planner can do an index-only range scan and the LIMIT is
-- applied before any heap fetch.

create index if not exists auth_failed_attempts_email_window_idx
  on auth_failed_attempts(email_hash, created_at desc)
  where email_hash is not null;

create index if not exists auth_failed_attempts_ip_window_idx
  on auth_failed_attempts(ip_hash, created_at desc)
  where ip_hash is not null;

-- Admin audit-trail index. Less hot than the two above; covers the
-- future P14.18 audit log search UI ("show all failed signins from
-- this IP in the last week").

create index if not exists auth_failed_attempts_kind_time_idx
  on auth_failed_attempts(kind, created_at desc);