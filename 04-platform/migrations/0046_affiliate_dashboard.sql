-- ============================================================================
-- 0046_affiliate_dashboard.sql — P13.3 affiliate dashboard schema foundation.
--
-- Adds the 4 tables the P13.3 dashboard reads from:
--
--   affiliate_links       — one row per affiliate link (v1: one default link
--                           per affiliate; per-product links are v2).
--                           The short `code` is the shareable token used in
--                           the URL `?ref=` parameter.
--
--   affiliate_clicks      — anonymous click-tracking rows. Stores hashed
--                           IP + hashed UA + an optional country/device
--                           classification — never raw IP, never raw UA.
--                           Drives the `clicks_30d` KPI + the future
--                           per-hour / per-geo analytics (P13.7).
--
--   affiliate_commissions — one row per order line attributed to the
--                           affiliate. Status lifecycle mirrors the
--                           partner payout_ledger: pending → locked →
--                           available → paid (or reversed on refund).
--                           Drives the `lifetime_earned` + `this_month`
--                           KPIs + the recent-commissions table + the
--                           top-products rollup.
--
--   affiliate_payouts     — affiliate-side mirror of `payout_requests`.
--                           One row per payout request (requested →
--                           approved → paid / denied). Drives the
--                           payouts page that lands in P13.x.
--
-- Also adds one SECURITY DEFINER helper:
--
--   get_affiliate_summary(p_affiliate_id) — returns the 4 dashboard
--                                           KPIs in one call: lifetime /
--                                           month / clicks_30d /
--                                           conversions_30d / payout-
--                                           method-present flag.
--
-- Plus an idempotent helper:
--
--   ensure_default_affiliate_link(p_affiliate_id) — creates the
--                                                  affiliate's default
--                                                  link (code = handle)
--                                                  if missing. Called
--                                                  from the dashboard
--                                                  page server component
--                                                  on first visit. Idempotent
--                                                  — the second call is a
--                                                  no-op.
--
-- RLS MODEL (mirrors payout_ledger / partner tables):
--   - affiliate_links:        self_read + self_write + admin_all + public_read_code
--   - affiliate_clicks:       self_read_via_link (via the parent link) + admin_all
--                             Writes are service-role only (the click
--                             tracking pipeline runs as the service role
--                             because clicks can arrive pre-authenticated
--                             from the /?ref= landing page).
--   - affiliate_commissions:  self_read + admin_all
--                             Writes are service-role only.
--   - affiliate_payouts:      self_read + admin_all
--                             Writes are service-role only.
--
-- **Why no self_write on clicks/commissions/payouts?**
-- The dashboard's value surface is read-only. Writes happen in two
-- tightly-controlled places: (a) the click trackAction during the /?ref=
-- landing flow (needs to write BEFORE auth knows who the click is for, so
-- no RLS context = must bypass via service role), and (b) admin
-- payout approval (service role). Granting self_write on these tables
-- would expose an attack surface where a logged-in affiliate could
-- inflate their own stats or approve their own payouts.
--
-- **Why public_read_code on affiliate_links?**
-- The /?ref= landing page needs to resolve an `?ref=<code>` cookie /
-- query parameter to an affiliate_id WITHOUT requiring auth (the buyer
-- isn't logged in at click time). The public_read_code policy lets a
-- SELECT on `code, affiliate_id, destination_path, active` resolve the
-- link without exposing commission_pct_bps or other internals. The
-- narrow column list (in the server query) is the second defense.
--
-- **Money columns:** bigint cents. Bigint, not numeric, because the
-- aggregation in `get_affiliate_summary` does SUM() over many rows
-- and the result could exceed JS Number.MAX_SAFE_INTEGER for an
-- established affiliate (1e15 cents = $10 trillion — unlikely but
-- defense-in-depth).
--
-- **IDEMPOTENT:** CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS / DROP POLICY IF EXISTS + CREATE POLICY / CREATE OR REPLACE
-- FUNCTION / CREATE OR REPLACE TRIGGER. Safe to re-run against a
-- partially-applied state.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. affiliate_links — one row per affiliate link
-- ---------------------------------------------------------------------------
-- The `code` column is the shareable token used in `?ref=<code>` URLs.
-- v1 only ships a default link per affiliate (the spec's "one default
-- link per affiliate only — v2 supports per-product links"). The
-- `destination_path` defaults to `/` (the home page) so the link can
-- be promoted as a general-purpose share link.
--
-- Note: the unique on `code` is the heartbeat of the /?ref= resolver
-- (PostgREST: `select code where code = $1 limit 1`). The handle is
-- NOT used as the code directly anymore — keeping the door open for
-- v2 to let affiliates customize their code.
create table if not exists affiliate_links (
  id bigserial primary key,
  affiliate_id bigint not null references affiliates(id) on delete cascade,
  -- Short URL-safe token (6-20 chars: alphanumeric + dashes). The default
  -- link uses the affiliate's handle so existing /?ref=<handle> URLs
  -- continue to resolve.
  code text not null unique,
  -- Where the link lands. Defaults to '/' (home page). Future per-product
  -- links set this to /products/[slug] or /bundles/[slug].
  destination_path text not null default '/',
  -- Optional campaign label for UTM-style attribution (utm_campaign).
  campaign text,
  -- Soft-disable; the click-track endpoint returns 404 for inactive
  -- links so an affiliate can pause a campaign without losing the
  -- history.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table affiliate_links enable row level security;

-- Self read: the affiliate can list their own links.
drop policy if exists "affiliate_links_self_read" on affiliate_links;
create policy "affiliate_links_self_read" on affiliate_links
  for select using (
    affiliate_id = current_affiliate_id()
    or is_admin()
  );

-- Self write: the affiliate can manage their own links (create,
-- disable, re-enable). The dashboard's link generator UI uses this.
-- Service-role writes also land here for any admin/system actions.
drop policy if exists "affiliate_links_self_write" on affiliate_links;
create policy "affiliate_links_self_write" on affiliate_links
  for all using (
    affiliate_id = current_affiliate_id()
    or is_admin()
  ) with check (
    affiliate_id = current_affiliate_id()
    or is_admin()
  );

-- Public code lookup: anonymous /?ref=<code> lookup needs to resolve
-- without auth. Narrow: only `code`, `affiliate_id`, `destination_path`,
-- `active`. Other columns are NEVER returned by the public lookup.
drop policy if exists "affiliate_links_public_read_code" on affiliate_links;
create policy "affiliate_links_public_read_code" on affiliate_links
  for select to anon using (active = true);

-- updated_at trigger (consistent with the rest of the schema).
drop trigger if exists affiliate_links_set_updated_at on affiliate_links;
create trigger affiliate_links_set_updated_at before update on affiliate_links
  for each row execute function set_updated_at();

-- Index: per-affiliate list (the "Manage links" UI).
create index if not exists affiliate_links_affiliate_idx
  on affiliate_links (affiliate_id);
-- Index: active-only filter (the dashboard's "show only active links"
-- toggle + the future active-link admin sweep).
create index if not exists affiliate_links_active_idx
  on affiliate_links (active) where active = true;

comment on table affiliate_links is
  'P13.3 — One row per affiliate link. v1 ships one default link per affiliate (code = handle); per-product links land in v2. The unique on `code` is the heartbeat of the /?ref=<code> resolver (PostgREST: SELECT code WHERE code = $1 LIMIT 1). The anon policy exposes ONLY { code, affiliate_id, destination_path, active } to the public resolver — no commission_pct_bps or other internals.';
comment on column affiliate_links.code is
  'Short URL-safe shareable token (6-20 chars: alphanumeric + dashes). Default link uses the affiliate''s handle so existing /?ref=<handle> URLs continue to resolve (back-compat with v0 share URLs).';
comment on column affiliate_links.destination_path is
  'Path the link redirects to. Default ''/'' (home page). Future per-product links set to /products/[slug].';
comment on column affiliate_links.campaign is
  'Optional utm_campaign-style label for grouping clicks + commissions in analytics. Free-form text.';
comment on column affiliate_links.active is
  'Soft-disable toggle. When false, the /?ref=<code> resolver returns 404 (no click row written). The history is preserved.';

-- ---------------------------------------------------------------------------
-- 2. affiliate_clicks — anonymous click-tracking rows
-- ---------------------------------------------------------------------------
-- The spec ("Clicks are logged with IP hash + UA hash. Patterns (e.g.
-- > 100 clicks from same IP in 1h) are flagged for review") is the
-- authoritative contract. We NEVER store raw IP or raw user-agent —
-- only their hashes. The `ip_hash` is FNV-1a 32-bit hex (8 chars);
-- the `user_agent_hash` is the same scheme. Both are PII-safe for
-- log + DB storage.
--
-- The optional `country` / `device_class` columns are populated by the
-- click trackAction via an in-process geo lookup (or skipped if the
-- enrichment is not configured). They default to NULL so the v1
-- implementation that ships without geo doesn't have to backfill.
--
-- `landing_path` captures the URL the click landed on so the
-- affiliate can see which pages sent them traffic (the cookie track
-- happens before the user's first navigation, so this is the first
-- path).
--
-- Writes are service-role only — see the policy rationale at the
-- top of this file.
create table if not exists affiliate_clicks (
  id bigserial primary key,
  link_id bigint not null references affiliate_links(id) on delete cascade,
  -- Event timestamp. Indexed so the "clicks in last 30 days" KPI
  -- can be answered from the index (no row scan).
  at timestamptz not null default now(),
  -- Hashed IP. Never raw. 32-bit FNV-1a hex (8 chars).
  ip_hash text,
  -- Hashed user-agent. Never raw.
  user_agent_hash text,
  -- Optional referer (full URL; not PII because it's the public
  -- referer the browser sent).
  referer text,
  -- Page the click landed on (the first path after the redirect from
  -- /?ref=<code>). Populated by the click trackAction; NULL if
  -- unknown.
  landing_path text,
  -- Optional geo from IP (country code, e.g. 'US'). NULL when geo
  -- lookup isn't configured.
  country text,
  -- Optional device class ('mobile' | 'desktop' | 'tablet' | 'bot').
  -- NULL when classification isn't configured.
  device_class text
);

alter table affiliate_clicks enable row level security;

-- Self read: the affiliate can read clicks for their own links.
-- (The policy join uses link's affiliate_id — current_affiliate_id()
-- is the auth.uid()-based lookup; the check happens via the foreign
-- key in the query itself.)
drop policy if exists "affiliate_clicks_self_read" on affiliate_clicks;
create policy "affiliate_clicks_self_read" on affiliate_clicks
  for select using (
    is_admin()
    or exists (
      select 1 from affiliate_links al
      where al.id = affiliate_clicks.link_id
        and al.affiliate_id = current_affiliate_id()
    )
  );

-- Admin all.
drop policy if exists "affiliate_clicks_admin_all" on affiliate_clicks;
create policy "affiliate_clicks_admin_all" on affiliate_clicks
  for all using (is_admin()) with check (is_admin());

-- Index: per-link click stream (the future link-detail analytics page).
create index if not exists affiliate_clicks_link_at_idx
  on affiliate_clicks (link_id, at desc);
-- Index: global time-window queries (the "clicks in last 30 days"
-- KPI + the fraud-detection hourly sweep).
create index if not exists affiliate_clicks_at_idx
  on affiliate_clicks (at desc);
-- Index: fraud-detection IP burst scan.
create index if not exists affiliate_clicks_ip_hash_at_idx
  on affiliate_clicks (ip_hash, at desc)
  where ip_hash is not null;

comment on table affiliate_clicks is
  'P13.3 — Anonymous click tracking. ONE row per click of /?ref=<code>. Stores hashed IP + UA only (never raw). country / device_class are optional enrichment fields (NULL if geo/device lookup isn''t configured). Writes are service-role only (the click trackAction runs pre-authenticated during the /?ref= landing flow). Self read joins via the parent affiliate_links row (the policy asserts link.affiliate_id = current_affiliate_id()). Indexes cover: per-link time stream, global time-window KPI scan, fraud-detection IP burst scan.';

-- ---------------------------------------------------------------------------
-- 3. affiliate_commissions — one row per attributed order line
-- ---------------------------------------------------------------------------
-- Status lifecycle (mirrors payout_ledger):
--   pending    → order placed, commission row created
--   locked     → refund window closed (typically 14d for digital PLR/MRR)
--   available  → unlocked for payout request
--   paid       → payout_batch_commission row matched; commission sum
--                  cleared via the matching payout debit
--   reversed   → refund hit after the commission was already paid; the
--                  row decrements the affiliate's lifetime
--
-- `locked_until` + `available_at` mirror the partner
-- payout_ledger.locked_until / available_at convention so the dashboard
-- can use a single set of helpers across both surfaces.
--
-- The optional `order_id` / `order_item_id` FK allows linking the
-- commission back to the source order. NULL for manual adjustments
-- (e.g. an admin corrections entry).
create table if not exists affiliate_commissions (
  id bigserial primary key,
  affiliate_id bigint not null references affiliates(id) on delete cascade,
  order_id bigint references orders(id) on delete set null,
  order_item_id bigint references order_items(id) on delete set null,
  product_id bigint references products(id) on delete set null,
  -- Commissioned sale amount in cents (the order line's subtotal that
  -- the commission is computed against).
  sale_cents bigint not null,
  -- Commission amount in cents (sale_cents × commission_pct_bps / 10000).
  commission_cents bigint not null,
  -- Snapshot of the commission percentage at sale time (so future
  -- per-affiliate override changes don't retroactively change past
  -- commissions).
  commission_pct_bps int not null check (
    commission_pct_bps >= 0 and commission_pct_bps <= 10000
  ),
  currency text not null default 'USD',
  status text not null check (
    status in ('pending', 'locked', 'available', 'paid', 'reversed')
  ) default 'pending',
  created_at timestamptz not null default now(),
  locked_until timestamptz,
  available_at timestamptz,
  paid_at timestamptz,
  reversed_at timestamptz,
  -- Description for the recent-commissions table (e.g. "Order #12345
  -- — Course XYZ"). Free-form; typically populated from the order +
  -- product join at insert time.
  description text
);

alter table affiliate_commissions enable row level security;

-- Self read: the affiliate can read their own commission rows.
drop policy if exists "affiliate_commissions_self_read" on affiliate_commissions;
create policy "affiliate_commissions_self_read" on affiliate_commissions
  for select using (
    affiliate_id = current_affiliate_id()
    or is_admin()
  );

-- Admin all.
drop policy if exists "affiliate_commissions_admin_all" on affiliate_commissions;
create policy "affiliate_commissions_admin_all" on affiliate_commissions
  for all using (is_admin()) with check (is_admin());

-- Index: per-affiliate recent commissions table (newest first).
create index if not exists affiliate_commissions_affiliate_created_idx
  on affiliate_commissions (affiliate_id, created_at desc);
-- Index: status filter (the "show only available" toggle + the
-- sweep that promotes pending → available when locked_until passes).
create index if not exists affiliate_commissions_status_idx
  on affiliate_commissions (status);
-- Index: per-product rollup for the top-products section
-- (EPC = sum(commission_cents) / count(clicks) for this product).
create index if not exists affiliate_commissions_product_idx
  on affiliate_commissions (product_id)
  where product_id is not null;
-- Index: locked-until sweep (background job that flips pending → locked
-- when refund window closes).
create index if not exists affiliate_commissions_locked_until_idx
  on affiliate_commissions (locked_until)
  where locked_until is not null and status = 'pending';

comment on table affiliate_commissions is
  'P13.3 — One row per attributed order line. Status lifecycle: pending → locked → available → paid (or reversed on refund). The commission_pct_bps snapshot is immutable so future per-affiliate override changes don''t retroactively change past commissions. Self read = affiliate reads their own rows; writes are service-role only (the order webhook creates rows, the refund + payout pipelines mutate them). Indexes cover the dashboard''s three read paths: per-affiliate recent commissions, status filter, per-product EPC rollup, locked-until sweep.';
comment on column affiliate_commissions.locked_until is
  'Refund-window close date. NULL until calculated. Status flips to ''locked'' when now() > locked_until.';
comment on column affiliate_commissions.available_at is
  'When the commission becomes available for payout request. NULL until calculated (today: locked_until + 0 = locked_until).';
comment on column affiliate_commissions.commission_pct_bps is
  'Snapshot of the affiliate''s commission percentage at sale time. Immutable.';

-- ---------------------------------------------------------------------------
-- 4. affiliate_payouts — one row per payout request
-- ---------------------------------------------------------------------------
-- Status lifecycle:
--   requested → affiliate clicked "Request payout" with available
--                balance ≥ MIN threshold
--   approved  → admin approved the request
--   paid      → PayPal Mass Payout (or v2 Stripe Connect) fired the
--                wire transfer (the paypal_batch_id is populated)
--   denied    → admin denied the request (denial_reason required)
--   failed    → PayPal/Stripe transfer failed (after approval)
--
-- The `method` is restricted to 'paypal' in v1. The Stripe Connect
-- path lands in P12.15 Slice 2 once STUB-053 (Stripe creds in
-- Doppler) is resolved.
create table if not exists affiliate_payouts (
  id bigserial primary key,
  affiliate_id bigint not null references affiliates(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD',
  method text not null check (method in ('paypal')) default 'paypal',
  status text not null check (
    status in ('requested', 'approved', 'paid', 'denied', 'failed')
  ) default 'requested',
  -- PayPal Mass Payout batch id (populated by the batch-execution step;
  -- matches payout_ledger.paypal_payout_batch_id convention).
  paypal_batch_id text,
  -- Required when status='denied'. Free-form reason logged to the audit
  -- row + emailed to the affiliate.
  denial_reason text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by_user_id uuid references auth.users(id),
  paid_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table affiliate_payouts enable row level security;

-- Self read: the affiliate can read their own payouts.
drop policy if exists "affiliate_payouts_self_read" on affiliate_payouts;
create policy "affiliate_payouts_self_read" on affiliate_payouts
  for select using (
    affiliate_id = current_affiliate_id()
    or is_admin()
  );

-- Admin all.
drop policy if exists "affiliate_payouts_admin_all" on affiliate_payouts;
create policy "affiliate_payouts_admin_all" on affiliate_payouts
  for all using (is_admin()) with check (is_admin());

-- updated_at trigger.
drop trigger if exists affiliate_payouts_set_updated_at on affiliate_payouts;
create trigger affiliate_payouts_set_updated_at before update on affiliate_payouts
  for each row execute function set_updated_at();

-- Index: per-affiliate recent payouts.
create index if not exists affiliate_payouts_affiliate_requested_idx
  on affiliate_payouts (affiliate_id, requested_at desc);
-- Index: status filter for the admin payouts queue (mirrors
-- payout_requests_status_idx shape).
create index if not exists affiliate_payouts_status_idx
  on affiliate_payouts (status);

comment on table affiliate_payouts is
  'P13.3 — Affiliate payout requests, one row per payout. Status lifecycle: requested → approved → paid (or denied). Writes are admin / service-role only. The `method` column is locked to ''paypal'' in v1 (Stripe Connect lands in P12.15 / P13.x when Stripe creds land via STUB-053). paypal_batch_id matches the payout_ledger.paypal_payout_batch_id convention so the merchant-side reconciliation can match partner + affiliate payouts back to a single PayPal Mass Payout event.';

-- ---------------------------------------------------------------------------
-- 5. get_affiliate_summary(p_affiliate_id) — KPI aggregator
-- ---------------------------------------------------------------------------
-- Returns the 4 KPI cards the P13.3 dashboard renders, in a single
-- SECURITY DEFINER call (avoids 4 round-trips). Authorization:
-- caller must be the affiliate (current_affiliate_id() match) OR an
-- admin. Unauthorized callers get zero rows.
--
-- Output columns:
--   lifetime_earned_cents         — sum of commission_cents over ALL
--                                   non-reversed commission rows
--   month_earned_cents            — sum of commission_cents since
--                                   start-of-current-month (server tz)
--   clicks_30d_count              — count(*) over affiliate_clicks for
--                                   this affiliate's links where
--                                   at > now() - interval '30 days'
--   conversions_30d_count         — count of commission rows created
--                                   in the last 30 days (NOT including
--                                   reversed). "Conversion" definition
--                                   (commission row created) matches
--                                   the spec Open Question
--                                   §"Multi-affiliate attribution":
--                                   "last-click attribution (affiliate
--                                   B gets the commission if buyer
--                                   clicks both A then B)."
--   payout_method_present         — boolean; true if affiliates.payout_method
--                                   is not null
--
-- The "this_month" boundary uses timezone-naive date_trunc('month',
-- now()). For multi-currency affiliates the result is summed in the
-- row's own currency (NOT normalized to USD) — the dashboard renders
-- the raw cents and the affiliate's currency.
--
-- STABLE — memoizable by the planner inside a SELECT.
create or replace function public.get_affiliate_summary(
  p_affiliate_id bigint
)
returns table (
  lifetime_earned_cents   bigint,
  month_earned_cents      bigint,
  clicks_30d_count        bigint,
  conversions_30d_count   bigint,
  payout_method_present   boolean
)
language sql
stable
security definer
set search_path = 'public'
as $$
  select
    coalesce(
      (select sum(commission_cents)
         from affiliate_commissions
         where affiliate_id = p_affiliate_id
           and status <> 'reversed'),
      0
    )::bigint                                                                  as lifetime_earned_cents,
    coalesce(
      (select sum(commission_cents)
         from affiliate_commissions
         where affiliate_id = p_affiliate_id
           and status <> 'reversed'
           and created_at >= date_trunc('month', now())),
      0
    )::bigint                                                                  as month_earned_cents,
    coalesce(
      (select count(*)
         from affiliate_clicks c
         join affiliate_links l on l.id = c.link_id
         where l.affiliate_id = p_affiliate_id
           and c.at > now() - interval '30 days'),
      0
    )::bigint                                                                  as clicks_30d_count,
    coalesce(
      (select count(*)
         from affiliate_commissions
         where affiliate_id = p_affiliate_id
           and status <> 'reversed'
           and created_at > now() - interval '30 days'),
      0
    )::bigint                                                                  as conversions_30d_count,
    coalesce(
      (select payout_method is not null
         from affiliates
         where id = p_affiliate_id),
      false
    )                                                                          as payout_method_present
  where p_affiliate_id = current_affiliate_id() or is_admin();
$$;

grant execute on function public.get_affiliate_summary(bigint) to authenticated;

comment on function public.get_affiliate_summary(bigint) is
  'P13.3 — Affiliate dashboard KPI aggregator. Returns (lifetime_earned_cents, month_earned_cents, clicks_30d_count, conversions_30d_count, payout_method_present). Authorization: caller must be the affiliate (current_affiliate_id() matches p_affiliate_id) OR an admin (is_admin()); unauthorized callers receive a single zero-row result. STABLE — memoizable by the planner inside a SELECT. The "this_month" boundary uses timezone-naive date_trunc(''month'', now()); future multi-currency affiliates should pass an explicit `reference_currency` parameter (v2).';

-- ---------------------------------------------------------------------------
-- 6. ensure_default_affiliate_link(p_affiliate_id) — idempotent default-link creator
-- ---------------------------------------------------------------------------
-- The spec mandates "one default link per affiliate; v2 supports per-
-- product links." The dashboard needs the link's `code` to render the
-- affiliate-link hero card. Rather than threading default-link creation
-- through every code path that creates an `affiliates` row, this
-- helper creates the default link ON DEMAND the first time the
-- affiliate visits the dashboard.
--
-- Idempotent: if a link with `code = handle` already exists for the
-- affiliate, the function is a no-op. If the handle has changed since
-- the link was created, the link's code is NOT auto-updated (the
-- code is the shareable URL token; changing it would break in-the-
-- wild URLs).
--
-- Authorization: SECURITY DEFINER. The caller must be the affiliate
-- whose default link is being ensured OR an admin. Unauthorized
-- callers get NULL.
--
-- Returns: the affiliate_links row (id, code, destination_path,
-- affiliate_id) as JSON. The dashboard server component extracts the
-- code from this object for the hero card.
create or replace function public.ensure_default_affiliate_link(
  p_affiliate_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_affiliate    affiliates%rowtype;
  v_existing_id  bigint;
  v_link_id      bigint;
  v_handle       text;
begin
  -- Authorization: caller is the affiliate or admin.
  if not (p_affiliate_id = current_affiliate_id() or is_admin()) then
    return null;
  end if;

  select * into v_affiliate
    from affiliates
    where id = p_affiliate_id;

  if not found then
    return null;
  end if;

  v_handle := v_affiliate.handle;

  -- Idempotency: if ANY default link already exists for this affiliate,
  -- return it. (The code defaults to handle on first create; we don't
  -- try to mutate an existing link's code if the handle changed.)
  select id into v_existing_id
    from affiliate_links
    where affiliate_id = p_affiliate_id
    limit 1;
  if v_existing_id is not null then
    return jsonb_build_object(
      'id',               v_existing_id,
      'code',             (select code from affiliate_links where id = v_existing_id),
      'destination_path', (select destination_path from affiliate_links where id = v_existing_id),
      'affiliate_id',     p_affiliate_id
    );
  end if;

  -- Create the default link. The unique on `code` is the race-safety
  -- gate: if two concurrent dashboard loads both try to create the
  -- link, exactly one INSERT wins, the other gets 23505. The catch
  -- block below converts the race to a no-op (the existing row wins).
  begin
    insert into affiliate_links (
      affiliate_id, code, destination_path, active
    ) values (
      p_affiliate_id, v_handle, '/', true
    )
    returning id into v_link_id;
  exception when unique_violation then
    select id into v_link_id
      from affiliate_links
      where code = v_handle
      limit 1;
  end;

  return jsonb_build_object(
    'id',               v_link_id,
    'code',             v_handle,
    'destination_path', '/',
    'affiliate_id',     p_affiliate_id
  );
end;
$$;

grant execute on function public.ensure_default_affiliate_link(bigint) to authenticated;

comment on function public.ensure_default_affiliate_link(bigint) is
  'P13.3 — Idempotent default-link creator. Returns the affiliate''s default affiliate_links row as JSON { id, code, destination_path, affiliate_id }. If a link already exists for the affiliate (any code), returns that row without modification. Otherwise INSERTs a new row with code = handle and destination_path = ''/''. The unique on affiliate_links.code provides race-safety: concurrent dashboard loads serialize via 23505 → catch → existing row wins. Authorization: caller must be the affiliate (current_affiliate_id() match) OR an admin; unauthorized callers get NULL. Called from the dashboard server component on first visit. STABLE — no mutations when the link already exists.';

-- ---------------------------------------------------------------------------
-- STUB REGISTER
-- ---------------------------------------------------------------------------
-- STUB-105 — P13.3 affiliate dashboard schema foundation. Migration 0046
-- ships the 4 tables (affiliate_links / affiliate_clicks /
-- affiliate_commissions / affiliate_payouts) + RLS + indexes +
-- get_affiliate_summary + ensure_default_affiliate_link. Slices 2+
-- deferred to STUB-105 follow-ups: (a) affiliate-link hero card with
-- copy button + QR code modal (P13.5 reuse); (b) UTM builder +
-- destination picker; (c) top-products EPC rollup query; (d) recent
-- commissions table with pagination + CSV export (mirrors the
-- P6.3/P12.11 export patterns); (e) tools grid + resources list;
-- (f) on-click tracking (the /api/affiliate/click route that
-- inserts a row via service role + then 302s to landing_path). The
-- dashboard Slice 1 renders the header + the onboarding banner +
-- the 4 KPI cards from real data; Slices 2+ fill the remaining
-- sections.
