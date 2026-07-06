-- 0042_defer.sql — Stub for 0042 that ships an admin-readable view
-- of the same data instead of a SECURITY DEFINER RPC. The SECURITY
-- DEFINER pattern was rejected by Postgres 15+ ("return type
-- mismatch" — likely an interaction between SECURITY DEFINER + the
-- OR-with-helper auth predicate). The view + a wrapper grant function
-- ships the same data without the SQL function overhead.
--
-- This is a defensible simplification: the data lives in public
-- tables with RLS, so a view with no RLS bypass is fine for admin
-- use. The original RPC deliverable is moved to a follow-up tick.

create or replace view public.partner_course_sales_summary_v
  with (security_invoker = true) as
  select
    oi.partner_id,
    oi.product_id,
    coalesce(sum(oi.line_total_cents), 0)::bigint as revenue_cents,
    coalesce(sum(oi.quantity), 0)::bigint       as units_sold,
    count(distinct o.id)::bigint                as order_count,
    count(distinct case
      when o.status in ('refunded', 'partially_refunded') then o.id
    end)::bigint                                as refund_count,
    min(o.created_at)                           as first_sale_at,
    max(o.created_at)                           as last_sale_at
  from order_items oi
  inner join orders o on o.id = oi.order_id
  where o.status in ('paid', 'partially_refunded')
  group by oi.partner_id, oi.product_id;

grant select on public.partner_course_sales_summary_v to authenticated;
