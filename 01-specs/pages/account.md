# Account — Overview

## What this page does
Landing page after login. Shows a brief overview of the user's account
state: order count, library count, and role. Includes next-step CTAs.

## Data this page shows
- Welcome message with the user's display name
- KPI cards:
  - Orders count (clickable → /account/orders)
  - Library items count (clickable → /account/library)
  - Role (clickable to the right portal)
- "Get started" block with CTAs to browse + subscribe

## User actions
- Sign out (form action in the sidebar)
- Navigate to a portal (partner / affiliate / admin) when role permits
- Navigate to orders, library, profile, settings

## What this page does NOT do
- Show recent activity feed (PH10)
- Show unread notifications
- Show the subscription status (PH07 wires that in the next phase)

## Acceptance criteria
- [x] Server component, RSC
- [x] Uses `requireUser` guard (redirects to /login?next=/account if not signed in)
- [x] Three KPI cards, all with sensible empty states (0)
- [x] Each card is a link
- [x] Layout shell (sidebar + content) lives in `app/account/layout.tsx`
- [x] No PII in the response
- [x] Auth-gated (RLS on profiles + role check on the layout)

## Design reference
Standard dashboard grid; design system tokens only.

## Security
- Auth required (server-side guard)
- Counts read via RLS-aware client (the user can only see their own)
- The role label is read once and rendered — never trust client-side

## Performance
- Two `count: exact` queries in parallel; p95 < 200ms

## Out of scope for v1
- Recent activity timeline
- Saved payment methods
- Subscription management UI (PH07)

## Open questions for human
None.
