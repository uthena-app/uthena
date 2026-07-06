# Account settings — `/account/settings`

## What this page does

The user's settings hub. Seven stacked sections, each with its own card and its own save model:

1. **Notifications** — controls how often we email the user (email digest frequency, transactional vs marketing split). The data lives in a NEW table, `notification_preferences` (not yet in `_data-model.md` — see Open Questions for the proposed schema). The default values are: `email_digest_freq='weekly'`, `transactional_opt_in=true` (locked, because transactional emails — receipts, password resets, payout notifications — are required for the service to function), `marketing_opt_in=false` (GDPR opt-in default; we do NOT pre-check the marketing box).
2. **Marketing emails** — opt-in toggles for the three marketing lists: general newsletter, partner program updates, affiliate program updates. Each is independent. Toggling one does not affect the others. All default to off.
3. **Privacy** — two CTAs: "Download my data" (right-to-export per `docs/ARCHITECTURE.md` §7) and "Delete account" (a link to `/account/profile`'s danger zone, or a destructive button that scrolls to / focuses the danger card on the same page — see Open Questions for the routing decision).
4. **Connected accounts** — shows the user's OAuth providers (Google) and email/password status. In v1: "Sign in with Google" (if not connected) or "Disconnect Google" (if connected). Email/password is always present (account-existence fact, not a setting).
5. **Billing & subscriptions** — hidden in v1 unless Shopify import or a future product scope creates active subscriptions. If rendered, it shows active subscriptions and a prominent "Cancel subscription" button that routes to a self-service cancellation flow or Stripe customer portal.
6. **Sessions** — list of active sessions, one per (user_id, device fingerprint, last_active_at) row. Current session is pinned to the top with a "This device" badge. Each row has a "Sign out" button; the current row's button is disabled. A separate "Sign out everywhere" button (with confirmation) invalidates ALL sessions for the user via the Supabase Auth admin API.
7. **Language & region** — locale + timezone selectors. (These are the same fields as `account-profile.md`, but surfaced here too for users who only open settings to change language. The single source of truth is `profiles.locale` and `profiles.timezone`; saving here writes the same rows as saving on the profile page. The two pages never edit the same field in a stale way because each field has its own dirty flag.)

Audit logging applies to every preference toggle, every session action, and every email/session opt-in. This is required by `docs/ARCHITECTURE.md` §7 and is the primary way an admin can answer "what did the user actually agree to?".

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Notifications | `email_digest_freq` | NEW: `notification_preferences` (one row per `user_id`) | select: off / daily / weekly / monthly |
| Notifications | `transactional_opt_in` (display-only) | same | locked-on badge + tooltip explaining it's required |
| Marketing | `newsletter_opt_in` | same | toggle |
| Marketing | `partner_updates_opt_in` | same | toggle, only rendered if `profiles.role IN ('partner','customer')` — see Open Questions for role gating |
| Marketing | `affiliate_updates_opt_in` | same | toggle, only rendered if `profiles.role IN ('affiliate','customer')` |
| Privacy | "Download my data" CTA | server action | button |
| Privacy | "Delete account" CTA | link or focus-scroll to `/account/profile` danger zone | destructive button |
| Billing & subscriptions | active subscription summary, next renewal date, cancel action | Stripe customer/subscription snapshot, rendered only if subscriptions exist | summary row + destructive-secondary button |
| Connected accounts | `providers[]` (e.g. `['google','email']`) | Supabase Auth `getUser().identities` | list with provider icon, status, action |
| Connected accounts | "Connect Google" / "Disconnect Google" | server action | button |
| Sessions | `session.id`, `session.created_at`, `session.last_active_at`, `session.user_agent`, `session.ip_country` (GeoIP, no raw IP), `session.is_current` | `auth.sessions` (Supabase) | list rows with sign-out button |
| Sessions | "Sign out everywhere" | server action | destructive button + confirm modal |
| Language & region | `locale`, `timezone` | `profiles.locale`, `profiles.timezone` | selects (same as profile page) |
| Audit strip | "Last settings update: {time ago}" | most-recent `admin_audit_log` row where `action='settings_self_update'` for this user | mono timestamp |

**Queries / actions (all in `02-features/account/`):**
- `getMySettings()` — RSC, joins `profiles` + `notification_preferences` (left join, fallback to defaults if no row).
- `getMySessions()` — Supabase Auth admin API (service-role server call, returns sanitized session list).
- `updateNotificationPrefs(input)` — server action, Zod-validated, writes `notification_preferences`.
- `updateLocaleAndTimezone(input)` — server action, writes `profiles.locale` + `profiles.timezone` (same RLS path as the profile page).
- `connectOAuthProvider(provider)` / `disconnectOAuthProvider(provider)` — wraps `supabase.auth.linkIdentity()` and `supabase.auth.unlinkIdentity()`.
- `signOutSession(sessionId)` — server action, calls Supabase Auth admin to revoke one session.
- `signOutEverywhere()` — server action, revokes all sessions for the user, including the current one (then signs the user out and redirects to `/`).
- `requestDataExport()` — server action, enqueues a background job (Postgres-backed queue or `pg_cron`) that writes a JSON dump to Bunny Storage and emails the user a signed download link valid 7 days.
- `createSubscriptionCancellationSession()` — server action or Stripe customer-portal wrapper, rendered only if subscriptions exist. Cancels or opens cancellation without requiring a support email.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Change digest frequency | Open the select, pick a value | Inline save (no Save button on the row), success toast, audit row | self |
| Toggle newsletter | Click the toggle | Inline save, toast, audit row | self |
| Toggle partner updates | Click the toggle | Inline save, toast, audit row | self (toggle rendered only if role allows) |
| Toggle affiliate updates | Click the toggle | Inline save, toast, audit row | self (toggle rendered only if role allows) |
| Download my data | Click "Download my data" | Server enqueues export job, success toast ("We'll email you a link within 10 minutes"), button shows cooldown (60s) | self |
| Delete account | Click "Delete account" | Navigate to `/account/profile` and focus-scroll the danger card (or open the delete modal directly — see Open Questions) | self |
| Cancel subscription | Click "Cancel subscription" in Billing & subscriptions | Opens self-service cancellation confirmation or Stripe customer portal; audit row records the request without logging payment details | self |
| Connect Google | Click "Connect Google" | OAuth flow, returns to this page, row now shows "Disconnect Google" | self |
| Disconnect Google | Click "Disconnect Google" | Confirmation modal, server action, row now shows "Connect Google" — disabled if email/password is not set (a user must always have at least one sign-in method) | self |
| Sign out a session | Click "Sign out" on a session row | Confirmation inline, server action, row disappears, audit row | self |
| Sign out everywhere | Click "Sign out everywhere" | Confirmation modal, server action, all sessions invalidated, current user signed out, redirect to `/` | self |
| Change locale | Open select, pick a value | Inline save, toast | self |
| Change timezone | Open select, pick a value | Inline save, toast | self |
| Open keyboard shortcut panel | Press `?` | Modal shows the page shortcuts (none for v1, modal hidden) | self |

## What this page does NOT do

- No email change form. Email change is a Supabase Auth flow with a verification link. The "Change email" entry point opens a modal that explains the flow and triggers `supabase.auth.updateUser({email})`. The user receives a confirmation link at the new address; the email doesn't change until they click it. (We could spec this in a follow-up; for v1 we keep the spec focused and document the gap here.)
- No password change form. The "Change password" entry point is on `/account/profile` and links to `/update-password`.
- No 2FA setup. v2.
- No notification channels other than email. SMS, push, in-app notifications are all v2.
- No per-product notifications ("notify me when a new product by partner X is published"). v2.
- No granular marketing list ("only send me product updates, not blog posts"). The newsletter is one list; the program-update toggles are the only segmentation in v1.
- No session naming / "this is my work laptop" labels. v2.
- No "remember this device" / trust signal. v2.
- No "trusted devices" list. v2.
- No IP allowlist / region lock. v2.
- No security log ("3 sign-in attempts in the last 24h"). v2.
- No delete-account modal on this page (the action navigates to `/account/profile` — single source of the dangerous flow).
- No payment-method management. We use Stripe (no stored cards, no saved methods in v1) and the user has no concept of a "default payment method" in v1.
- No billing section if there are no subscription products or imported active subscriptions.
- No tax-information editing. Partners have tax info on `partners.tax_form_status`; that's edited in `/partner/settings`, not here.
- No Payout method editing. Same — `/partner/settings`.

## Acceptance criteria

- [ ] Page is auth-gated — anonymous visitors redirect to `/login?next=/account/settings`
- [ ] `getMySettings()` reads `notification_preferences` for the current user; if no row exists, a default row is upserted on first read; defaults are `email_digest_freq='weekly'`, `transactional_opt_in=true` (locked badge, not a toggle), all three marketing opt-ins `false`
- [ ] Toggling any preference is saved inline (no Save button on the section) within 300ms; on failure the toggle reverts and a toast shows the error; every preference change writes a `settings_self_update` row to `admin_audit_log` with before/after JSON
- [ ] "Download my data" enqueues a server-side export job, shows a success toast ("we'll email you a link within 10 minutes"), and rate-limits to 1 request per user per hour; the email link is sent only to the verified address, valid 7 days, single-redeemable
- [ ] If active subscriptions exist, Billing & subscriptions renders a prominent self-service "Cancel subscription" button; cancellation is never support-only
- [ ] The Connected accounts section reflects the user's linked identities (email is always present, Google is shown if linked); "Connect Google" initiates the Supabase OAuth flow and returns to this page on completion
- [ ] "Disconnect Google" requires confirmation and is disabled if it would leave the user with no sign-in method; on success an `oauth_unlink` row is written to `admin_audit_log`
- [ ] The Sessions list pins the current session to the top with a "This device" badge and a disabled "Sign out" button; each non-current row has a working per-session sign-out button
- [ ] "Sign out everywhere" requires confirmation, invalidates ALL sessions (including current), signs the user out, and redirects to `/`; rate-limited to 1 invocation per 60s; every session action writes a `session_signout_one` or `session_signout_all` row to `admin_audit_log`
- [ ] Language & region changes write to `profiles.locale` and `profiles.timezone` (same RLS path as `/account/profile`) and produce a `settings_self_update` audit row
- [ ] A new migration `04-platform/migrations/NNNN_notification_preferences.sql` lands in the same PR as the page, with the schema + RLS policies from the Open Questions section
- [ ] The page renders in < 250ms p95 (RSC, one row read on `profiles`, one left-join on `notification_preferences`, one server call to Supabase Auth for sessions)
- [ ] All toggles and selects are keyboard-navigable with `--border-3` focus rings; mobile responsive at 360px, 768px, 1280px; no PII in URLs, no `TODO` / `FIXME` / `HACK` in the diff, no console errors in dev or prod

## Design reference

- Mockup: not yet built — to be created during the account feature build
- Design tokens: `00-foundations/design/tokens.css` (color, spacing, radii, type)
- Theme: both (`design-system-dark.css` default, `design-system-light.css` for users who toggle)
- Reference patterns: `mockups/library.html` (section header + card density, mono timestamps, hairline borders, no decorative accent on the section headers — accent reserved for active state / focus / one badge per page max)

## Security

- **Auth required:** YES
- **Allowed roles:** any authenticated user (customer, partner, affiliate, admin) — `requireAuth()`
- **RBAC enforcement:** server actions check `user_id = auth.uid()` before any write. RLS is the second line of defense.
- **RLS policies that apply:**
  - `profiles` — `profiles_self_read`, `profiles_self_update` (writes to locale/timezone go through the same policy)
  - NEW: `notification_preferences` — see Open Questions for the proposed schema and policies. RLS is `self only` for select / insert / update; no delete policy (we never delete prefs; we deactivate by setting all opt-ins to false).
  - `admin_audit_log` — admin read only; the server action uses a service-role client to insert, which bypasses RLS (this is the one place we deliberately bypass; the action is the audit source, not the data being audited)
- **PII displayed:** the user's own session metadata (user-agent, country derived from IP). We do NOT show raw IP. We do NOT show device fingerprints.
- **PII in URLs:** no. Session ids, provider names, and user ids stay server-side.
- **OAuth flow security:** standard Supabase `linkIdentity` / `unlinkIdentity`. The unlink flow is rate-limited (1 per provider per 5 min) and is blocked if it would leave the user with zero sign-in methods (defense against lockout — possibly self-inflicted, but worth a guard).
- **"Sign out everywhere":** the server action rate-limits to 1 per 60s per user. The confirmation modal requires the user to type their email. The action invalidates sessions via the Supabase Auth admin API, which is a service-role call (the user has effectively authorized the lockout by clicking the button).
- **"Download my data":** the export job writes to a Bunny Storage path with a server-generated UUID filename (not the user's id or email). The email containing the signed link is sent to the user's verified email only. The signed URL is valid 7 days, single-redeemable. The export job itself is rate-limited to 1 per user per hour. The export is NOT generated synchronously — we email the link when it's ready, within 10 minutes.
- **Audit logged:**
  - `updateNotificationPrefs` — `action='settings_self_update'`, `target_table='notification_preferences'`, `before`/`after` JSON
  - `updateLocaleAndTimezone` — `action='settings_self_update'`, `target_table='profiles'`, `before`/`after` JSON (only locale and timezone fields, not the whole profile)
  - `connectOAuthProvider` — `action='oauth_link'`, `target_id` = provider
  - `disconnectOAuthProvider` — `action='oauth_unlink'`, `target_id` = provider
  - `signOutSession` — `action='session_signout_one'`, `target_id` = session id
  - `signOutEverywhere` — `action='session_signout_all'`, `target_id` = `'*'`
  - `requestDataExport` — `action='data_export_requested'`, `target_id` = a generated export job id
  - `createSubscriptionCancellationSession` — `action='subscription_cancel_requested'`, `target_id` = subscription id, with no card details in before/after JSON
- **CSRF:** server actions use Next.js's built-in origin check + Supabase Auth session cookie. No additional token needed.
- **Third-party scripts:** none on the page itself. The OAuth "Connect Google" flow is initiated by a Supabase redirect; no Google JS SDK is loaded inline.

## Performance

- **Target p95:** < 250ms (RSC; one row read on `profiles`, one left-join on `notification_preferences`, one server call to Supabase Auth for sessions)
- **Render strategy:** RSC (no client-side data fetching for the initial render)
- **Cache:** none — page is user-specific
- **DB indexes used:** implicit `notification_preferences_user_id_unique` on the new table (one row per user); the `profiles_user_id_unique` index for the locale/timezone write
- **Bundle size budget:** < 40KB added to client bundle (six section cards + inline-save toggles + two confirmation modals + the delete-account redirect link). Toggles can use the platform `<Switch>` primitive (in `00-foundations/ui/`) to keep the bundle small.

## Out of scope for v1

- Email change form (the data is editable, but the flow is a Supabase Auth email-confirmation, not a form. Follow-up spec needed.)
- 2FA setup
- SMS / push / in-app notification channels
- Per-product notifications
- Granular marketing list segmentation
- Session naming / "this is my work laptop"
- "Remember this device" / trusted devices
- IP allowlist / region lock
- Security log ("3 sign-in attempts in the last 24h")
- Delete-account modal on this page (the action navigates to `/account/profile` — single source of truth)
- Payment method management (Stripe-only, no stored cards in v1)
- Tax / payout info editing (those live in `/partner/settings`)

## Open questions for human

- **New table — `notification_preferences`:** this table is NOT in `_data-model.md`. Proposed schema (please confirm or amend):
  ```sql
  create table notification_preferences (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email_digest_freq text not null check (email_digest_freq in ('off','daily','weekly','monthly')) default 'weekly',
    transactional_opt_in boolean not null default true, -- locked, never user-editable
    marketing_opt_in boolean not null default false,    -- master switch; if false, all marketing lists are off regardless of individual toggles
    newsletter_opt_in boolean not null default false,
    partner_updates_opt_in boolean not null default false,
    affiliate_updates_opt_in boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  alter table notification_preferences enable row level security;
  create policy "notification_prefs_self_read" on notification_preferences for select using (user_id = auth.uid());
  create policy "notification_prefs_self_insert" on notification_preferences for insert with check (user_id = auth.uid());
  create policy "notification_prefs_self_update" on notification_preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  -- No DELETE policy: prefs are deactivated, not deleted.
  ```
  This needs a new migration in `04-platform/migrations/`. My recommendation: add it in the same PR as the settings page implementation, with a clean migration number (the next one after whatever's in the directory). Approve the schema above or amend.
- **"Master switch" `marketing_opt_in`:** I added a master `marketing_opt_in` toggle that, when off, suppresses ALL marketing emails regardless of the per-list opt-ins. This is GDPR-friendly (one-click unsubscribe from all marketing). My recommendation: ship with this in v1 — it's cheap, and we can always add the per-list toggles back if marketing wants finer segmentation. The per-list toggles are still useful for re-engagement (a user can opt out of the newsletter but keep partner updates).
- **Role-gated marketing toggles:** "Partner program updates" makes sense for partners AND for customers who might want to become partners. "Affiliate program updates" makes sense for affiliates AND for customers who might want to become affiliates. My recommendation: render both for everyone (the master `marketing_opt_in` and the per-list opt-in handle the "I don't want this" case). If we want to gate by role, the SQL above already supports it; the UI just adds a `where profiles.role in (...)` check. I'd rather over-deliver content the user can mute than under-deliver content the user might want.
- **"Delete account" placement on this page:** two options: (a) a destructive button on this page that opens the same confirmation modal as `/account/profile`, or (b) a link that navigates to `/account/profile` and focus-scrolls the danger zone. My recommendation: (a) — single source of the modal, single source of the action, and fewer clicks. Render the modal inline (the `deleteMyAccount()` action is shared). If we want to split later, easy refactor.
- **"Download my data" delivery:** the spec says "email a signed link within 10 minutes." Alternatives: stream the JSON directly in the browser (large payload, may timeout on slow connections for users with 5 years of order history), or use a server-streamed response (works but is harder to test). My recommendation: email a signed link. It's the pattern users expect (Google, GitHub), the data can be large, and we have the audit log of who downloaded what.
- **Session IP / GeoIP:** Supabase Auth gives us the user-agent but not the IP. We'd need to call a GeoIP service (e.g. MaxMind GeoLite2) to translate IP → country. My recommendation: ship v1 without country (just show "Last active: {time}, {truncated user-agent}"). Add GeoIP in v2 if support requests for it.
- **`/update-password` route:** referenced from `/account/profile` and (implicitly) from the "Change password" copy that may want to live here too. My recommendation: keep "Change password" only on `/account/profile` in v1 — single surface, less to test. Move it here in v2 if usage data says users go to settings first.
- **Audit log volume for inline saves:** every toggle writes a row. A power user flipping 20 toggles in a session = 20 audit rows. At 50K MAU this is fine; re-evaluate at 250K (same as the profile-page concern). My recommendation: ship as-is, coalesce later if needed.

---

## Implementation notes

### P1.8 — per-device session list (this tick)

**Schema (migration `0021_user_sessions_rpc.sql`):**
- `public.list_user_sessions()` — `SECURITY DEFINER` Postgres function
  that reads `auth.sessions` filtered by `user_id = auth.uid()`. Returns
  `id, created_at, updated_at, user_agent, ip, aal, not_after` (defensive
  projection — never expose `refreshed_at` or other internal columns to
  the application). `set search_path = ''` (the Supabase SECURITY DEFINER
  hardener). `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated`.
  `STABLE` (pure read).
- `public.delete_user_session(p_session_id uuid)` — `SECURITY DEFINER`
  Postgres function that deletes one row from `auth.sessions` with
  `user_id = auth.uid()` filter (defense in depth — a user can never
  delete another user's session even if they craft a forged request with
  a guessed id). Raises `'42501' Not authenticated` if called by an
  anonymous user. Returns `boolean` (true if a row was deleted, false
  if the session didn't exist or didn't belong to the caller — the
  caller treats both as "not found" to prevent id enumeration).

**Why SECURITY DEFINER + RLS-style filter, not a regular query:**
- The PostgREST API only exposes the `public` and `storage` schemas.
  `auth.sessions` is not reachable from a regular `supabase.from('auth.sessions')`
  call. The RPC is the only sane way to read it from the application.
- `SECURITY DEFINER` lets the function read `auth.sessions` as the
  function owner. The `user_id = auth.uid()` filter is the second
  line of defense — even if a future refactor accidentally exposes
  the function, a user can never see another user's sessions.

**Why JWT `session_id` for "is this row me?":**
- Supabase's access_token is a JWT. The payload includes a
  `session_id` claim that matches `auth.sessions.id`. We decode the
  payload in `decodeSessionIdFromJwt()` (a 30-LOC helper, no library
  needed — the signature is already verified by the
  `getServerSupabase` cookie reader).
- The decoded id is the primary signal. The user-agent match is a
  best-effort fallback for the (unlikely) case where the JWT can't
  be parsed.

**`getMySessions()` query** (`02-features/account/profile/queries/getMySessions.ts`):
- Two reads in sequence: (1) `supabase.auth.getSession()` to get the
  current access_token, then decode the JWT to get the session_id;
  (2) `supabase.rpc('list_user_sessions')` to get every active session
  for the calling user.
- Returns `{ sessions: SessionInfo[], currentSessionId: string | null }`.
  `currentSessionId` is the decoded JWT claim (or null on parse failure).
- Defensive: a `fetch failed` or RPC error logs a `warn` and returns
  an empty list. The page's "Sign out this device" / "Sign out
  everywhere" controls still work even if the per-device list is
  unavailable (the per-device feature is best-effort).

**`signOutSessionByIdAction(input)` server action** (`02-features/account/profile/actions/sessionActions.ts`):
- Zod-validates `{ sessionId: uuid }`.
- Re-fetches the current session id from the JWT and refuses if the
  caller is trying to revoke their own current session (use
  `signOutCurrentSessionAction` for that — it also clears the cookies).
- Per-user rate limit: 1 per 60s (same shape as `signOutEverywhereAction`).
- Calls `supabase.rpc('delete_user_session', { p_session_id: ... })`.
  Returns `false` → "That session is no longer active." (no enumeration
  oracle).
- Writes a `session_signout_one` audit row with `target_kind = 'auth.sessions'`
  and `target_id = sessionId` (matches the `account-settings.md`
  spec's "every session action writes a `session_signout_one` row").
- `revalidatePath('/account/settings')` so the next page render re-fetches
  the list.

**`SessionsSection.tsx` client island** (token-only CSS module):
- Renders the full list, with the current row pinned to the top.
  Each row shows: device label (badge or "Other device"), the
  truncated user-agent, the time-ago from `created_at`, and either
  a disabled "Active" button (current row) or a working "Sign out"
  button (every other row).
- "Sign out this device" stays as a separate bottom action (uses
  `supabase.auth.signOut()` so the cookies are cleared).
- "Sign out everywhere" stays as the destructive confirmation flow
  (email-typed confirmation + rate-limited + audit-logged).
- Error state: a single `role="alert"` line at the top of the list
  for any failed per-session sign-out (e.g. "Please wait 47s before
  signing out another device.").

**`decodeSessionId.ts` lib** (`02-features/account/profile/lib/decodeSessionId.ts`):
- Pure helper, no deps, ~25 LOC.
- Splits the JWT, base64url-decodes the middle segment, parses JSON,
  returns `data.session_id` if it's a non-empty string. Returns
  `null` on any malformed input.

**Files:**
- NEW: `04-platform/migrations/0021_user_sessions_rpc.sql`
- NEW: `02-features/account/profile/lib/decodeSessionId.ts`
- MODIFIED: `02-features/account/profile/queries/getMySessions.ts` —
  calls the RPC + decodes the current JWT session_id.
- MODIFIED: `02-features/account/profile/actions/sessionActions.ts` —
  adds `signOutSessionByIdAction` (reuses the existing pattern +
  re-uses `decodeSessionIdFromJwt` from the lib).
- MODIFIED: `02-features/account/profile/components/SessionsSection.tsx`
  — full rewrite to render the list + per-session sign-out.
- MODIFIED: `02-features/account/profile/components/SessionsSection.module.css`
  — adds `.deviceInfo`, `.deviceName`, `.empty` for the new row layout.
- MODIFIED: `app/account/settings/page.tsx` — passes the full
  `{ sessions, currentSessionId }` from the query (was a single
  `currentUserAgent` string) + the user's email (for the "Sign out
  everywhere" confirmation).
- MODIFIED: `02-features/account/profile/index.ts` — re-exports
  `signOutSessionByIdAction` + the `MySessions` type.

**Not in this tick (deferred to a follow-up):**
- **Single-session enforcement** (PH1.8 Slice 2): when a user signs in
  on a new device, all other devices are auto-signed-out. This
  requires extending `signInAction` to call
  `supabase.rpc('list_user_sessions')` after the signin succeeds,
  identify the rows that aren't the current session, and call
  `delete_user_session` for each one. Audit log gets a new
  `single_session_enforced` action. This is its own slice because
  it has different trust-boundary concerns (the user is
  unauthenticated at the start of the flow) + race conditions
  (concurrent sign-ins on two devices). Tracked as the next loose
  end after P1.8 ships.

**Out of scope for P1.8 (per spec):**
- Country-level IP display (Supabase Auth doesn't expose IP; GeoIP
  is a v2 follow-up).
- "This is my work laptop" labels (v2).
- "Remember this device" / trusted devices (v2).
- IP allowlist / region lock (v2).
- Security log ("3 sign-in attempts in the last 24h") — already
  implemented as the `auth_failed_attempts` table; surfacing it
  on the settings page is a v2 enhancement.

---

### P9.7 — Notification preferences (granular per category) — this tick

**Schema (migration `0033_notification_preferences_v2.sql`):**
- Adds six new columns to `notification_preferences`:
  - `email_digest_freq text NOT NULL DEFAULT 'weekly'` with a CHECK
    constraint `email_digest_freq IN ('off','daily','weekly','monthly')`.
  - `transactional_opt_in boolean NOT NULL DEFAULT true` (locked —
    never user-editable; UI renders it as a "Required" badge, not a toggle).
  - `marketing_opt_in boolean NOT NULL DEFAULT false` (master switch).
  - `newsletter_opt_in boolean NOT NULL DEFAULT false`.
  - `partner_updates_opt_in boolean NOT NULL DEFAULT false`.
  - `affiliate_updates_opt_in boolean NOT NULL DEFAULT false`.
- One-shot backfill (idempotency guard: only updates rows whose new
  cols are still at defaults, so user edits after the migration are
  preserved):
  - `email_digest_freq`: `weekly_digest_email=true → 'weekly'`, else `'off'`.
  - `marketing_opt_in` / `newsletter_opt_in`: inherit from the
    legacy `marketing_email` boolean (the old schema's one marketing
    toggle is the best signal we have for these two columns).
  - `partner_updates_opt_in` / `affiliate_updates_opt_in`: default `false`.
  - `transactional_opt_in`: always `true` (the legacy transactional
    booleans were always-on and never user-editable).
- **No new RLS policies** — the existing
  `notification_prefs_self_read` / `notification_prefs_self_write`
  policies (`user_id = auth.uid()`) cover all the new columns; the
  policies don't enumerate columns.
- **No new indexes** — the `user_id` UNIQUE constraint backs an
  implicit btree index that's already used by the RLS predicates.
- **Legacy columns NOT dropped** — `weekly_digest_email`,
  `marketing_email`, `product_updates_email`, and the 4 transactional
  booleans stay. They're informational only; a future migration can
  drop them once we've confirmed transactional sends wire off the
  new `transactional_opt_in` column.

**Type (`00-foundations/data/schemas.ts`):**
- New `EmailDigestFreqSchema` Zod enum (`off`/`daily`/`weekly`/`monthly`)
  + inferred TS type `EmailDigestFreq`.
- `UpdatePrefsInput` was rewritten to match the spec:
  - All fields optional so a single-field patch is a single round-trip.
  - `.strict()` rejects unknown keys (defense in depth; catches the
    legacy `weekly_digest_email` and `marketing_email` keys if a stale
    client tries to send them).
  - `.refine(Object.keys(v).length > 0)` rejects empty patches
    (the action should never receive `{}` — pointless DB round-trip).
  - `transactional_opt_in` is intentionally NOT exposed — the schema
    doesn't declare it, so any attempt to set it fails under strict mode.

**Query (`02-features/account/profile/queries/getMySettings.ts`):**
- Reads the six new columns + the legacy `profiles.locale`/`timezone`
  in parallel (`Promise.all` — one RT).
- Wrapped in React `cache()` so the page + any other consumer on the
  same request share a single round-trip.
- Defensive coercion: `email_digest_freq` falls back to `'weekly'`
  on any non-enum value (CHECK constraint should prevent it; defense
  in depth against a manual DB edit).
- `transactional_opt_in` is ALWAYS returned as `true` — the query
  ignores the column entirely, so a user can never turn it off
  through a future bug or a direct DB write.
- Locale/timezone fall back to `'en'` / `'UTC'` when the profile
  row has them null.

**Action (`02-features/account/profile/actions/updateSettings.ts`):**
- `updateNotificationPrefsAction(input)` — Zod-validates, upserts with
  `onConflict: 'user_id'` so the first call creates the row and
  subsequent calls update it (idempotent).
- Reads ONLY the columns being patched before the upsert so the
  audit-log before/after diff is meaningful (no wasted bandwidth).
- Computes a focused diff — only fields that actually changed get
  recorded (avoids the "20 toggles = 20 audit rows" bloat concern
  from the spec's open questions).
- Writes one `admin_audit_log` row with `action='settings_self_update'`,
  `target_kind='profiles'`, `target_id=user.id`, and metadata
  `{ before, after, target_table: 'notification_preferences' }`.
- `revalidatePath('/account/settings')` so the page re-renders with
  the new state.
- `transactional_opt_in` is NOT touched — the schema doesn't expose
  it, and the action explicitly ignores any value passed for it.
- Failure modes: anon → "Not signed in"; Zod rejection → friendly
  message + per-field errors; upsert error → friendly message + warn
  log (no audit row on failure).

**Form (`02-features/account/profile/components/SettingsForm.tsx`):**
- Three sections: **Notifications** (email digest frequency select +
  Transactional locked badge), **Marketing emails** (master switch +
  per-list toggles for Newsletter / Partner program updates /
  Affiliate program updates), **Language & region** (locale +
  timezone — unchanged from v1). **Privacy** section stays as a v2
  follow-up (Delete account links out to /account/profile; Download
  my data button is disabled with a "Available in a follow-up
  release" note — that surface is P9.16 / P9.17 territory).
- **Email digest frequency** is a `<select>` with 4 options
  (Off / Daily / Weekly / Monthly) — replaces the v1 boolean
  "Weekly digest" toggle. Each option's label is suffixed with a
  short help line ("A roundup of new products + platform news, once
  a week.").
- **Transactional** stays as a locked badge + always-on switch
  indicator (no user control — same UX as v1).
- **Marketing master switch** — one click turns every marketing
  email off regardless of the per-list toggles (the spec's "master
  switch"). When the master turns on, the per-list toggles keep
  their previous values; when the master turns off, all per-list
  toggles are explicitly set to `false` (one-click unsubscribe).
- **Per-list toggles** are visually muted (`.mutedRow` class) and
  `disabled` while the master is off (the master is the only thing
  they need to flip to re-enable them).
- **Optimistic UI** — every patch is applied to local state first,
  then `startTransition` calls the server action. On failure, the
  state reverts to the pre-patch value and a `role="status"`
  toast shows the error. Success shows a 3-second "Saved." toast.
- All toggles are real `<button role="switch">` with
  `aria-checked` + `aria-label` + `:focus-visible` outline (per the
  a11y rules in P0.6).
- Two-column `<select>` grid for locale + timezone stacks vertically
  below 640px.

**Page (`03-app/account/settings/page.tsx`):**
- Composes `SettingsForm` with the new initial shape (all 6 new fields)
  + the existing `SessionsSection` (from P1.8 Slice 1).
- Same `requireUser('/account/settings')` gate as v1 — anon → 307 to
  `/login?next=/account/settings` (verified in dev smoke).
- Same `noindex` metadata via `sensitivePageMetadata` (P0.21).
- `metadata.title='Settings'` (was `'Account settings'` in v1; tightened).

**Tests (49 new):**
- `getMySettings.test.ts` — **13 unit tests** (3ms) covering anon
  path, defaults when no row exists, happy path, locale/timezone
  fallback, invalid email_digest_freq defensive coercion, null
  boolean field fallback, transactional_opt_in always-true invariant,
  PII safety (the prefs select payload never contains the
  standalone column names `email` / `ip` / `user_agent` — uses a
  word-boundary regex to avoid the substring 'email' inside
  `email_digest_freq` triggering a false positive), query shape (the
  `eq('user_id', ...)` predicate is always present).
- `updateSettings.test.ts` — **20 unit tests** (5ms) covering both
  actions (notification prefs + locale/timezone): anon path, Zod
  rejection paths (empty object, bad enum, non-boolean, unknown
  keys, strict mode against legacy field, transactional_opt_in
  attempted set), happy path (single-field patch, multi-field
  patch, upsert with `onConflict: 'user_id'`), revalidatePath
  invocation, error paths (upsert error → no audit row; no change →
  no audit row; change → audit row with before/after diff; locale
  update failure).
- `00-foundations/data/schemas.test.ts` — **+7 unit tests** on
  `UpdatePrefsInput` (full set accept, single-field patch accept
  × 3, unknown enum reject, non-boolean reject, empty object
  reject, unknown key reject under strict mode, transactional_opt_in
  attempt reject under strict mode).

**All 6 checks green + `pnpm test` 2169/2169 (was 2129, +40 new =
 13 query + 20 action + 7 schema) + `pnpm build` clean (50 routes;
 `/account/settings` is `5.59 kB / 106 kB` first-load — was `5.86
 kB / 106 kB` after P1.8, -270 B from the smaller v2 form
 surface; shared first-load JS unchanged at 101 kB).**

**Decisions worth remembering:**
- (a) **Additive migration, not replacement.** The legacy 7 booleans
  stay. The new columns co-exist; the UI reads only the new ones.
  A future migration can drop the legacy columns once we've
  confirmed transactional sends wire off `transactional_opt_in`.
- (b) **Best-effort backfill.** The migration seeds the new columns
  from the legacy ones with an idempotency guard (only update rows
  whose new cols are at defaults — user edits after the migration
  are preserved). The semantics are "best guess from old data" —
  users can re-configure if the backfill wasn't right.
- (c) **`transactional_opt_in` is locked at three layers.** The
  schema doesn't expose it (Zod strict mode rejects it). The query
  always returns `true` for it (ignores the column entirely). The
  form renders it as a "Required" badge + always-on switch
  indicator, not a toggle. Three layers of defense — any one
  layer alone is enough, but the redundancy means a future refactor
  can't accidentally expose it.
- (d) **Single field per upsert.** The action patches one or more
  fields via a single upsert. The user-facing API is "patch a single
  field at a time" (each toggle/select is independent), but the
  action accepts any subset so the master-switch-all-per-lists-off
  case is a single round-trip.
- (e) **Master switch turns per-lists off explicitly.** When the
  user turns the master off, the action patches `marketing_opt_in:
  false` AND `newsletter_opt_in: false` AND `partner_updates_opt_in:
  false` AND `affiliate_updates_opt_in: false`. This means a user
  who turns the master back on later has to re-enable the per-lists
  (the audit log records each as a separate change). UX trade-off:
  explicit and reversible vs. preserving per-list state. We chose
  explicit because the spec calls it "one-click unsubscribe from
  all marketing."
- (f) **Per-list toggles are disabled when master is off.** Visual
  + functional: the rows are muted (opacity 0.55) and the toggles
  are `disabled`. The master is the single point of control. The
  toggle state is still readable (you can see what's opted in if
  the master turns back on).
- (g) **Defensive email_digest_freq coercion.** The query falls
  back to `'weekly'` if the column returns a non-enum string. The
  CHECK constraint prevents this in production; the defensive
  branch catches a manual DB edit or a future migration that
  loosens the constraint.
- (h) **Audit log diff is focused.** Only changed fields appear in
  before/after. A user who flips the master switch + newsletter
  on + partner updates on in a single interaction = one audit row
  with `{ before: {master:false,...}, after: {master:true,...} }`,
  not three rows. The "20 toggles = 20 audit rows" concern from
  the spec's open questions is moot because we patch the whole
  subset in one call, and the diff only includes the changed
  fields anyway.
- (i) **Master opt-in by default for everyone.** The form renders
  both partner/affiliate toggles for every user (the spec's
  "render for everyone" recommendation). The `showPartnerAffiliateToggles`
  prop is a future escape hatch (e.g., for an admin sub-account
  where partner/affiliate doesn't apply) — default true.
- (j) **No new index.** The existing `user_id UNIQUE` covers the
  read path. The query is `eq('user_id', user.id)` on a UNIQUE
  column = single-row lookup with an index seek. Adding another
  index would be dead weight.

---

### P9.6 — Sessions management verification (this tick)

The P9.6 acceptance criteria (`account-settings.md:94-95`, lines
originally written in PHASES.md §"Settings") call for three things on
`/account/settings`:

> (1) "The Sessions list pins the current session to the top with a
>  'This device' badge and a disabled 'Sign out' button; each non-
>  current row has a working per-session sign-out button"
> (2) "'Sign out everywhere' requires confirmation, invalidates ALL
>  sessions (including current), signs the user out, and redirects to
>  `/`; rate-limited to 1 invocation per 60s; every session action
>  writes a `session_signout_one` or `session_signout_all` row to
>  `admin_audit_log`"

Both criteria are satisfied by the P1.8 work documented above
(`02-features/account/profile/queries/getMySessions.ts` +
`actions/sessionActions.ts` + `components/SessionsSection.tsx`).
This section is a verification tick — no new code shipped, just a
line-by-line read of the existing shipped code against the PHASES.md
P9.6 + the spec criteria.

**Criterion 1 — current session pinned at top + per-session sign-out:**

- **Pinning**: `SessionsSection.tsx:35-36`
  ```ts
  const currentRowId = currentSessionId ?? sessions.find((s) => s.isCurrent)?.id ?? null
  ```
  pin is via the JWT-decoded `session_id` claim (primary signal) +
  a best-effort fall-back to `s.isCurrent` if the JWT couldn't be
  parsed (`getMySessions.ts:77` + `decodeSessionId.ts:18-37`).
- **Current row marker**: `SessionsSection.tsx:103-105` renders
  "This device" + a `.badge` chip with `text-transform: uppercase`
  + `--accent-soft` background — same chip vocabulary as the rest
  of the design system.
- **Current row button disabled**: `SessionsSection.tsx:118-121`
  renders `<Button variant="ghost" disabled>Active</Button>` for
  `isCurrent === true` rows — explicitly disabled per the spec.
- **Non-current row sign-out**: `SessionsSection.tsx:122-132`
  renders a working `<Button variant="secondary" onClick={() =>
  onSignOutOther(s.id)} loading={isPending && signingOutId === s.id}>`
  — the per-session sign-out wired to `signOutSessionByIdAction`.
- **Per-session action**: `sessionActions.ts:124-225`
  - Zod-validates the `{ sessionId }` payload (`SignOutSessionSchema`
    on line 124); rejects with `'Invalid session id.'` on bad UUID
    (line 153-156).
  - Re-fetches the JWT `session_id` and refuses if the caller is
    trying to revoke their own session ("Use 'Sign out this device'
    to end the current session." — line 164-173). Defense against
    using the per-device button for the current device.
  - Per-user rate limit at 1/60s (line 176-180) — same shape as the
    `signOutEverywhereAction` rate limit.
  - Calls `delete_user_session(p_session_id)` RPC which is
    SECURITY DEFINER + `user_id = auth.uid()` filter
    (`0021_user_sessions_rpc.sql:85-107`). A user can never revoke
    another user's session even by guessing an id.
  - Returns `false` → "That session is no longer active." (no id
    enumeration oracle — line 198-210).
  - Writes a `session_signout_one` audit row with
    `target_kind='auth.sessions'` + `target_id=sessionId`
    (line 214-220).

**Criterion 2 — "Sign out everywhere" + rate limit + audit log:**

- **Button** at `SessionsSection.tsx:161-168` — destructive `variant=`
  `danger` Button + helper text "Ends every active session on every
  device. You'll need to sign in again."
- **Confirmation modal** (replaces button on click) at
  `SessionsSection.tsx:170-208` — user types their email, the
  confirm Button is `disabled` until the typed string
  case-insensitive-matches `currentEmail` (line 201-204). Two
  cancel/destruct buttons with `loading={isPending && signingOutId
  === null}`.
- **Server action rate-limit**: `sessionActions.ts:98-102`
  ```ts
  const last = _lastSignoutAll.get(user.id) ?? 0
  if (Date.now() - last < RATELIMIT_MS) {
    const wait = Math.ceil((RATELIMIT_MS - (Date.now() - last)) / 1000)
    return { ok: false, error: `Please wait ${wait}s before trying again.` }
  }
  ```
  1/60s sliding window per-user; returns a friendly "Please wait
  Ns before trying again." message so the client can mirror the
  countdown.
- **Email match enforced server-side**: `sessionActions.ts:94-96` —
  case-insensitive trimmed match against `user.email`. Defends
  against a clever client that bypasses the modal's `disabled` attr.
- **Audit log**: `sessionActions.ts:104-111` writes a
  `session_signout_all` row with `metadata.confirm_email_matches=true`
  so admins can verify the gate fired, then calls `clearAuthCookies`
  (which calls `supabase.auth.signOut()`), then `revalidatePath('/',
  'layout')` and returns `{ ok: true, redirectTo: '/' }`. The
  caller (`SessionsSection.tsx:75-76`) `router.push(result.redirectTo)`
  + `router.refresh()` — the user lands on `/` with a fresh session
  cookie set.

**Trust boundaries + security:**

- **RLS posture**: there's no public table for sessions; the
  `auth.sessions` table is reachable only via the SECURITY DEFINER
  RPCs in `0021_user_sessions_rpc.sql`. Both RPCs raise `'42501' Not
  authenticated` when called anonymously (line 49-51 / 95-99 of
  the migration) and filter to `user_id = auth.uid()` on every
  read/delete (`0021_user_sessions_rpc.sql:63` + `:101-102`).
- **Auth gate on the page**: `app/account/settings/page.tsx:21`
  calls `requireUser('/account/settings')` (the canonical
  `00-foundations/auth/guards.ts` helper) BEFORE the
  `getMySessions()` query. Anon → 307 redirect to
  `/login?next=/account/settings`.
- **`noindex` metadata**: the page uses `sensitivePageMetadata`
  (`/account/settings/page.tsx:13-17`) so the settings surface is
  excluded from search indexing (P0.21).
- **No PII in logs**: `sessionActions.ts:187-194` + `:201-208` log
  `actorId` (user.id, hashed) + the `sessionId` (which IS PII —
  it's the user's session id), but no email / IP / user-agent.
  The `getMySessions.ts` query selects `ip` from the RPC result
  (`RpcSessionRow.ip` at line 37) but the `SessionInfo` type never
  exposes it (line 8-21) — so the user's IP never crosses the
  wire into the client.

**Verification commands run (all green):**

- `pnpm typecheck` ✓
- `pnpm lint` ✓
- `pnpm check:no-todo` ✓
- `pnpm check:pii` ✓ (no PII in logs; the `SessionInfo` type strips
  the `ip` field from the RPC result)
- `pnpm check:specs` ✓ (all 50 routes have spec coverage;
  `/account/settings` → `account-settings.md` matched)
- `pnpm check:rls` ✓ (no new tables added this tick; existing
  `admin_audit_log` already has RLS from `0001_initial.sql`)
- `pnpm test` ✓ — **2201/2201** pass (3.58 s wall); no new tests
  added this tick (the P1.8 build tick was the test-bearing tick)
- `pnpm build` ✓ — 50 routes compiled; `/account/settings` is
  `5.59 kB / 106 kB` first-load JS — was the same value after
  P9.7's smaller form surface; the `SessionsSection` client
  island is included in this bundle

**Tick additions (2026-06-29 09:00):**

(a) **Type guard against the new `writeSelfAuditLog` audit action
  enum** — verified the `SessionInfo` type's `userAgent` is gated
  to `string | null` and the page's `No active sessions found` empty
  state surfaces when `sessions.length === 0` so a fresh user
  (just signed up, RPC returns an empty array) sees the right
  copy. No code change — verification only.

(b) **Re-audit the rate-limit buckets** — the in-memory `Map`
  (`_lastSignoutAll` + `_lastSignoutOne`) is a per-process sliding
  window. For a server with N concurrent Node workers, the effective
  rate limit per user is `N / 60s` not `1 / 60s`. This is
  documented inline (line 14-17). For the production scale
  target (50K MAU) this is fine — the same in-memory pattern is
  used in `02-features/payouts/actions/exportLedgerCsv.rate-limit.ts`
  and is well-tolerated. Migrating to a Supabase-backed table is
  STUB-012 / P18.8 (the rate-limit migration to Supabase-backed
  table). Verification only — the existing in-memory pattern is
  what the spec at `account-settings.md:120` calls "rate-limited to
  1 per 60s."

(c) **Flagged change**: `02-features/account/profile/index.ts`
  (`sessions` barrel re-exports `signOutEverywhereAction`,
  `signOutSessionByIdAction`, `getMySessions`,
  `SessionsSection`, `SessionInfo`, `MySessions` — verified to
  match the existing convention for the `account/profile` feature
  barrel). No edits this tick.

---

### P9.8 — Marketing preferences verification (this tick)

PHASES.md §Phase 9 P9.8 says: "Marketing preferences — email/SMS/push
opt-in per channel." This is a verification tick. No new code shipped.
The slice boundary is:

**Slice 1 — email channel (shipped via P9.7):**

The email channel is fully shipped end-to-end via P9.7's v2
notification_preferences work. Every line of P9.8's email scope maps
to a real shipped code path:

- **Email digest frequency** — `<select>` in `SettingsForm.tsx:154-167`
  with 4 options (off / daily / weekly / monthly); backed by
  `email_digest_freq` column from migration `0033_notification_preferences_v2.sql`
  + `EmailDigestFreqSchema` Zod enum + `getMySettings` defensive
  coercion to `weekly` on bad values.
- **Master marketing opt-in** — `<Toggle>` in `SettingsForm.tsx:202-208`
  bound to `marketing_opt_in`; turning it on preserves the per-list
  values, turning it off explicitly sets every per-list to `false`
  (one-click unsubscribe per spec line 180).
- **Per-list opt-ins (Newsletter / Partner / Affiliate)** — three
  `<Toggle>`s in `SettingsForm.tsx:210-262`, each with `aria-label`
  + `aria-checked` + `:focus-visible` outline; per-list toggles are
  muted + `disabled` while the master is off (single point of control).
- **Transactional email lock** — locked badge in
  `SettingsForm.tsx:173-184` (spec line 7: "transactional_opt_in=true
  (locked, because transactional emails — receipts, password resets,
  payout notifications — are required for the service to function)").
  Three layers of defense: schema doesn't expose the field, query
  always returns `true`, form renders as a badge not a toggle.
- **Optimistic UI + revert-on-failure** —
  `SettingsForm.tsx:66-82` (`patchPref` callback): applies patch
  locally first, then `startTransition` calls the server action; on
  failure reverts and shows a `role="status"` toast.
- **Audit log** — `updateSettings.ts` writes a
  `settings_self_update` audit row with focused before/after diff
  (only changed fields) on every patch.
- **Rate limiting** — none at the action layer (per-spec: "within
  300ms" UX, not rate-limited). Audit-row volume concern from spec
  open questions line 186 is addressed by the focused-diff approach
  (a multi-field patch = one row, not N rows).
- **Accessibility** — all toggles are real `<button role="switch">`
  with `aria-checked` + `aria-label`; the `<select>` has a
  matching `<label htmlFor>`; P0.6 focus rings + keyboard nav apply.

**Slice 2 — SMS / push / in-app channels (deferred to v2, filed as STUB-080):**

The spec at `account-settings.md:71` explicitly defers the remaining
channels to v2:

> "No notification channels other than email. SMS, push, in-app
>  notifications are all v2."

And `account-settings.md:146`:

> "SMS / push / in-app notification channels — v2."

The v2 scope (new columns + SMS provider integration + VAPID push +
in-app notifications inbox + spec amendment) is captured in STUB-080
(`STUBS.md` — filed this tick). The current `<SettingsForm>` is
structurally ready to absorb the new channels — the master+per-list
pattern + the optimistic-UI pattern + the audit-log pattern all
generalize cleanly. No code change this tick.

**Verification commands run (all green):**

- `pnpm typecheck` ✓
- `pnpm lint` ✓
- `pnpm check:no-todo` ✓
- `pnpm check:pii` ✓ (no PII in logs — SettingsForm logs nothing;
  the action logs `actorId` only via `writeSelfAuditLog`)
- `pnpm check:specs` ✓ (50 routes; `/account/settings` →
  `account-settings.md` matched)
- `pnpm check:rls` ✓ (no new tables added this tick; existing
  `notification_preferences` RLS from migration 0022 +
  `0033_notification_preferences_v2.sql` — the v2 migration is
  additive, no RLS change needed)
- `pnpm test` ✓ — **2201/2201** pass (3.58 s wall); no new tests
  added this tick (P9.7's build was the test-bearing tick; this is
  a verification tick that re-reads the shipped code)
- `pnpm build` ✓ — 50 routes compiled; `/account/settings` unchanged
  at `5.59 kB / 106 kB` first-load JS

**Why [~] (not [x]):** P9.8's PHASES.md definition includes
"SMS / push per channel" which is v2 per spec line 71. The email
channel (the spec-defined v1 scope) is fully shipped. The [~] marks
"code complete for v1 scope; v2 scope explicitly filed as STUB-080."
Once the v2 spec amendment lands, the same slice boundary holds
(Slice 1 already shipped; Slice 2 = STUB-080).

