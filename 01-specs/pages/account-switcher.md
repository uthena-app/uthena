# Admin Account Switcher — `/admin/account-switcher`

<!--
P1.10 cover sheet. The full P1.10 work spans 3 slices (foundation +
active-impersonation banner + history view). This spec describes the
whole feature; the slice boundary is named in the Implementation Notes
section. Slice 1 ships the schema, search UI, start action, and recent
sessions list. Slices 2-3 add the active-impersonation banner + the
return-to-admin flow + the per-customer impersonation history view.
-->

## What this page does

The super_admin's entry point for **impersonating another user** — viewing the platform "as" that user. The page is the operational tool for support scenarios where a customer reports an issue ("I can't find my purchase", "My library is empty", "The discount code doesn't work on my cart") and the only way to diagnose is to see what they see. The page is **NOT** a general "log in as another user" feature — every impersonation is logged with admin identity, target user, reason, IP, and timestamp, and the platform owner (super_admin) is the only role allowed to use it.

The flow:

1. Super_admin opens `/admin/account-switcher` (super_admin-gated; non-super_admins get a 403).
2. Searches for a user by email or display name (server-side query, capped at 20 results, other super_admins excluded for privilege separation).
3. Picks a user, types a required reason (≥ 20 chars), clicks **Switch to this user**.
4. The server action:
   - Verifies super_admin role.
   - Calls Supabase's `auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: '/auth/callback?next=...&impersonation=<session-id>' } })` to mint a short-lived (5 min) one-time magic link.
   - Stores the link + metadata in `impersonation_sessions` (new table).
   - Writes one `admin_audit_log` row with `action='admin.account_switch_initiated'`.
5. Admin's browser opens the link in a **new tab** (the original admin tab is unaffected). The new tab establishes a Supabase session for the target user via the existing `/auth/callback` exchange. The target user's session lives in that tab only — the admin can have multiple tabs open (admin context + impersonation context) without conflict.
6. The admin reads/writes as the target user. Every page they visit is RLS-scoped to the target user's identity (because Supabase uses the per-tab cookie set).
7. The admin closes the impersonation tab to return to admin context (no server round-trip needed; the admin tab's session cookie is untouched).

The page also shows a **Recent sessions** list (last 20 impersonation sessions across all super_admins) so the team has visibility into who's been impersonating whom — even if no one is currently doing it.

## Data this page shows

| Field | Source | Format | Notes |
|---|---|---|---|
| Page heading | hard-coded | string | "Account switcher" |
| Search input | URL `?q=` | string (1..120 chars) | `<form method="get">` updates URL on submit; the page re-renders with results |
| Result rows | `searchUsersForImpersonation(q, 20)` | `{ user_id, email, display_name, role, status }` per row | Excludes other `super_admin` users (privilege separation). Cap 20. |
| "Switch to this user" button per row | `<form action={startImpersonation}>` | button | Hidden `targetUserId` field; reason typed in a modal (Slice 1 uses a single shared reason field at the top of the results, Slice 2 can refactor to per-row modals if the team prefers) |
| Reason input | form textarea | string (≥ 20 chars, ≤ 500 chars) | Required for audit trail |
| Recent sessions | `listRecentImpersonationSessions(20)` | `{ id, admin_email, admin_display_name, target_display_name, target_email, started_at, ended_at, expires_at }` | Reverse chronological. Shows the most recent 20 across all super_admins. |
| Empty state (no search) | "Search by email or display name above to find a user." | static | — |
| Empty state (no results) | "No users match `<query>`." + "Try a different search" CTA | static | — |
| Empty state (no recent sessions) | "No impersonation sessions yet." | static | — |

**Why the result list excludes other super_admins:** privilege separation. A super_admin should never impersonate another super_admin — there's no support scenario that justifies the audit-log blast radius. The filter happens in `searchUsersForImpersonation` at the application layer (not in RLS — RLS stays simple). The filter is also a defense in depth against a future "promote to super_admin" bug.

**Why the reason field is at the top of the results, not per-row:** Slice 1 keeps the form simple — one reason field, one set of results. The reason applies to whichever user the admin clicks "Switch to" on. If the admin needs different reasons per user, they re-search and re-enter. Slice 2 can refactor to per-row modal if the team prefers; the Slice 1 shape keeps the slice tight.

**Queries:**
- `02-features/admin/account-switcher/queries/searchUsersForImpersonation.ts` returns `{ rows: ImpersonatableUser[] }`. Cache-deduped.
- `02-features/admin/account-switcher/queries/listRecentImpersonationSessions.ts` returns `{ rows: ImpersonationSessionRow[] }`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Search | Type query, press Enter / click "Search" | URL updates with `?q=...`; results list renders | super_admin |
| Clear search | Click "Clear" (clears `?q=`) | Results list reverts to empty state | super_admin |
| Switch to this user | Click "Switch to this user" on a result row | Server action validates; calls `generateLink`; stores row; audits; returns `{ ok: true, actionLink }`; client opens `actionLink` in a new tab with `window.open(actionLink, '_blank', 'noopener,noreferrer')` | super_admin |
| View Recent sessions | (passive — always rendered below search) | Lists last 20 impersonation sessions | super_admin |
| Page navigation | `<Pagination>` | URL updates with `?page=N` | super_admin (out of scope for Slice 1 — capped at 20) |

**Why `window.open` not `redirect()`:** server actions can call `redirect()` to navigate the *current* tab, but the admin needs the original admin tab to STAY admin (so they can come back). Opening the magic link in a new tab is the only way to keep both contexts alive.

**What if the admin closes the impersonation tab?** Nothing — closing the tab destroys the cookie for that tab; the admin tab is unaffected. To start a fresh impersonation, the admin re-opens this page.

## What this page does NOT do

- **No active-impersonation banner** (Slice 2). Slice 1 ships the start mechanism only; the "You're impersonating X — Return to admin" UI lands in Slice 2.
- **No return-to-admin server action** (Slice 2). Closing the impersonation tab is the v1 cut; a server-side "Return to admin" that revokes the target's session lands in Slice 2.
- **No "End impersonation now" button** (Slice 2).
- **No impersonation history per customer** (Slice 3). Slice 1 shows a global recent-sessions list; the per-customer "impersonation history" tab on `/admin/customers/[id]` lands in Slice 3.
- **No impersonation of another super_admin** (privilege separation — out of scope by design).
- **No impersonation of banned users** (banned users can't log in; the magic link would 401 on exchange. Filter is at the application layer.)
- **No real-time updates** — the Recent sessions list is server-rendered at page load.
- **No bulk impersonation** (out of scope; the impersonation context is per-tab).
- **No impersonation while rate-limited** — see Security § Rate limiting.

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role = 'super_admin'` (non-super_admins get a 403)
- [ ] Customer/partner/affiliate/admin access returns 403 (the sidebar link is super_admin-only; even admins can't see this page)
- [ ] Invalid user id in the `targetUserId` field returns a typed validation error (no DB call)
- [ ] Search input is debounced only at the URL level (form submit → URL update → server re-render). No client-side fetch loop.
- [ ] Search matches `profiles.display_name ILIKE '%q%' OR auth.users.email ILIKE '%q%'` (case-insensitive)
- [ ] Search results cap at 20 rows
- [ ] Search results exclude `role = 'super_admin'` users (privilege separation)
- [ ] Search results exclude `status = 'banned'` users (they can't log in)
- [ ] "Switch to this user" button is `disabled` when the reason field is empty or shorter than 20 chars
- [ ] Reason field is required and validated server-side (Zod `min(20).max(500)`)
- [ ] Server action refuses to impersonate self (`admin_id == target_user_id` → friendly error, no DB write, no audit row)
- [ ] Server action refuses to impersonate a banned user (defense — even if the UI filter is bypassed)
- [ ] Server action rate-limits impersonation starts to 1 per admin per 30 seconds (defense against accidental / scripted abuse)
- [ ] Server action writes ONE row to `impersonation_sessions` per successful start
- [ ] Server action writes ONE row to `admin_audit_log` with `action='admin.account_switch_initiated'`, `target_kind='profile'`, `target_id=<target_user_id>`, `metadata={ target_email, expires_at, impersonation_session_id, reason }`
- [ ] Server action returns the magic link to the client; the client opens it in a new tab with `noopener,noreferrer`
- [ ] Recent sessions list shows the most recent 20 sessions across all super_admins, reverse chronological
- [ ] Recent sessions list shows admin email + display_name + target display_name + target email + started_at + ended_at + expires_at
- [ ] Empty states designed for: no search, no results, no recent sessions
- [ ] Page renders in < 400ms p95 (the two queries are cheap; the Recent sessions query hits a covering index)
- [ ] No `TODO` / `FIXME` in the diff
- [ ] No PII in URLs (search query is a free-text input — never log to audit, never echo to other tabs)

## Design reference

- Mockup: not yet — this page is operator-facing (admin-shell pattern, same shape as `admin-categories`)
- Components: `02-features/admin/shell/AdminShell.tsx` + `AdminSidebar.tsx` (with the new "Account switcher" link)
- Design tokens: `00-foundations/design/tokens.css`
- Theme: dark (admin shell)

## Security

- **Auth required:** YES
- **Allowed roles:** `super_admin` ONLY. The page gates via `requireRole(['super_admin'])`; non-super_admins get a 403. The sidebar link is super_admin-only (so admins without super_admin privilege don't see the link at all — defense in depth).
- **RLS policies that apply:**
  - `profiles` — `profiles_public_read` (admin can read all profiles, which is what the search needs)
  - `impersonation_sessions` — `impersonation_sessions_admin_read` (admin can SELECT; INSERT/UPDATE/DELETE via service role only)
  - `admin_audit_log` — `admin_audit_log_admin_read` (admin can read; INSERT via service role only)
- **PII displayed:** yes — emails + display names of both admin and target user (both visible in the recent-sessions list). Every view is logged at the page-load level (the page's existing P0.21 metadata includes `noindex`; PII itself is gated by the auth wall + the super_admin role).
- **PII in URLs:** NO. The search query is `?q=<text>` — never logged to audit. The target user id is in the POST body (not URL).
- **Audit logged:** YES — every start writes `admin_audit_log`. The recent-sessions list is a read of `impersonation_sessions` (which itself is the audit trail for this feature).
- **Magic link security:**
  - Magic link is single-use + 5-min TTL (Supabase defaults).
  - Admin opens it in a new tab via `window.open` with `noopener,noreferrer` (prevents the impersonation tab from accessing `window.opener`).
  - The action stores the link in `impersonation_sessions.action_link`. The table is SELECT-only for non-service-role clients; the link never leaves the service-role boundary except via the admin's own browser session.
- **Privilege separation:**
  - Other super_admins cannot be impersonated (privilege separation — out of scope by design, the UI filter excludes them).
  - Admins cannot impersonate anyone (they're not super_admin).
  - Customers/partners/affiliates cannot impersonate anyone (they don't have admin role, let alone super_admin).
- **Defense against impersonation loops:** the start action refuses to impersonate self. The `admin_id <> target_user_id` check constraint on `impersonation_sessions` is the data-model guarantee (the action's runtime check is the fast path).
- **Banned users:** the start action refuses to impersonate a `status = 'banned'` user even if the UI filter is bypassed (a request forgery can't create a target user). Banned users also can't log in (the magic link exchange would fail at the Supabase Auth layer, but rejecting at the start saves a round-trip).
- **CSRF:** all server actions protected by Next.js's built-in action token.
- **Rate limiting:** start impersonation 1 per super_admin per 30 seconds (in-memory map, same shape as the existing 1/60s per-user rate limit on `signOutSessionByIdAction`). Defense against accidental click-spam and a hostile script that finds the admin's session.
- **Third-party scripts:** none. The Supabase admin call is server-side only.

## Performance

- **Target p95:** < 400ms
- **Render strategy:** RSC + SSR. The page is fully server-rendered (no client JS for the search/results/recent-sessions UI). The "Switch to this user" button is a tiny client island that calls the start action + `window.open`.
- **Cache:** none. The page reads live data; a stale search result could miss a user that just signed up.
- **DB indexes used:**
  - `impersonation_sessions (admin_id, created_at desc)` — the recent-sessions query
  - `profiles (role)` — the role-filter
  - `profiles (status)` — the banned-filter
  - The search is `display_name ILIKE '%q%' OR email ILIKE '%q%'` — no index helps with leading `%`; v1 accepts the table scan (≤ 10k users in the v1 catalog). P3.1 (index audit) may add a trigram index if the dataset grows.
- **Bundle size budget:** < 5KB added to client bundle (the small client island for the "Switch to this user" button).

## Out of scope for v1

- Active-impersonation banner ("You're impersonating X — Return to admin") — Slice 2
- Server-side return-to-admin action (sign out the impersonation session + clear the cookie) — Slice 2
- Per-customer impersonation history tab on `/admin/customers/[id]` — Slice 3
- Audit-log search UI filter by `action='admin.account_switch_initiated'` — P14.18 (admin audit log search)
- Impersonation of banned users — refused by design
- Impersonation of another super_admin — refused by design
- Real-time updates to the recent-sessions list — deferred to a future tick
- Slack notification on impersonation start (in-app audit log only in v1)
- "Watch" mode (impersonation tab is read-only; no mutations allowed) — would require a Supabase claim flag; deferred
- "Step into cart" deep link (start impersonation + open `/cart` in the new tab) — could land as a future enhancement
- "Impersonation allowed hours" rule (e.g. only during business hours) — out of scope
- Auto-expire active impersonation after N hours — Slice 2 can add a TTL on the cookie / on the row

## Open questions for human

1. **Reason minimum length.** Spec says ≥ 20 chars. Real-world support copy ("user asked") is 14 chars. Flag for review — 20 is the conservative pick; could relax to 10 if the team prefers.
2. **Rate limit window.** Spec says 1 per 30s. Defense against click-spam + a hostile script. Could be more relaxed (1 per 10s) if the team finds 30s annoying for legitimate "I'm comparing two accounts" workflows.
3. **Recent sessions visibility.** Spec says "across all super_admins" (so the team has mutual oversight). Alternative: only show "your own sessions" (privacy). Flag for review — mutual oversight is the safer default; can tighten later.
4. **Search input shape.** Spec says a single `q` text field matching `display_name OR email`. Could split into two inputs (email vs display name) for precision. Flag for review — single field is the simpler v1 cut.

## Implementation notes (filled in during/after build)

### Slice 1 — Foundation (this tick)

Ships:
- `04-platform/migrations/0023_impersonation_sessions.sql` — new `impersonation_sessions` table + RLS + indexes + `is_super_admin()` helper
- `02-features/admin/account-switcher/` — feature module (queries, action, components, README, barrel)
- `app/admin/account-switcher/` — page route (RSC) + loading + CSS modules
- `02-features/admin/shell/AdminSidebar.tsx` — new "Account switcher" link (super_admin-only)
- `01-specs/pages/account-switcher.md` — this spec
- `STUBS.md` — STUB-043 for Slices 2-3

Slice boundary:
- ✅ Schema, super_admin gate, search UI, start action, audit log, recent sessions
- ❌ Active-impersonation banner — STUB-043
- ❌ Server-side return-to-admin — STUB-043
- ❌ Per-customer impersonation history tab — STUB-043

### Design decisions worth remembering

- **`window.open(actionLink, '_blank', 'noopener,noreferrer')`** — the magic link opens in a new tab so the admin's primary tab STAYS admin. The `noopener,noreferrer` flag prevents the impersonation tab from accessing `window.opener` (would otherwise be a small cross-context leak).
- **`action_link` stored in the row** — Supabase's magic link is one-time-use + 5-min TTL. Storing it lets us regenerate the audit trail if the admin reopens, and lets the recent-sessions list show the actual link (with a "Reopen link" button — Slice 2). The cost is one extra `text` column per row; the benefit is full observability.
- **Reason as a single field at the top of the results** — Slice 1 keeps the form simple. A future enhancement can refactor to per-row modal if the team prefers (the data model already supports it).
- **`is_super_admin()` distinct from `is_admin()`** — super_admin is a separate role in the `user_role` enum. The new helper gates the page + the start action; the existing `is_admin()` helper stays as "any admin role" for read-level access (so admins can still SEE the audit log + the recent-sessions list).
- **Self-impersonation refused both at runtime AND in the data model** — the `admin_id <> target_user_id` check constraint on the table is the data-model guarantee; the action's runtime check is the fast path that returns a friendly error before the DB write.
- **No PII in URLs** — the search query (`?q=...`) is free text and never appears in the audit log. The target user id is in the POST body, never the URL.
- **Rate limit is in-memory per-admin** — the existing rate-limit infrastructure (`00-foundations/auth/rate-limit.ts`) is `auth_failed_attempts`-backed. The impersonation start rate limit doesn't need that durability (the cost of forgetting one rate-limit row is low; the user can retry in 30 seconds). A simple `Map<adminId, lastStartAt>` suffices for v1. If the team wants durability, refactor to use `checkRateLimit({ kind: 'impersonation', ... })` with a new LIMITS row.
- **Slice 2 will use `consumed_at`** — the magic link exchange via `/auth/callback` will update `impersonation_sessions.consumed_at = now()` for the matching row (via a SECURITY DEFINER RPC that reads `?impersonation=<id>` from the URL). Slice 2.
- **Slice 3 will use `ended_at`** — the future return-to-admin server action will set `impersonation_sessions.ended_at = now()`. Slice 3.
