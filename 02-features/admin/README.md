# Feature: admin

The admin area: orders, customers, refunds, partner/affiliate review, payouts, content review, analytics, settings. RBAC per ADR-0008. Every admin read of PII is audit-logged (`AGENTS.md` rule 2).

- **Specs:** all `01-specs/pages/admin-*.md` + `admin.md` (17 specs total)
- **Owner:** unassigned — claimed by the implementing agent at build start
- **Depends on:** everything (top of the dependency stack) — always via each feature's `index.ts`
- **Depended on by:** nothing
- **Status:** PH15 slice 1 (admin shell + categories) shipped; remaining admin pages land in PH15 slices 2+
- **Test locally:** `pnpm test 02-features/admin`; RBAC tests must cover authorized AND unauthorized roles per the security-audit checklist
- **Open follow-ups:** none — see `01-specs/pages/_followups.md`

## Module structure

```
02-features/admin/
├── README.md
├── index.ts                          ← public surface (shell)
├── shell/                            ← AdminShell, AdminSidebar, AdminTopbar, SignOutButton
│   ├── AdminShell.tsx
│   ├── AdminShell.module.css
│   ├── AdminSidebar.tsx
│   ├── AdminSidebarActive.tsx        ← client island; reads usePathname
│   ├── AdminTopbar.tsx
│   └── SignOutButton.tsx             ← client island; calls supabase.auth.signOut()
├── categories/                       ← admin/categories page
│   ├── queries/                      ← server-only data fetches
│   ├── actions/                      ← 'use server' mutations
│   ├── components/                   ← tree, modals, stats cards, history panel
│   └── index.ts                      ← public surface for the categories page
└── account-switcher/                 ← P1.10 super_admin-only impersonation page
    ├── queries/                      ← searchUsersForImpersonation + listRecentImpersonationSessions
    ├── actions/                      ← startImpersonation + writeAuditLog
    ├── components/                   ← ImpersonationSearch, ImpersonationResults, SwitchToUserButton, RecentSessions + CSS
    ├── constants.ts                  ← MIN_REASON_LEN / MAX_REASON_LEN
    ├── index.ts                      ← public surface
    └── README.md                     ← status + open follow-ups (STUB-043)
```

## How to add a new admin page

1. **Use the existing shell.** Import `AdminShell` from `@features/admin` and
   pass a page title. The shell handles the sidebar + topbar + skip-link.
2. **Auth-gate the route.** At the top of every `page.tsx`, call
   `await requireRole(['admin'])` (from `@foundations/auth/guards`).
   Non-admin users are redirected to `/403`.
3. **Audit-log every mutation.** Every server action writes one
   `admin_audit_log` row with `before`/`after` JSON. Use the
   `getServiceSupabase()` client to insert (no INSERT policy exists
   on `admin_audit_log` for the user's role).
4. **No secrets, no PII in logs.** Pino's redact list handles the
   common cases; add a new field to `00-foundations/log/pino.ts` if
   you introduce a new PII field.
5. **Reuse design tokens.** The shell's `.envBadge`, `.sidebarUser`,
   etc. classes are tokens-only. Pages that need a new look should
   compose against the same tokens.
