# Affiliate Portal — `/affiliate` (placeholder, P1.7 shell)

## What this page does

The `/affiliate` route is the entry to the affiliate portal. In Phase
13 this becomes the affiliate **dashboard** (KPIs, affiliate link
hero, top products, recent commissions) — see
`01-specs/pages/affiliate-dashboard.md` for the full spec.

For P1.7 (the shell-pass tick), `/affiliate` ships a **placeholder**
that:

1. Confirms the role-aware nav link in `/account` resolves correctly
   for affiliate-role users (no 404).
2. Shows the user what's coming in Phase 13.
3. Has the same shell contract as `/account` + `/partner` so the
   visual + a11y parity holds across all four role areas.

The full dashboard lands in P13.3 (Affiliate shell + dashboard).

## Data this page shows

| Section | Source | Format |
|---|---|---|
| Page header | hardcoded | "Affiliate dashboard" + lede |
| Status callout | hardcoded | "Coming soon — Phase 13. Ships in the next build wave." |
| Forward-link | hardcoded | "← Back to account" link |

No data reads in this tick. The dashboard data sources land with
the dashboard in P13.3.

## User actions

| Action | Where | Result |
|---|---|---|
| Navigate to /account | Sidebar "Back to account" link | RSC navigation |
| Sign out | Sidebar sign-out button | Clear session + redirect `/` |

## What this page does NOT do

- **Not** the affiliate dashboard (P13.3)
- **Not** affiliate link generation (P13.5)
- **Not** affiliate mini-shop (P13.8)
- **Not** affiliate settings (P13.11)

This is the **shell** only — auth gate + sidebar + placeholder
content. Every other affiliate feature ships in Phase 13.

## Acceptance criteria

- [ ] `/affiliate` is auth-gated (redirects to `/login?next=/affiliate`
      when anonymous)
- [ ] `/affiliate` is **role-gated** to
      `profile.role ∈ ('affiliate', 'admin', 'super_admin')` —
      non-affiliates hit `/403`
- [ ] The page renders the placeholder content for affiliate-role
      users
- [ ] The shell sidebar (AffiliateShell) has active state on the
      `/affiliate` link
- [ ] The shell sidebar has a skip-link to the main content
- [ ] The shell sidebar has a sign-out button
- [ ] The shell renders the user's role as "Affiliate" in the
      user card
- [ ] No `TODO` / `FIXME` in the diff
- [ ] All 6 CI checks green + `pnpm build` clean

## Design reference

The shell layout mirrors the existing account + partner + admin
shells. The placeholder body uses the standard page header pattern
(eyebrow + h1 + lede) consistent with the home + bundles + /search
pages.

## Security

- **Auth required:** YES
- **Allowed roles:** affiliate, admin, super_admin
- **RLS policies that apply:** none directly (no data reads)
- **PII in URL:** no
- **Audit logged:** sign-out (when used) writes to the same audit
  pattern as the account + partner shells

## Performance

- **Target p95:** < 100ms (placeholder, no data reads)
- **Render strategy:** RSC. The active-link state needs the
  AffiliateSidebarActive client island (~600 B)
- **Bundle size budget:** < 1 KB added to the shared first-load
  JS

## Out of scope for v1

- All affiliate dashboard features (deferred to P13.3)
- Affiliate onboarding wizard (P13.1) — the page ships with the
  `/affiliate` route only. Non-affiliate users hitting
  `/affiliate` get the `/403` redirect; the onboarding flow
  starts from a separate entry point (likely the account
  Overview's "Become an affiliate" CTA, which lands in P13.2)

## Open questions for human

None.

---

## Implementation notes

- (filled by the building agent)