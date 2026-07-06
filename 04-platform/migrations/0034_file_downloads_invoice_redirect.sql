-- ---------------------------------------------------------------------------
-- 0034_file_downloads_invoice_redirect.sql
-- ---------------------------------------------------------------------------
-- Resolves STUB-051 v2 — the order-detail invoice CTA now uses
-- Stripe's hosted invoice URL (`invoice.hosted_invoice_url`) instead
-- of generating our own PDF. The redirect still needs an audit-log
-- row in `file_downloads` so the admin queue can answer "who
-- downloaded which invoice when" — but the existing CHECK constraint
-- only allows `kind IN ('download', 'stream')`, so 'invoice_redirect'
-- would have been rejected.
--
-- This migration extends the CHECK constraint to add
-- 'invoice_redirect' as a third legal value. Existing rows are
-- untouched (the constraint is just widened). No data is moved or
-- deleted. Idempotent — the second run hits `DO block` returns
-- nothing to update, no error.
--
-- Used by:
--   - 02-features/account/profile/actions/logInvoiceDownload.ts
--     (server action that writes the audit row on invoice-CTA click)
--   - 04-platform/ci/scripts/db-bootstrap-verify.ts (next run will
--     pass against the widened constraint unchanged)
-- ---------------------------------------------------------------------------

do $$
begin
  -- Drop the old CHECK (if present) and add the widened one. The
  -- constraint is unnamed in 0001_initial.sql so Postgres auto-named
  -- it `file_downloads_kind_check`. We drop by name to be explicit.
  if exists (
    select 1
    from pg_constraint
    where conname = 'file_downloads_kind_check'
      and conrelid = 'public.file_downloads'::regclass
  ) then
    alter table public.file_downloads
      drop constraint file_downloads_kind_check;
  end if;

  alter table public.file_downloads
    add constraint file_downloads_kind_check
    check (kind in ('download', 'stream', 'invoice_redirect'));
end
$$;