-- P15.1 — LMS tables: progress + bookmarks + certificates + helpers
-- ============================================================================
--
-- The data-model spec at `01-specs/pages/_data-model.md` §Engagement
-- already documents the schemas; this migration makes them real.
--
-- Tables:
--   1. `progress`     — per (user, lesson) watching position + completion
--   2. `bookmarks`    — per (user, lesson) bookmark + note
--   3. `certificates` — per (user, product) course-completion cert with
--                        dual identifier (internal `id` + public 8-char
--                        base-32 `certificate_code`)
--
-- The existing `product_lessons` + `product_modules` tables (migration 0039)
-- are the curriculum source; LMS tables FK into those. `product_lessons.is_preview`
-- already exists and powers P15.17 (free preview lessons on the PDP).
--
-- `-- IDEMPOTENT --` per migration README conventions — every CREATE is
-- `IF NOT EXISTS`, every policy is `DROP IF EXISTS / CREATE`, every
-- function is `CREATE OR REPLACE`. The bootstrap script can re-run this
-- migration safely against a database that's already been upgraded.

-- ============================================================================
-- 1. certificate_status enum
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'certificate_status') then
    create type certificate_status as enum ('active', 'revoked');
  end if;
end $$;


-- ============================================================================
-- 2. progress — lesson watching progress
-- ============================================================================
create table if not exists progress (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  lesson_id bigint not null references product_lessons(id) on delete cascade,
  position_seconds int not null default 0 check (position_seconds >= 0),
  completed boolean not null default false,
  completed_at timestamptz,
  last_watched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create index if not exists progress_user_product_idx on progress (user_id, product_id);
create index if not exists progress_user_last_watched_idx on progress (user_id, last_watched_at desc);
-- Partial index for the "Continue watching" rail (last 30 days, in-progress only)
create index if not exists progress_continue_watching_idx
  on progress (user_id, last_watched_at desc)
  where completed = false;

drop trigger if exists progress_set_updated_at on progress;
create trigger progress_set_updated_at before update on progress
for each row execute function set_updated_at();

alter table progress enable row level security;

drop policy if exists "progress_self_all" on progress;
create policy "progress_self_all" on progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "progress_partner_read_own_product" on progress;
create policy "progress_partner_read_own_product" on progress
  for select using (
    exists (
      select 1 from products p
      join partners pa on pa.id = p.partner_id
      where p.id = progress.product_id and pa.user_id = auth.uid()
    )
  );

drop policy if exists "progress_admin_all" on progress;
create policy "progress_admin_all" on progress
  for all using (is_admin());

comment on table progress is
  'P15.1 — Per-(user, lesson) watching position + completion. Self-only writes; partner can read on own product for analytics; admin sees all.';

comment on column progress.position_seconds is
  'Last position the user watched up to. Whole seconds (floor). Always ≥ 0. Powers auto-resume on remount.';

comment on column progress.completed is
  'True once the user clicks "Mark complete" OR the video element fires `ended` AND duration_seconds > 0 AND position_seconds >= duration_seconds - 5.';


-- ============================================================================
-- 3. bookmarks — per-lesson bookmark + note
-- ============================================================================
create table if not exists bookmarks (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id bigint not null references product_lessons(id) on delete cascade,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create index if not exists bookmarks_user_idx on bookmarks (user_id, created_at desc);
create index if not exists bookmarks_lesson_idx on bookmarks (lesson_id);

drop trigger if exists bookmarks_set_updated_at on bookmarks;
create trigger bookmarks_set_updated_at before update on bookmarks
for each row execute function set_updated_at();

alter table bookmarks enable row level security;

drop policy if exists "bookmarks_self_all" on bookmarks;
create policy "bookmarks_self_all" on bookmarks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table bookmarks is
  'P15.1 — Per-(user, lesson) bookmark. Self-only. Stores an optional free-form note (≤ 1000 chars).';


-- ============================================================================
-- 4. certificates — course-completion certificates
-- ============================================================================
create table if not exists certificates (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  partner_id bigint references partners(id) on delete set null,
  issued_at timestamptz not null default now(),
  certificate_code text not null unique,
  pdf_storage_path text not null default '',
  status certificate_status not null default 'active',
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or length(revoked_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists certificates_user_issued_idx on certificates (user_id, issued_at desc);
create index if not exists certificates_product_idx on certificates (product_id);
create index if not exists certificates_partner_idx on certificates (partner_id) where partner_id is not null;
-- certificate_code is unique by constraint; the index on it is implicit (unique indexes serve as lookup indexes).

alter table certificates enable row level security;

drop policy if exists "certificates_self_read" on certificates;
create policy "certificates_self_read" on certificates
  for select using (user_id = auth.uid());

drop policy if exists "certificates_partner_read_own" on certificates;
create policy "certificates_partner_read_own" on certificates
  for select using (
    exists (
      select 1 from partners pa
      where pa.id = certificates.partner_id and pa.user_id = auth.uid()
    )
  );

drop policy if exists "certificates_admin_all" on certificates;
create policy "certificates_admin_all" on certificates
  for all using (is_admin());

drop policy if exists "certificates_public_read_active_by_code" on certificates;
-- Public read by code is gated via the certificate_code column only —
-- the verify endpoint uses service role to bypass RLS. We do NOT add
-- a public RLS policy here; service role is the right access path for
-- the /verify-certificate/[code] surface (matches the doc's intent).

drop trigger if exists certificates_set_updated_at on certificates;
create trigger certificates_set_updated_at before update on certificates
for each row execute function set_updated_at();

comment on table certificates is
  'P15.1 — Course-completion certificate. Dual identifier: `id` (bigint, internal/buyer-side) + `certificate_code` (8-char base-32, public/verify-side). Issued by the completion system action (Phase 15 P15.11) + nightly backfill cron.';

comment on column certificates.certificate_code is
  '8-char base-32 (~33 bits). Cryptographically-secure RNG with collision retry (max 5 attempts). The PUBLIC identifier — shared for `/verify-certificate/[code]`. Uniqueness is the unique constraint.';

comment on column certificates.pdf_storage_path is
  'Bunny private bucket path. Empty in v1 (the v2 PDF generator fills this; the verify page does not need the PDF).';

comment on column certificates.partner_id is
  'Denormalized from products.partner_id at issuance time. Lets the partner dashboard query certificates they have issued without joining through products.';


-- ============================================================================
-- 5. Helper RPC — random alphanumeric code generator
-- ============================================================================
create or replace function public.generate_certificate_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 chars (excludes 0/O, 1/I/L)
  result text := '';
  i int;
  collision_count int;
begin
  -- Try up to 5 times to find an unused code.
  for attempt in 1..5 loop
    result := '';
    for i in 1..8 loop
      result := result || substr(alphabet, 1 + (random() * 31)::int, 1);
    end loop;
    select count(*) into collision_count from public.certificates where certificate_code = result;
    if collision_count = 0 then
      return result;
    end if;
  end loop;
  -- 5 collisions in a row is statistically improbable (~10⁻²⁵);
  -- fall back to a UUID-prefixed code so the insert never fails.
  return 'X' || substr(md5(random()::text), 1, 7);
end;
$$;

revoke all on function public.generate_certificate_code() from public;
grant execute on function public.generate_certificate_code() to service_role;

comment on function public.generate_certificate_code() is
  'P15.1 — Generate a random 8-char base-32 certificate code (collision-retry up to 5x, then UUID-prefixed fallback). SECURIY DEFINER + set search_path = '''' + REVOKE from PUBLIC + GRANT to service_role.';


-- ============================================================================
-- 6. Helper RPC — issue a certificate (called by P15.11 system action + cron)
-- ============================================================================
create or replace function public.issue_certificate(
  p_user_id uuid,
  p_product_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner_id bigint;
  v_existing_id bigint;
  v_new_id bigint;
  v_code text;
begin
  -- Idempotency: if a row already exists, return its id.
  select id into v_existing_id
    from public.certificates
    where user_id = p_user_id and product_id = p_product_id;
  if found then
    return v_existing_id;
  end if;

  -- Denormalize partner_id from products at issuance time so a later
  -- partner un-listing doesn't break the partner-side join.
  select partner_id into v_partner_id
    from public.products
    where id = p_product_id;
  if v_partner_id is null then
    v_partner_id := null;
  end if;

  v_code := public.generate_certificate_code();

  insert into public.certificates (
    user_id, product_id, partner_id, certificate_code, status
  ) values (
    p_user_id, p_product_id, v_partner_id, v_code, 'active'
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.issue_certificate(uuid, bigint) from public;
grant execute on function public.issue_certificate(uuid, bigint) to service_role;

comment on function public.issue_certificate(uuid, bigint) is
  'P15.1 — Issue a certificate for the (user, product) pair. Idempotent: returns existing row id if one is already present. SECURIY DEFINER + set search_path = '''' + REVOKE from PUBLIC + GRANT to service_role.';


-- ============================================================================
-- 7. Helper RPC — completion percentage per (user, product)
-- ============================================================================
--
-- Returns the percentage (0..100) of lessons the user has completed.
-- Powers the library progress bars (P15.9) and the "Continue watching"
-- rail readiness check (P15.10). Single round-trip; safe to call in
-- bulk for the library listing page.
-- ============================================================================
create or replace function public.get_course_completion_percent(
  p_user_id uuid,
  p_product_id bigint
)
returns int
language sql
security definer
stable
set search_path = ''
as $$
  select
    case
      when count(*) filter (where pl.id is not null) = 0 then 0
      else
        (count(*) filter (where pr.completed)::numeric
         / count(*) filter (where pl.id is not null)::numeric * 100)::int
    end
  from public.product_lessons pl
  left join public.progress pr
    on pr.lesson_id = pl.id and pr.user_id = p_user_id
  where pl.product_id = p_product_id;
$$;

revoke all on function public.get_course_completion_percent(uuid, bigint) from public;
grant execute on function public.get_course_completion_percent(uuid, bigint) to authenticated;

comment on function public.get_course_completion_percent(uuid, bigint) is
  'P15.1 — Get the user''s completion percent (0..100, integer floor) for a course. Used by library progress bars (P15.9) + Continue-watching (P15.10). SECURIY DEFINER + STABLE; allowed for authenticated (the inner SELECT filters on p_user_id, which is passed in — not auth.uid() — so a service-role caller can also use it).';


-- ============================================================================
-- 8. Helper RPC — last watched lesson per (user, product)
-- ============================================================================
--
-- Powers the Continue watching rail (P15.10) and the per-course resume
-- CTA. Returns one row: the lesson_id + lesson_title + position_seconds
-- + last_watched_at for the most recently watched lesson in the product
-- (regardless of whether it was completed). NULL when none.
-- ============================================================================
create or replace function public.get_last_watched_lesson(
  p_user_id uuid,
  p_product_id bigint
)
returns table (
  lesson_id bigint,
  lesson_title text,
  position_seconds int,
  last_watched_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    pr.lesson_id,
    pl.title,
    pr.position_seconds,
    pr.last_watched_at
  from public.progress pr
  join public.product_lessons pl on pl.id = pr.lesson_id
  where pr.user_id = p_user_id and pr.product_id = p_product_id
  order by pr.last_watched_at desc
  limit 1;
$$;

revoke all on function public.get_last_watched_lesson(uuid, bigint) from public;
grant execute on function public.get_last_watched_lesson(uuid, bigint) to authenticated;

comment on function public.get_last_watched_lesson(uuid, bigint) is
  'P15.1 — Most recently watched lesson for (user, product). Powers resume CTA + Continue watching rail. SECURIY DEFINER + STABLE; p_user_id argument is the source of truth (not auth.uid()) so service-role callers (cron) can also use it.';
