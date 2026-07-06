# Feature: account/profile

The user's self-edit profile page (`/account/profile`) plus the
right-to-deletion confirmation modal.

## Surface

- **RSC page** at `03-app/account/profile/page.tsx`. Composes the
  header, the form, the audit strip, and the danger zone.
- **Client islands** under `02-features/account/profile/components/`:
  `ProfileForm` (form + dirty-state + global-click + beforeunload
  guard), `AvatarUploader` (Bunny signed PUT + mime/size allowlist,
  see `account-profile.md` §P9.2 below), `DeleteAccountModal`
  (type-email-to-confirm modal), `EmailVerifyBadge` +
  `EmailVerifyButton` (server badge + client resend button).
- **Server actions** under `02-features/account/profile/actions/`:
  `updateProfileAction` (Zod-validated, audit-logged),
  `requestAvatarUploadAction` (mints the signed PUT URL, audit-logs),
  `deleteMyAccountAction` (calls the RPC + signOut + audit),
  `resendVerificationEmailAction` (server-side wrapper to keep
  `next/headers` out of the client bundle).
- **Server-only queries** under `02-features/account/profile/queries/`:
  `getMyProfile` (profile + auth user in parallel),
  `getMemberSince` (formats `created_at`),
  `formatTimeAgo` (relative-time formatter).
- **Audit log helper** at `02-features/account/profile/actions/writeSelfAuditLog.ts`.
- **Migration** at `04-platform/migrations/0010_delete_my_account_rpc.sql`.
- **Foundation dep** at `00-foundations/files/upload-constants.ts` (pure
  constants — `AVATAR_MAX_BYTES`, `AVATAR_MIME_TYPES`,
  `extForAvatarMime`) and `00-foundations/files/upload.ts`
  (server-only mint helper).

## What's deferred

- **STUB-077** — P9.2 Slice 2 (cropper). P9.2 Slice 1 ships the
  upload pipeline end-to-end (upload-as-is, no cropper). The
  cropper waits on the spec's open question (`react-image-crop` vs
  `react-easy-crop` vs custom canvas) + the dep add + the
  pan/zoom UX. ≤ 0.5 tick once the library is decided.
- **STUB-018** — Email change. Lives on `/account/settings` (PH10b).
  The form here is read-only with a "Verified" / "Verify" badge.
- **STUB-019** — `deleteMyAccount` blocks when the user has active
  subscriptions (`subscriptions.status IN ('active','trialing','past_due')`)
  or pending payouts (`payout_ledger.status IN ('locked','available')`).
  The error is surfaced inline; the user is told to cancel via
  Settings → Billing first.

## Status

- P9.1 — Profile form + DELETE account — shipped (2026-06-29 06:00 + tick 2026-06-29 07:11)
- **P9.2 Slice 1 — Avatar upload pipeline — shipped** (2026-06-29,
  this tick). See `account-profile.md` §P9.2 for the full
  implementation notes + 10 design decisions.
- P9.2 Slice 2 (cropper) — STUB-077.
- **P9.7 — Notification preferences (granular per category) — shipped**
  (2026-06-29, this tick). See `account-settings.md` §P9.7 for the
  full implementation notes + 10 design decisions. Migration
  `0033_notification_preferences_v2.sql` adds 6 new columns + a
  backfill; SettingsForm now exposes an email-frequency select +
  a master marketing switch + 3 per-list toggles (Newsletter,
  Partner program updates, Affiliate program updates); Transactional
  stays as a locked "Required" badge.

## Design notes

- The page is RSC. The form is the largest client island (5.58 kB
  route chunk). No third-party libraries added.
- The dirty-state guard uses TWO layers: (1) `beforeunload` for
  tab close / refresh / external links, (2) a document-level click
  interceptor for in-app Next.js `<Link>` clicks (the sidebar nav
  is the relevant case). `useBlocker` from `next/navigation` is
  not exported in the pinned Next 15.0.3, so a global click
  interceptor is the project-wide fallback.
- The delete-account flow runs through a single Postgres RPC
  (`delete_my_account(p_user_id uuid)`, `security definer`,
  granted to `service_role` only, with `SERIALIZABLE` isolation).
  The function does NOT reference `progress` or `bookmarks`
  (those tables ship in PH16). It only touches tables that exist
  today.
- The `deleteMyAccount` server action writes the audit row BEFORE
  the RPC (so the request is recorded even if the cascade fails
  partway) and signs the user out AFTER the RPC returns
  successfully. The auth.admin.deleteUser call is intentionally
  NOT in the RPC — the user is signed out by the action so the
  session cookie is cleared cleanly, and the auth row is
  reaped by Supabase Auth's housekeeping.

## Spec

[`01-specs/pages/account-profile.md`](../../01-specs/pages/account-profile.md)

## Migration

[`04-platform/migrations/0010_delete_my_account_rpc.sql`](../../04-platform/migrations/0010_delete_my_account_rpc.sql)

## P9.13 — refund sent confirmation page

The user lands on `/account/orders/[id]/refund/sent?refundId=<id>` after `createRefundRequestAction` returns ok. The page renders the human-facing reference (`R-<id>`), the 2-business-day response window, the 3-step "what happens next" explainer, and two CTAs (back to the order, back to all orders).

**Files (5 new + 5 modified + 2 spec/README):**

- **NEW** `02-features/account/profile/lib/formatRefundUrlParams.ts` (~80 LOC) — pure helpers: `parseOrderId`, `parseRefundId`, `formatRefundReference`. Tight `parseInt` replacement (rejects decimals, scientific notation, leading `+`/`-`, anything past `MAX_SAFE_INTEGER`).
- **NEW** `02-features/account/profile/lib/formatRefundUrlParams.test.ts` (~125 LOC, **17 unit tests**, 2ms wall).
- **NEW** `02-features/account/profile/queries/getRefundConfirmation.ts` (~75 LOC) — server-only query, RLS-gated, PII-safe select (`id, status, created_at` only — never `notes` / `stripe_refund_id` / `approved_by` / `requested_by`).
- **NEW** `02-features/account/profile/queries/getRefundConfirmation.test.ts` (~165 LOC, **7 unit tests**, 3ms wall) — chainable fake Supabase, PII-safety assertion, defensive status enum coercion.
- **NEW** `03-app/account/orders/[id]/refund/sent/loading.tsx` (~35 LOC) + `loading.module.css` (~45 LOC) — RSC fallback matching the page shape.
- **MODIFIED** `00-foundations/design/tokens.css` — added `--on-success: #0B0C0D` (dark theme, mirrors `--on-danger: #FFFFFF`).
- **MODIFIED** `00-foundations/design/design-system-light.css` — added `--on-success: #FFFFFF` (light theme — the green is darker here, so white wins on contrast).
- **MODIFIED** `03-app/account/orders/[id]/refund/sent/sent.module.css` — replaced 2 inline hex values (`#0b0c0d` and `#1a0e00`) with the new `--on-success` token + the existing `--on-action` token. Was an AGENTS.md "no inline colors" violation.
- **MODIFIED** `03-app/account/orders/[id]/refund/sent/page.tsx` — refactored to compose the new helpers + query. The page is now a thin layer; pure logic lives in the lib, data lives in the query. No public API change.
- **MODIFIED** `02-features/account/profile/index.ts` — barrel re-exports the new helpers + query + type.
- **MODIFIED** `01-specs/pages/account-refund.md` — new "P9.13 — confirmation page" Implementation notes section.
- **MODIFIED** `docs/PROGRESS.md` — `- [x] **P9.13**` + Notes log entry.

**Design decisions:**

- **Three security gates, cheapest first**: `requireUser` redirect → strict URL parsing (`parseOrderId` + `parseRefundId`) → RLS-gated read (`getRefundConfirmation` with explicit `requested_by = user.id` predicate). A bad URL or a refund that belongs to another user renders 404 — never 403, never a half-rendered page.
- **Explicit `requested_by` predicate is defense in depth**, not a redundant check. The `refunds_self_read` RLS policy filters on the order's `user_id`; the explicit `eq('requested_by', user.id)` adds a second gate so a future RLS migration can't accidentally expose admin-issued refunds (where `requested_by` is null) on this user-facing page.
- **PII-safe select is a contract, not a comment** — the test asserts the captured `select('id, status, created_at')` payload never includes `notes` / `stripe_refund_id` / `approved_by` / `requested_by`. A regression fails the suite.
- **Status enum is fail-closed** — if the DB ever surfaces a value outside `'pending' | 'succeeded' | 'failed' | 'canceled'`, the page renders 404 rather than render an unhandled status. Covered by the `'in_progress'` test case.
- **`--on-success` token, not a fallback to `--on-action` or `--bg`.** The semantic is "readable text/icon on the green `--success` fill" — it's a fourth member of the `--on-*` family. Adding the token (2 lines across 2 files) is a smaller surface change than reusing an existing token whose contrast might drift.
- **RSC, no client JS.** The checkmark uses a Unicode `✓` (same as the spec mockup); no SVG, no icon library. First-load JS for `/account/orders/[id]/refund/sent` is `0 B`.

**No migration needed.** Reads existing columns on `refunds` (id, status, created_at). No new RLS policies (the existing `refunds_self_read` covers the read; the explicit `requested_by` predicate is application-side defense in depth). No new dependencies.

## P1.8 — session management (per-device list)

The settings page's "Sessions" section shows every active session for
the current user, with the current device pinned to the top and a
working per-session "Sign out" button. The "Sign out this device"
and "Sign out everywhere" controls stay as the dedicated flows for
the current device and the bulk escape hatch.

**Surface:**
- `02-features/account/profile/queries/getMySessions.ts` — calls
  `public.list_user_sessions()` (RPC) + decodes the current JWT to
  get the session_id claim. Returns
  `{ sessions: SessionInfo[], currentSessionId: string | null }`.
- `02-features/account/profile/actions/sessionActions.ts` — adds
  `signOutSessionByIdAction(input: { sessionId: string })` (calls
  `public.delete_user_session(uuid)` RPC, writes a
  `session_signout_one` audit row, rate-limited to 1/60s per user).
- `02-features/account/profile/components/SessionsSection.tsx` —
  full rewrite: renders the full list with per-session "Sign out"
  buttons, error state, "Sign out this device" + "Sign out
  everywhere" controls kept.
- `02-features/account/profile/lib/decodeSessionId.ts` — JWT
  payload decoder (no deps, ~25 LOC).

**Migrations:**
- `04-platform/migrations/0021_user_sessions_rpc.sql` — adds
  `public.list_user_sessions()` and `public.delete_user_session(uuid)`
  Postgres functions (both SECURITY DEFINER + `set search_path = ''`).

**Deferred (P1.8 Slice 2):** single-session enforcement — when the
user signs in on a new device, all other devices are auto-signed-out.
This is a follow-up slice that touches `signInAction` + the audit log.
Tracked as the next loose end after P1.8 ships.

**Spec:** [`01-specs/pages/account-settings.md`](../../01-specs/pages/account-settings.md)
(implementation notes section has the full design rationale).

## P9.2 — avatar upload (Slice 1, this tick)

End-to-end avatar upload without the cropper. See
[`01-specs/pages/account-profile.md`](../../01-specs/pages/account-profile.md) §"P9.2 —
Implementation notes" for the full surface contract + 10 design
decisions. Quick reference:

- **Foundation split** — `00-foundations/files/upload-constants.ts`
  is the pure-safe module (`AVATAR_MAX_BYTES`, `AVATAR_MIME_TYPES`,
  `extForAvatarMime`) the client island can import without pulling
  in `node:crypto`. `00-foundations/files/upload.ts` is the
  server-only mint helper (`requestAvatarUpload` +
  `isAvatarUploadConfigured` + `UploadNotConfiguredError`). The split
  is forced by `next build` — `node:crypto` cannot cross the
  webpack browser/server boundary.
- **Path layout** — `avatars/{userId}/{uuid}.{ext}` (the userId
  sandbox is the security gate; the UUID suffix is the collision
  defense).
- **Auth surface** — `<AvatarUploader>` (client island) issues a
  hidden form button + a hidden `<input type="file">`. On a valid
  pick it calls `requestAvatarUploadAction` to mint a signed PUT
  URL + audit log row, then `fetch(uploadUrl, { method: 'PUT', body:
  file, headers: { 'Content-Type': file.type } })` to deposit the
  file. On success the parent form's `avatar_url` state updates and
  the user's next Save commits it via `updateProfileAction`.
- **MIME + size gate** — server-side Zod validation is the security
  boundary (mime must be in `{image/jpeg, image/png, image/webp}`;
  size 1..5 MiB). Client-side validation is a UX short-circuit so
  the user isn't waiting on a round-trip.
- **Audit row** — `admin_audit_log` row with
  `action='avatar_upload_requested'`, `target_kind='avatars'`,
  metadata `{ mime, size, storagePath, expiresAt }`. Email + user-id
  + IP + UA on the parent row (not in metadata).
- **Env gating** — when `BUNNY_STORAGE_PUBLIC_HOSTNAME` or
  `BUNNY_STORAGE_ACCESS_KEY` is missing, the action surfaces a
  friendly error ("Avatar upload is temporarily unavailable. Please
  try again later.") so the form's other fields remain usable.
- **Bundle impact** — `/account/profile` is `7.94 kB / 118 kB`
  first-load JS (was `6.74 kB / 117 kB` before P9.2 Slice 1; +1.2 kB
  from the new client island, no shared chunk delta). The shared
  first-load JS is unchanged at 101 kB.

**Slice 2 owed** (STUB-077): cropper — `react-easy-crop` is the
spec's recommendation but awaits human sign-off. The library
decision + dep add + pan/zoom UX are ≤ 0.5 tick once the library is
picked. The shipped Slice 1's `object-fit: cover` thumb renders any
image as a clean square even without the cropper.
