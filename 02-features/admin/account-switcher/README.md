# account-switcher (admin)

The admin's super_admin-only entry point for **impersonating another user**. Used for support workflows where the only way to diagnose is to see what the user sees ("I can't find my purchase", "My library is empty", "The discount code doesn't work on my cart").

- **Spec:** `01-specs/pages/account-switcher.md` (P1.10 cover sheet)
- **Page:** `/admin/account-switcher` (super_admin-gated)
- **Depends on:** `00-foundations/auth/guards` (requireRole), `00-foundations/data/supabase` (service role for `auth.admin.generateLink`)
- **Depended on by:** nothing yet (Slice 2 will add the banner; Slice 3 will add the per-customer history tab)
- **Status:** P1.10 Slice 1 shipped — schema + search UI + start action + recent sessions list. Active-impersonation banner + return-to-admin server action + per-customer history tab are STUB-043.
- **Test locally:** `pnpm test 02-features/admin/account-switcher`; the action's RBAC path must be covered by an integration test (admin → 403; regular super_admin → 200)

## Module structure

```
02-features/admin/account-switcher/
├── README.md
├── index.ts                                       ← public surface
├── constants.ts                                   ← MIN_REASON_LEN, MAX_REASON_LEN (shared client + server)
├── queries/
│   ├── searchUsersForImpersonation.ts             ← service-role search by email/display_name
│   └── listRecentImpersonationSessions.ts         ← last 20 sessions across all super_admins
├── actions/
│   ├── startImpersonation.ts                      ← 'use server' — generateLink + insert row + audit
│   └── writeAuditLog.ts                           ← admin_audit_log writer (mirrors the categories pattern)
└── components/
    ├── ImpersonationSearch.tsx                    ← client — search input + reason field
    ├── ImpersonationResults.tsx                   ← RSC — calls searchUsersForImpersonation
    ├── SwitchToUserButton.tsx                     ← client — calls startImpersonation + window.open
    ├── RecentSessions.tsx                         ← RSC — last 20 sessions table
    └── AccountSwitcher.module.css                 ← token-only styles
```

## How to add a new field to the search results

1. Add the column to `searchUsersForImpersonation.ts` (the SELECT).
2. Extend `ImpersonatableUser` with the new field.
3. Add the column to `ResultRow` in `ImpersonationResults.tsx` (CSS class on `styles.resultMeta`).

## How to add a new field to the recent-sessions table

1. Add the column to `listRecentImpersonationSessions.ts` (the SELECT).
2. Extend `ImpersonationSessionRow` with the new field.
3. Add the column to `RecentSessions.tsx`'s `<table>` (the `<thead>` + `<tbody>` row).

## Security notes

- The page gates on `requireRole(['super_admin'])` — admins (without `super_admin`) cannot impersonate.
- The `startImpersonation` action refuses to impersonate self (runtime check + DB check constraint).
- The search excludes `role='super_admin'` users + `status='banned'` users (privilege separation).
- The action rate-limits to 1 per super_admin per 30s (in-memory; can move to the auth_failed_attempts table later).
- Every start writes one `admin_audit_log` row + one `impersonation_sessions` row.
- The magic link is opened in a new tab via `window.open(..., '_blank', 'noopener,noreferrer')` — the admin's primary tab stays admin.

## STUB-043 (deferred)

Slices 2-3 of P1.10:
- **Slice 2:** Active-impersonation banner on every page (sticky top, "You're impersonating X — Return to admin"), `endImpersonationAction` server action, `/admin/account-switcher/active` landing page after the magic-link exchange.
- **Slice 3:** Per-customer impersonation history tab on `/admin/customers/[id]` + an "open impersonation from this customer" shortcut.
