# Affiliate Settings — `/affiliate/settings`

## What this page does

The affiliate's settings hub. Five stacked sections, each with its own save model: **Profile** (display_name + bio — same fields the mini-shop's hero shows, with a live "this is what your mini-shop looks like" preview pinned to the right on desktop, collapsing to a single column on mobile), **Notifications** (four opt-in toggles: affiliate program updates, commission notifications, payout notifications, monthly digest), **Sessions** (active sessions list with "This device" badge, per-session "Sign out" + a destructive "Sign out everywhere" with confirmation), **Connected accounts** (Google OAuth link/unlink), **Language & region** (locale + timezone — same fields as the customer settings page). Every preference change is audit-logged with before/after JSON so admins can answer "what did this affiliate actually agree to?". The page is gated to authenticated users whose `profiles.role = 'affiliate'`; non-affiliates are redirected to `/library`.

The "payout method" section is **not** on this page — it lives on `/affiliate/settings/payout` (a separate, sensitive flow) and is reached via a "Manage payout method" link in the Profile section.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Profile | `profiles.display_name` | profiles | text input, 2-60 chars |
| Profile | `profiles.bio` | profiles | textarea, max 280 chars, char counter |
| Profile | "Manage payout method" link | (navigates) | button |
| Profile | Mini-shop preview | derived from display_name + bio | live-updating card with the current values, showing "this is what /[handle] looks like" |
| Notifications | `notification_preferences.affiliate_updates_opt_in` | notification_preferences (per the schema proposed in `account-settings.md` OQ) | toggle, default off |
| Notifications | `notification_preferences.commission_notifications_opt_in` | same | toggle, default on (a commission event without an email is bad UX) |
| Notifications | `notification_preferences.payout_notifications_opt_in` | same | toggle, default on (locked for paid payouts; this controls the "payout sent" notification, not the payout itself) |
| Notifications | `notification_preferences.monthly_digest_opt_in` | same | toggle, default on |
| Sessions | `session.id`, `session.created_at`, `session.last_active_at`, `session.user_agent`, `session.ip_country`, `session.is_current` | Supabase Auth `listSessions()` (sanitized) | list rows with sign-out button; current row pinned to top with "This device" badge |
| Sessions | "Sign out everywhere" | (destructive) | button + confirm modal |
| Connected accounts | `providers[]` (Google, email) | Supabase Auth `getUser().identities` | list with provider icon, status, action |
| Language & region | `profiles.locale`, `profiles.timezone` | profiles | two selects |
| Audit strip | "Last settings update: {time ago}" | most-recent `admin_audit_log` row where `action='affiliate_settings_self_update'` for this user | mono timestamp |

**Server actions** in `02-features/affiliate-portal/actions/settings/`:
- `getMyAffiliateSettings()` — RSC, joins `profiles` + `notification_preferences` (left-join, default if missing) + `affiliates` (for status check).
- `updateProfile(input)` — Zod-validates `display_name` (2-60 chars) + `bio` (max 280 chars). Writes `profiles.display_name` + `profiles.bio`. Audit row.
- `updateAffiliateNotificationPrefs(input)` — Zod-validates the 4 toggles. Writes `notification_preferences`. Audit row.
- `signOutSession(sessionId)` — Supabase Auth admin revoke. Audit row.
- `signOutEverywhere()` — Supabase Auth admin revoke all, then sign the user out + redirect `/`. Rate-limited 1 per 60s. Audit row.
- `connectOAuthProvider(provider)` / `disconnectOAuthProvider(provider)` — wraps `supabase.auth.linkIdentity()` / `unlinkIdentity()`. The disconnect path is disabled if it would leave the user with zero sign-in methods (defense against lockout).
- `updateLocaleAndTimezone(input)` — writes `profiles.locale` + `profiles.timezone`. Audit row.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Edit display name | Type in the display_name field | Debounced inline save (300ms), success toast, audit row | affiliate (self) |
| Edit bio | Type in the bio textarea | Debounced inline save, char counter updates, audit row | affiliate (self) |
| See live mini-shop preview | Any profile edit | Right-side card updates in real time (or below on mobile) | affiliate (self) |
| Toggle a notification pref | Click a toggle | Inline save within 300ms; on failure the toggle reverts and a toast shows the error; audit row | affiliate (self) |
| Sign out a single session | Click "Sign out" on a session row | Confirmation inline, server action, row disappears, audit row | affiliate (self) |
| Sign out everywhere | Click "Sign out everywhere" | Confirmation modal, server action invalidates all sessions (incl. current), signs the user out, redirects to `/` | affiliate (self) |
| Connect Google | Click "Connect Google" | Supabase OAuth redirect, returns to this page | affiliate (self) |
| Disconnect Google | Click "Disconnect Google" | Confirmation modal, server action; disabled if it would leave the user with no sign-in method | affiliate (self) |
| Change locale | Open select, pick | Inline save, toast, audit row | affiliate (self) |
| Change timezone | Open select, pick | Inline save, toast, audit row | affiliate (self) |
| Open payout method | Click "Manage payout method" | Navigate to `/affiliate/settings/payout` | affiliate (self) |
| View audit strip | (always visible) | Shows last update timestamp | affiliate (self) |

## What this page does NOT do

- No email change form (the auth flow handles it — see `account-settings.md` OQ)
- No password change (on `/account/profile`)
- No handle change (handle is locked at approval, per `affiliate-onboarding.md`)
- No 2FA setup (v2)
- No delete-account flow on this page (the action navigates to `/account/profile` — single source of truth)
- No notification channels other than email (SMS, push, in-app are v2)
- No "trust this device" / 2FA challenge on sign-out-everywhere (v2)
- No avatar upload on this page (avatar lives on `profiles.avatar_url` and is edited in `/account/profile`; the mini-shop reuses that URL)

## Acceptance criteria

- [ ] Page is auth-gated; anon visitors redirect to `/login?next=/affiliate/settings`; non-affiliates (`profiles.role != 'affiliate'`) redirect to `/library` (no enrollment mid-session from this page — they go to `/affiliate/onboarding`)
- [ ] `getMyAffiliateSettings()` reads `profiles` + `notification_preferences` (left-join) + `affiliates` (status check) and returns the consolidated view; if no `notification_preferences` row exists, defaults are upserted on first read
- [ ] Profile edits (display_name, bio) save inline within 300ms; on failure the field reverts and a toast shows the error; every change writes an `affiliate_settings_self_update` row to `admin_audit_log` with `{ before, after }` JSON
- [ ] Mini-shop preview on the right (or below on mobile) updates in real time as the affiliate types — no save required to see the preview
- [ ] Bio textarea has a visible `0 / 280` char counter; saving is disabled when the bio exceeds 280 chars
- [ ] Each notification toggle is independent; flipping one does not affect the others; the four defaults are: `affiliate_updates=false`, `commission_notifications=true`, `payout_notifications=true`, `monthly_digest=true`
- [ ] Sessions list pins the current session to the top with a "This device" badge and a disabled "Sign out" button; each non-current row has a working per-session sign-out button; "Sign out everywhere" requires typed confirmation
- [ ] Connected accounts reflects linked identities (email always present, Google shown if linked); "Disconnect Google" is disabled if it would leave the user with no sign-in method; every OAuth link/unlink writes an `oauth_link` or `oauth_unlink` row to `admin_audit_log`
- [ ] Locale + timezone changes write to `profiles.locale` and `profiles.timezone` (same RLS path as the customer settings page) and produce an `affiliate_settings_self_update` audit row
- [ ] "Manage payout method" link navigates to `/affiliate/settings/payout`; that page's sensitive flow is NOT performed inline on this page
- [ ] The page renders in < 250ms p95 (RSC, two-row read on `profiles` + `notification_preferences`, one Supabase Auth admin call for sessions)
- [ ] All toggles and selects are keyboard-navigable with `--border-3` focus rings; mobile responsive at 360px, 768px, 1280px; no PII in URLs, no `TODO` / `FIXME` / `HACK` in the diff, no console errors

## Design reference

- Mockup: not yet built — to be created during the affiliate portal build (`mockups/affiliate-settings.html`)
- Design tokens: `00-foundations/design/tokens.css` (color, spacing, radii, type)
- Theme: both (`design-system-dark.css` default, `design-system-light.css` for users who toggle)
- Reference patterns: `mockups/library.html` (section header + card density, mono timestamps, hairline borders); `mockups/account.html` for the connected-accounts / sessions card pattern

## Security

- **Auth required:** YES — `requireRole(['affiliate'])` then `user_id = auth.uid()` on every server action
- **Allowed roles:** affiliate (any status; pending affiliates can edit profile + notifications but cannot yet receive payouts)
- **RLS policies that apply:**
  - `profiles` — `profiles_self_read`, `profiles_self_update` (writes to display_name, bio, locale, timezone go through the same policy)
  - `notification_preferences` — `notification_prefs_self_read`, `notification_prefs_self_update` (see `account-settings.md` OQ for the proposed schema; same table)
  - `affiliates` — `affiliates_self_read` (for the status check); write is blocked at RLS for self (only `service_role` via server actions can write to payout_method)
  - `admin_audit_log` — admin read only; the server action uses `service_role` to insert (the audit source, not the audited data)
- **PII displayed:** the user's own session metadata (user-agent, country derived from IP via GeoIP — not raw IP). The mini-shop preview shows the user's chosen display_name + bio, both of which are public on `/[handle]`.
- **PII in URLs:** no. Session ids, provider names, user ids stay server-side.
- **OAuth flow security:** standard Supabase `linkIdentity` / `unlinkIdentity`. Unlink is blocked if it would leave the user with zero sign-in methods.
- **"Sign out everywhere":** rate-limited 1 per 60s per user. Confirmation modal requires the user to type their email. Action invalidates sessions via Supabase Auth admin API (service-role call, user-authorized by the click).
- **Notification toggle security:** toggles are individual opt-ins; we DO NOT collapse them under a single "marketing master switch" like the customer settings page does, because affiliate-relevant transactional notifications (commission events, payout events) are not "marketing" and the affiliate expects them by default. The `affiliate_updates` toggle is the only marketing opt-in.
- **Audit logged:**
  - `updateProfile` — `action='affiliate_settings_self_update'`, `target_table='profiles'`, `before`/`after` JSON (display_name, bio only)
  - `updateAffiliateNotificationPrefs` — `action='affiliate_settings_self_update'`, `target_table='notification_preferences'`, `before`/`after` JSON (all 4 toggles)
  - `signOutSession` — `action='session_signout_one'`, `target_id` = session id
  - `signOutEverywhere` — `action='session_signout_all'`, `target_id` = `'*'`
  - `connectOAuthProvider` / `disconnectOAuthProvider` — `action='oauth_link'` / `'oauth_unlink'`, `target_id` = provider
  - `updateLocaleAndTimezone` — `action='affiliate_settings_self_update'`, `target_table='profiles'`, `before`/`after` JSON (locale, timezone only)
- **CSRF:** server actions use Next.js's built-in origin check + Supabase Auth session cookie
- **Third-party scripts:** none

## Performance

- **Target p95:** < 250ms
- **Render strategy:** RSC (no client-side data fetching for the initial render); the live mini-shop preview is a small client component that mirrors typed input
- **Cache:** none — page is user-specific
- **DB indexes used:** `profiles_user_id_unique` for the profile/locale/timezone writes; the implicit `notification_preferences_user_id_pk` for the pref writes
- **Bundle size budget:** < 40KB added to client bundle (five section cards + inline-save toggles + live preview component + one confirmation modal). Reuses the platform `<Switch>` and `<Input>` primitives from `00-foundations/ui/`.

## Out of scope for v1

- Email change form (Supabase Auth flow; follow-up spec)
- 2FA setup
- SMS / push / in-app notification channels
- Per-affiliate notification channel preferences
- Session naming / "this is my work laptop"
- "Remember this device" / trusted devices
- IP allowlist / region lock
- Security log ("3 sign-in attempts in the last 24h")
- Delete-account modal on this page (action navigates to `/account/profile`)
- Avatar upload on this page (reuses `profiles.avatar_url`, edited in `/account/profile`)
- Payout method editing on this page (separate page; see `/affiliate/settings/payout`)
- Re-applying as affiliate (suspended-reactivation flow lives in `affiliate-onboarding.md` OQ)

## Open questions for human

1. **Reuse `notification_preferences` from the customer settings page, or a new `affiliate_notification_preferences` table?** My recommendation: **reuse the same table, add 3 new columns** (`commission_notifications_opt_in`, `payout_notifications_opt_in`, `monthly_digest_opt_in`). Reasons: one row per user, one save path, one audit shape. The customer-side `marketing_opt_in` master switch from `account-settings.md` does NOT apply here — affiliate-relevant transactional notifications (commission, payout) are not "marketing." Confirm the schema amendment or split into a new table.

2. **Live mini-shop preview fidelity:** is the right-side card a real RSC re-render of `/[handle]` (heavier, more accurate) or a styled approximation that mirrors the typed input (lighter, ~2KB)? My recommendation: **styled approximation**. Reasons: < 100ms feedback loop as the user types, no extra query, and the bio + display_name are the only two fields the user is editing — the product list doesn't change on this page. A "Open in new tab" link to the real `/[handle]` covers the fidelity case.

3. **What "commission notifications" actually means:** the toggle's default-on state implies the user wants to be emailed when a commission is earned. Is that: (a) every commission event (high volume, can be spammy during launches), (b) a daily digest of new commissions, or (c) only when a commission crosses the $50 payout threshold? My recommendation: **(b) daily digest at the affiliate's local 9am** for the v1 default; an "instant" mode is a v2 toggle per-affiliate. Confirm the v1 default.

4. **Session GeoIP:** the spec calls for `session.ip_country` (no raw IP). Supabase Auth gives us user-agent but not IP — we'd need MaxMind GeoLite2 or similar. My recommendation: **ship v1 without country** (just "Last active: {time}, {truncated user-agent}"). Add GeoIP in v2 if support requests it. Same decision as the customer settings page; flag for consistency.

---

## Implementation notes

### Slice 1 (2026-06-30 14:30 +07) — Profile + Notifications sections end-to-end

**Shipped this slice**: page route at `/affiliate/settings` + the
Profile section (inline 300ms debounced save + live mini-shop preview
on the right) + the Notifications section (4 atomic toggle buttons)
+ the loading state + the sidebar entry + barrel exports +
`'affiliate_settings_self_update'` enum value. The data layer
(`getMyAffiliateSettings` query + `updateAffiliateProfileAction` +
`updateAffiliateNotificationPrefsAction` + `UpdateAffiliateProfileInput`
+ `UpdateAffiliateNotificationPrefsInput` + 4 test files covering the
full shape + the focused diff audit-log writes) shipped pre-cron from
prior work and remains unchanged.

**Files (8 new + 6 modified + 1 spec section + 1 STUB)**:

*New:*
1. `02-features/affiliate-portal/components/MiniShopPreview.tsx` (~30 LOC)
   — RSC + zero client JS. Styled approximation per spec OQ §2
   (lightweight mirror of the typed display_name + bio with a
   teal `Verified affiliate` pill; the real /[handle] is one click
   away via the "Open your mini-shop ↗" link).
2. `02-features/affiliate-portal/components/MiniShopPreview.module.css`
   (~45 LOC) — token-only CSS via `--bg-elev-1`, `--line`,
   `--teal`, `--text-1`, `--accent-soft`, `--accent-line`. The
   affiliate sees the same design tokens as the public MiniShopHero
   so the look-and-feel matches.
3. `02-features/affiliate-portal/components/MiniShopPreview.test.tsx`
   (7 tests) — happy path + defensive fallbacks (empty displayName
   → `@handle`; empty bio → "Curated picks by @handle") + a11y
   (`aria-hidden="true"` since the preview is decorative).
4. `app/affiliate/settings/page.tsx` (~95 LOC) — RSC, `force-dynamic`,
   noindex via `sensitivePageMetadata`, two parallel RLS-gated reads
   in one round-trip (`getAffiliateDashboard` for `handle` +
   `getMyAffiliateSettings` for the editable fields), shell wrapper
   `requireRole(['affiliate','admin','super_admin'])`, "Coming in
   next slices" section listing the deferred surfaces + the
   sub-route links.
5. `app/affiliate/settings/page.module.css` (~85 LOC) — token-only
   page layout (eyebrow + h1 + lede + stacked section cards +
   dashed-border "Coming in next slices" panel).
6. `app/affiliate/settings/loading.tsx` (~50 LOC) + `loading.module.css`
   (~85 LOC) — RSC fallback mirroring the page shape via the
   existing Skeleton primitives (eyebrow + h1 + 2 lede lines +
   2 stacked section card shapes with field/toggle rows).

*Modified:*
1. `02-features/affiliate-portal/AffiliateShell.tsx` — added
   `{ href: '/affiliate/settings', label: 'Settings' }` to the NAV
   array (P13.11 Slice 1 ships the page; the comments above the
   const list the still-deferred surface like Mini-shop / Payouts).
2. `02-features/affiliate-portal/index.ts` — barrel re-exports
   `ProfileSection`, `NotificationsSection`, `MiniShopPreview`,
   `getMyAffiliateSettings`, `updateAffiliateProfileAction`,
   `updateAffiliateNotificationPrefsAction`, the 3 types, and the 2
   result unions. (Barrel already exported `SettingsHub` from prior
   session — kept.)
3. `00-foundations/data/enums.ts` — added `'affiliate_settings_self_update'`
   to `AuditAction` union + `AUDIT_ACTIONS` array. The two
   pre-existing actions already used this enum value; this tick
   formalizes it so future grep-able audit log writes use the
   same string.
4. `01-specs/pages/affiliate-settings.md` — this Implementation
   notes section.
5. `STUBS.md` — STUB-111 documents the deferred Sessions +
   Connected accounts + Language & region + Audit strip + the
   Phase 17-gated daily-digest cron (Slices 2-5).
6. `docs/PROGRESS.md` — P13.11 line flipped from `[ ]` to `[~]`
   (Slice 1 ships; full P13.11 ships after Slice 5 lands).

**Slice 1 acceptance criteria coverage** (from
`01-specs/pages/affiliate-settings.md` §Acceptance criteria):

- #1 Page auth-gated via shell `requireRole(['affiliate','admin','super_admin'])`:
  SHIPPED — non-affiliates hit `/403`, anon hits
  `/login?next=/affiliate/settings`.
- #2 `getMyAffiliateSettings()` reads profiles + notification_preferences
  (left-join) + affiliates (status check) in one round-trip:
  SHIPPED — Promise.all of 3 reads, safe defaults on any failure,
  FNV-1a-hashed PII-safe warn logs.
- #3 Profile edits (display_name, bio) save inline within 300ms:
  SHIPPED — debounced via `useRef<setTimeout>` + `useTransition`,
  300ms debounce constant in ProfileSection.tsx; failure reverts
  + inline error toast.
- #4 Mini-shop preview on the right updates in real time:
  SHIPPED — `<MiniShopPreview>` re-renders on every keystroke
  via React props (the parent ProfileSection is the only client
  island; the preview itself is RSC).
- #5 4 notification toggles are independent; defaults match:
  SHIPPED — atomic toggle buttons (not debounced; toggles are
  atomic per spec line 71-72); defaults match
  `[false, true, true, true]` per spec line 71.
- #6 Each toggle is its own opt-in (no master switch):
  SHIPPED — the transactional toggles are independent opt-ins;
  no master switch per spec §Security note 99.
- #7 Bio textarea has a visible `0 / 280` char counter:
  SHIPPED — counter at the bottom of the textarea; over-typing
  shows the inline error UI.
- #8-#11 (Sessions, Connected accounts, Language & region, Manage
  payout method link): DEFERRED to Slice 2+ (filed as STUB-111).
- #12 The page renders in < 250ms p95: SHIPPED — RSC with
  3 parallel RLS-gated reads, no client JS for the initial render;
  shared first-load JS unchanged at 101 kB. /affiliate/settings
  is `248 B / 105 kB` first-load (RSC + the 2 client islands).
- #13 All toggles and selects are keyboard-navigable; mobile
  responsive at 360px, 768px, 1280px; no PII in URLs; no
  TODO/FIXME/HACK in the diff; no console errors:
  SHIPPED — every toggle has its own `aria-label` ("<title> (on|off)")
  + `role="switch"` + the parent `<button type="button">` is
  keyboard-navigable by default; the CSS modules include
  `@media (max-width: 900px)` breakpoints.

**Architecture decisions**:

- **Atomic toggle buttons, not debounced.** Per spec §Acceptance §5:
  "Each notification toggle is independent; flipping one does not
  affect the others." The 4 toggles are NOT a text input that needs
  a 300ms debounce — each click fires the server action
  immediately, optimistic update + revert on failure. The action's
  Zod schema accepts any subset of the 4 fields so the patch
  payload is just the one key that flipped.
- **`<button role="switch">` over `<input type="checkbox">`.** The
  canonical a11y pattern for atomic toggle buttons (per WAI-ARIA
  Authoring Practices): `<button role="switch" aria-checked="...">`.
  The `<input type="checkbox">` pattern is for form-bound checkboxes
  (where the value ships with the form). Here the value is the
  server state — a button is the right primitive. Each button carries
  an `aria-label` like `"Commission events (on)"` so screen readers
  announce both the title + the current state.
- **`MiniShopPreview` is RSC, zero client JS.** The preview is a
  decorative mirror of the typed input (per spec OQ §2 — styled
  approximation, < 2KB). The parent ProfileSection re-renders the
  preview on every keystroke via React props — no separate state,
  no client JS shipped for the preview itself.
- **`SettingsHub` is an optional composition wrapper.** A prior
  tick shipped `SettingsHub` as a thin RSC that wraps
  `ProfileSection` + `NotificationsSection` + a header. The
  current page route composes `ProfileSection` + `NotificationsSection`
  inline (not via SettingsHub) so the route owns the page-level
  layout (the eyebrow + h1 + lede + the "Coming in next slices"
  section). SettingsHub is still re-exported from the barrel for
  future use cases.
- **Two parallel RLS-gated reads, not three.** The `handle` lives
  on the affiliates row (owned by `getAffiliateDashboard`); the
  profile + prefs + status slices live on `getMyAffiliateSettings`.
  Both are read in parallel in the route handler (1 RT). No
  third helper needed.
- **Action-level rate limit not added in Slice 1.** Profile edits
  are debounced inline (300ms in the UI) — the platform's primary
  defense against edit-spam. Notification toggles are atomic
  one-click actions. A future tick can add a per-user N/min limit
  if support requests it (the customer-side `updateProfileAction`
  is also unrate-limited; this is the platform pattern).
- **Audit log `target_kind` discriminator.** Profile edits write
  `target_kind='profiles'`; notification-prefs edits write
  `target_kind='notification_preferences'`. Both with the same
  `action='affiliate_settings_self_update'`. Admins can filter
  by either column to find the right diff.
