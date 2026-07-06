# Account Shell — `/account/*` + sibling portal shells

## What this surface does

The authenticated "home base" for every role. Three sibling shells share
the same visual contract (sidebar + content area + sign-out) but each
adapts to a different role:

- `/account/*` — the buyer's home. Available to **all** authenticated
  users. Shows the role's portal entry point as a top-level link when
  the user has partner / affiliate / admin role.
- `/partner/*` — the partner's home. Auth-gated to
  `profile.role ∈ ('partner', 'admin', 'super_admin')`.
- `/affiliate/*` — the affiliate's home. Auth-gated to
  `profile.role ∈ ('affiliate', 'admin', 'super_admin')`.
- `/admin/*` — the admin's home. Auth-gated to
  `profile.role ∈ ('admin', 'super_admin')`. (AdminShell is
  shipped separately at `02-features/admin/shell/`.)

This spec covers the **shared shell contract** — the user card, the
sidebar layout, the role-aware nav filter, the active-link state, the
skip-link, and the sign-out affordance. The admin shell already
follows this contract; P1.7 brings account + partner into compliance
and ships an affiliate placeholder shell so the role-aware nav link
in `/account` doesn't 404.

## Data this surface reads

- `getSessionUser()` — `00-foundations/auth/guards.ts` — returns
  `{ id, email, role, display_name }`. The shell's sidebar reads
  this once per request via the layout. No DB query.
- `profiles.role` — read once (already in `getSessionUser()`). The
  `role` value drives which nav items + portal links are visible.
- `profiles.display_name` + `profiles.email` — shown in the user
  card at the top of the sidebar.

## Role-aware nav (the central feature)

Each shell renders a `<NavItem>` array filtered by the user's role:

```ts
type NavItem = {
  href: string
  label: string
  show: 'all' | 'partner' | 'affiliate' | 'admin'
}

const ROLE_AUDIENCE: Record<Role, string[]> = {
  customer:    [],
  partner:     ['partner'],
  affiliate:   ['affiliate'],
  admin:       ['partner', 'affiliate', 'admin'],
  super_admin: ['partner', 'affiliate', 'admin'],
}
```

A nav item is visible when its `show` value is `'all'` OR appears in
`ROLE_AUDIENCE[user.role]`. The portal entry links in the account
shell use this same predicate.

### The four shells

| Shell | Audience | Sidebar nav items |
|---|---|---|
| `/account/*` (AccountShell) | any signed-in user | Overview · Orders · Library · Profile · Settings + portal entries (Partner / Affiliate / Admin) for users with those roles |
| `/partner/*` (PartnerShell) | partner, admin, super_admin | Dashboard · Courses · Sales · Payouts · Upload · Settings |
| `/affiliate/*` (AffiliateShell) | affiliate, admin, super_admin | Dashboard · Links · Shop · Settings (P13 placeholders) |
| `/admin/*` (AdminShell — existing) | admin, super_admin | Moderation / Users / System sections (existing `AdminSidebar`) |

## User actions

| Action | Where | Result |
|---|---|---|
| Navigate to a sub-page | Sidebar link | RSC navigation to the sub-route |
| Sign out | Siderar sign-out button | `supabase.auth.signOut()` + `redirect('/')` (account/partner/affiliate). Admin uses `SignOutButton` from `02-features/admin/shell/` |
| Skip to content | Skip-link at the top of the sidebar (visible on focus) | Anchor jump to `<main id="...">` |

## What this surface does NOT do

- **Not** the per-page content (the dashboards, settings forms,
  tables, etc. belong to their own specs).
- **Not** the role-change admin action (P1.10).
- **Not** the auth callback handler (P1.9).
- **Not** session management / sign-out-everywhere (P1.8).

## Acceptance criteria

- [ ] `/account/*` is wrapped by `AccountShell` (auth-gated, RSC)
- [ ] `/partner/*` is wrapped by `PartnerShell` (auth-gated,
      partner role required)
- [ ] `/affiliate/*` is wrapped by `AffiliateShell` (auth-gated,
      affiliate role required)
- [ ] Account sidebar nav filters items by `show` predicate based
      on `getSessionUser().role`
- [ ] Partner sidebar nav is visible only to users with the
      partner / admin / super_admin role
- [ ] Affiliate sidebar nav is visible only to users with the
      affiliate / admin / super_admin role
- [ ] Admin sidebar nav (existing) is visible only to admin /
      super_admin
- [ ] Active sidebar link carries `aria-current="page"` + a
      visible accent-soft background + accent text color
- [ ] The "Partner portal" / "Affiliate portal" / "Admin console"
      links in the account sidebar appear ONLY when the user has
      the matching role
- [ ] Each shell has a visible-on-focus skip-link at the top of
      the sidebar (mirrors the existing AdminShell)
- [ ] User card shows `display_name`, `email`, and a role pill
      (teal accent for customer/partner/affiliate, distinct
      treatment for admin)
- [ ] Sign-out button clears the session + redirects to `/`
- [ ] All 4 shells use the same design tokens (sidebar width,
      spacing, colors); no inline hex / magic pixels
- [ ] Each shell renders the user's correct role label in the
      sidebar (e.g. "Partner", "Affiliate", "Admin")
- [ ] `/affiliate` page exists and renders a placeholder
      ("Dashboard coming in Phase 13") for affiliate-role users —
      the link in the account sidebar doesn't 404
- [ ] No `TODO` / `FIXME` in the diff
- [ ] All 6 CI checks green + `pnpm build` clean

## Design reference

- Account shell layout: `app/account/account.module.css` (the
  pre-P1.7 shell — P1.7 extracts it to a feature module + adds
  active state)
- Partner shell layout: `02-features/partner-portal/PartnerShell.module.css`
  (pre-P1.7 — P1.7 adds active state)
- Admin shell layout: `02-features/admin/shell/AdminShell.module.css`
  (the reference implementation — has active state, skip-link,
  topbar; account + partner + affiliate shells mirror its
  visual contract)

## Security

- **Auth required:** YES — every shell calls a guard
  (`requireUser` / `requirePartner` / `requireAffiliate` /
  `requireRole`) before rendering
- **RLS:** the underlying data reads (counts, profile) inherit
  the existing RLS policies; the shell itself doesn't open any
  new data path
- **PII in sidebar:** the user's `email` is shown in the user
  card. The card is wrapped behind the auth guard, so the user
  can only see their own email. No PII is sent to the client
  except via the session read
- **Audit logged:** the sign-out action writes an
  `admin_audit_log` row (via `writeSelfAuditLog`) — but only for
  the partner / admin shells where the audit trail is in scope.
  Customer sign-out doesn't need to write an audit row today;
  Phase 9 P9.6 (sessions list) will add per-session sign-out
  events.

## Performance

- **Target p95:** < 100ms (the shell itself is RSC; the only
  data is `getSessionUser()` which is `cache()`-deduped)
- **Render strategy:** RSC. The active-link state needs a tiny
  client island per shell (`AccountSidebarActive` /
  `PartnerSidebarActive` / `AffiliateSidebarActive` / existing
  `AdminSidebarActive`) — each is ~600 B of client JS
- **Bundle size budget:** < 1 KB added to the shared first-load
  JS per shell

## Out of scope for v1

- Per-admin action quotas (P14)
- Personalized dashboard widgets (the account Overview page
  ships its own KPIs in its own spec; the shell is just the
  chrome around it)
- Sticky sidebar on tall content (the admin sidebar is sticky;
  the account + partner shells use the simpler relative
  positioning because their pages are shorter — could be
  upgraded later)
- Mobile drawer for the sidebar (currently collapses to a
  top-of-page stack at ≤ 768px; a true drawer is a Phase 19
  marketing polish item)

## Open questions for human

None — this spec is the consolidation of three existing shells
into a shared contract. The role-aware nav predicate is the
spec author's call; the admin / partner / affiliate roles are
well-established in the existing data model
(`01-specs/pages/_data-model.md` "Roles").

---

## Implementation notes

- (filled by the building agent — see `02-features/account/README.md`
  for the file map + decision log)