# Feature: account/shell

The buyer's authenticated home shell — wraps every `/account/*`
page with a role-aware sidebar + content area.

## Surface

- **RSC** `AccountShell` at `02-features/account/AccountShell.tsx`.
  Wraps every page under `/account/*`. Calls `getSessionUser()`,
  redirects to `/login?next=/account` for anonymous visitors, and
  renders the sidebar with role-filtered nav items.
- **Client island** `AccountSidebarActive` at
  `02-features/account/AccountSidebarActive.tsx`. Tiny client
  component that reads `usePathname()` and applies the active
  style + `aria-current="page"` to the matching link. ~600 B of
  client JS.
- **CSS module** `AccountShell.module.css` — token-only, mirrors
  the visual contract of the AdminShell + PartnerShell +
  AffiliateShell (same sidebar width, spacing, sign-out pattern).

## What the shell renders

- **User card**: `display_name`, `email`, role pill (accent-soft
  background).
- **Nav** (filtered by role):
  - Always visible: Overview · Orders · Library · Profile · Settings
  - Visible only for users with the matching role:
    - `partner` role → Partner portal link
    - `affiliate` role → Affiliate portal link
    - `admin` / `super_admin` → all three portal links (Partner
      + Affiliate + Admin console)
- **Sign-out button** — server action via
  `signOutAction` from `@features/auth/actions`. Clears the
  session + redirects to `/`.
- **Skip-link** at the top of the sidebar — visible on focus,
  jumps to `<main id="account-main">`.

## Decisions worth remembering

- **Role filter via a single `ROLE_AUDIENCE` table.** The predicate
  is `['all', ...ROLE_AUDIENCE[user.role]]` — adding a new portal
  is a one-line NAV entry + one-line audience entry. No branching
  in the render code.
- **Admin / super_admin see every portal link.** They may need to
  switch context (e.g. support agent impersonating a partner). The
  `ROLE_AUDIENCE['admin'] = ['partner', 'affiliate', 'admin']`
  captures this in one place.
- **`href="/account"` uses exact match; everything else uses
  prefix match.** `AccountSidebarActive` mirrors the
  `AdminSidebarActive` exact/prefix split so all role shells share
  the same active-link behavior.
- **Why a separate client island for the active state.** The shell
  itself is RSC (the user data, the role filter, the sign-out form
  are all server-rendered). The only client logic is reading the
  current pathname — a ~600 B island is the smallest possible
  client footprint. The shell ships 0 B of client JS otherwise.
- **The shell layout file is now thin.** `app/account/layout.tsx`
  is a 6-line wrapper that calls `<AccountShell>{children}</AccountShell>`
  — page-level concerns stay in the layout; visual contract lives
  in the feature.

## Spec

[`01-specs/pages/account-shell.md`](../../01-specs/pages/account-shell.md)
(plus the per-page specs for each account sub-page).

## Sibling shells

- `/partner/*` — `02-features/partner-portal/PartnerShell.tsx`
  (active state added in P1.7; `PartnerSidebarActive.tsx`).
- `/affiliate/*` — `02-features/affiliate-portal/AffiliateShell.tsx`
  (placeholder shell — full features land in P13.3).
- `/admin/*` — `02-features/admin/shell/AdminShell.tsx` (the
  reference implementation; already had active state + skip-link
  before P1.7).

## Out of scope for v1

- Sticky sidebar on tall content (the AdminShell is sticky; the
  account shell's sticky behavior matches the PartnerShell's
  relative positioning for visual parity)
- Mobile drawer for the sidebar (current behavior: collapses to
  top-of-page stack at ≤ 768px; a true drawer is Phase 19 polish)
- Per-admin impersonation ("View as user X") — P14 admin tooling