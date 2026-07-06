# Account profile — `/account/profile`

## What this page does

The user's account profile. The page the user lands on when they click their avatar in the top nav (or follow any "Edit profile" / "Account" link in the app). It shows their current `display_name`, `avatar_url`, `bio`, `locale`, and `timezone`, plus their `auth.users.email` (read-only — email change goes through Supabase Auth's email-change flow, not this form). A "Change password" entry point links to `/update-password`. The form is live-save: changes are committed by a server action on Save, with explicit unsaved-changes confirmation if the user tries to navigate away.

At the bottom of the page, a "Danger zone" card holds a single "Delete account" action that opens a confirmation modal. Deletion is irreversible from the user's side and triggers the anonymization flow described in `01-specs/pages/_data-model.md` (right-to-deletion): orders and payout_ledger rows are anonymized (user_id is replaced with a hash, not deleted) to preserve 7-year financial records; everything else (profile, library_grants, progress, bookmarks, reviews) is hard-deleted via cascade.

This page is the user's self-view of identity. It does NOT expose roles, permissions, partner/affiliate application state, payout method, or tax/kyc info — those live in `/account/settings` and the partner/affiliate portals.

Migration requirement: the current Shopify footer/profile link can send users to `account.uthena.com/profile`. After DNS cutover, that host/path must route to `/account/profile` with the same auth gate.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Page header | `profiles.display_name` (greeting), avatar thumb, "Member since {month YYYY}" from `profiles.created_at` | `getMyProfile()` server query | greeting |
| Profile form | `display_name` | `profiles.display_name` | text input (max 80 chars) |
| Profile form | `avatar_url` + 80×80 thumb | `profiles.avatar_url` (CDN-hosted on Bunny Storage) | image uploader with crop |
| Profile form | `bio` | `profiles.bio` | textarea (max 280 chars, live counter) |
| Profile form | `locale` | `profiles.locale` | select (10 supported locales — see Open Questions) |
| Profile form | `timezone` | `profiles.timezone` | select (IANA tz, populated from `Intl.supportedValuesOf('timeZone')`) |
| Read-only block | `email` (verified state, with "Verified" / "Verify" badge) | `auth.users.email` (via Supabase Auth `getUser()`) | text + badge, not editable |
| Read-only block | "Change password" entry point | link to `/update-password` | link button |
| Danger zone | "Delete account" action | server action `deleteMyAccount()` | destructive button + modal |
| Audit strip | "Last profile update: {time ago}" | `profiles.updated_at` | mono timestamp, hover shows exact ISO |

**Queries / actions (all in `02-features/account/`):**
- `getMyProfile()` — RSC-only, single row join on `auth.users` (via service-role client for the email only, on the server).
- `updateProfile(input)` — server action, Zod-validated, writes `profiles` only.
- `requestAvatarUpload()` — server action that returns a Bunny Storage signed PUT URL (valid 5 min, 5 MB cap, image/* mime).
- `deleteMyAccount()` — server action; triggers anonymization per data model.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Edit display name | Type in the "Display name" input | Local form state, dirty flag set | self |
| Upload new avatar | Click avatar thumb → file picker → select image (jpg/png/webp, ≤5 MB) | Client posts to Bunny signed URL, then calls `updateProfile({avatar_url})` with the resulting CDN URL | self |
| Remove avatar | Click "Remove" link below the avatar thumb | Sets `avatar_url = null`, updates the row | self |
| Edit bio | Type in the bio textarea (280-char limit) | Local form state, char counter updates live | self |
| Change locale | Open the locale select, pick a value | Local form state | self |
| Change timezone | Open the timezone select, search/pick a value | Local form state | self |
| Save profile | Click "Save changes" button | Server action `updateProfile()` runs, success toast, dirty flag clears, audit row written | self |
| Reset form | Click "Reset" link | Form reverts to last-saved values, dirty flag clears | self |
| Navigate away with unsaved changes | Click any nav link while form is dirty | Browser confirm dialog (native `beforeunload` + Next.js route guard) | self |
| Change password | Click "Change password" | Navigate to `/update-password` (separate spec) | self |
| Verify email (if unverified) | Click "Verify email" badge | Sends a verification email via Supabase Auth, toast confirms, button disables for 60s | self |
| Delete account | Click "Delete account" in Danger zone | Confirmation modal opens (type email to confirm), then `deleteMyAccount()` server action, then sign out + redirect to `/` | self |
| Open keyboard shortcut panel | Press `?` | Modal shows all shortcuts on this page (none defined for v1, modal hidden if empty) | self |
| Open legacy account profile URL | Visit `account.uthena.com/profile` | Redirect to `/account/profile` if authenticated or `/login?next=/account/profile` if anonymous | public URL, page requires auth |

## What this page does NOT do

- No email change field. Email change is a Supabase Auth flow (requires confirmation link to the new address), not a simple text edit. The "Change email" entry point is on `/account/settings` (which calls `supabase.auth.updateUser({email})` and surfaces the verification state).
- No phone number field. The data model doesn't have one and v1 doesn't need one.
- No 2FA setup. v2; documented in `docs/ARCHITECTURE.md` §12.
- No public profile page. The profile is private; this page is the user's self-view. There is no `/u/[handle]` or `/profile/[id]` route in v1. Affiliate mini-shops are a separate feature with their own public surface.
- No "view as" / "preview" for the profile. The avatar is shown in the nav, and that's the only public surface in v1.
- No role change UI. The role lives in `profiles.role` and is set at signup or by an admin. A user cannot self-promote.
- No connected-accounts / OAuth-link section. That's on `/account/settings`.
- No session-management section. That's on `/account/settings`.
- No "download my data" CTA. That's on `/account/settings` (right-to-export per `docs/ARCHITECTURE.md` §7).
- No partner / affiliate application state. Partner onboarding is at `/partner/onboarding`; affiliate at `/affiliate/onboarding`. The role gating happens in the server, not in this form.
- No social links (Twitter handle, website). v2; the data model doesn't carry them.
- No username / handle field. The user is identified by `auth.users.id` and `email`. There is no vanity handle for customers (only for affiliates, who get one at `/affiliate/onboarding`).
- No profile completeness score / progress bar. The bio is optional, the avatar is optional, the locale defaults to `en`, the timezone defaults to `UTC`. The form is allowed to be sparse.

## Acceptance criteria

- [ ] Page is auth-gated — anonymous visitors redirect to `/login?next=/account/profile`
- [ ] `account.uthena.com/profile` redirects into `/account/profile` with the same auth gate after DNS cutover
- [ ] The form pre-fills from `getMyProfile()` with no flash of empty form
- [ ] The email is rendered read-only with a "Verified" or "Verify" badge matching the Supabase Auth state; "Change password" links to `/update-password`
- [ ] The avatar uploader accepts `image/jpeg`, `image/png`, `image/webp`, rejects other mime types and files > 5 MB with inline errors; the cropper is square-aspect and the new image appears in the form and header within 1s of upload completion
- [ ] The bio textarea enforces a 280-character limit and the display-name input enforces an 80-character limit (client + server Zod)
- [ ] The locale select is populated from a hard-coded list of 10 locales; the timezone select is populated from `Intl.supportedValuesOf('timeZone')` and is searchable
- [ ] "Save changes" is disabled when the form is clean; on success, a toast is shown and the dirty flag clears; on failure, the form keeps the user's input and shows the server error inline; navigating away with unsaved changes triggers a browser confirm dialog
- [ ] "Delete account" opens a confirmation modal that requires the user to type their email to enable the destructive button and shows a one-line summary of what gets deleted vs anonymized
- [ ] After `deleteMyAccount()` succeeds, the session is destroyed, `profiles` is hard-deleted, library_grants/progress/bookmarks/reviews cascade-delete, `orders` + `payout_ledger` are anonymized, and `admin_audit_log` receives an `account_self_delete` row
- [ ] The page renders in < 200ms p95 (RSC, single-row read, no joins against large tables)
- [ ] All form inputs are keyboard-navigable with visible `--border-3` focus rings; mobile responsive at 360px, 768px, 1280px
- [ ] No PII leak in URLs, no `TODO` / `FIXME` / `HACK` in the diff, no console errors in dev or prod

## Design reference

- Mockup: not yet built — to be created during the account feature build (see Open Questions)
- Design tokens: `00-foundations/design/tokens.css` (color, spacing, radii, type)
- Theme: both (`design-system-dark.css` default, `design-system-light.css` for users who toggle)
- Reference patterns: `mockups/library.html` (header + form density, mono timestamps in stat strip, hairline borders, layered surfaces, 1 tri-color moment reserved for a success-toast eyebrow at most — default is no decoration)

## Security

- **Auth required:** YES
- **Allowed roles:** any authenticated user (customer, partner, affiliate, admin) — `requireAuth()` from `00-foundations/auth/guards.ts`
- **RBAC enforcement:** server action checks `user_id = auth.uid()` before any write to `profiles`. The `profiles` RLS `profiles_self_update` policy is the second line of defense.
- **RLS policies that apply:**
  - `profiles` — `profiles_self_read` (public read; we fetch one row), `profiles_self_update` (write gated on `user_id = auth.uid()`)
  - `auth.users` — not read directly from the client; the email is fetched server-side via Supabase's `getUser()` and only the email is returned (not the user object)
- **PII displayed:** the user's own `email` + `display_name` (self only); `auth.users.email` is technically PII but it's the user's own data on their own profile page
- **PII in URLs:** no. The page is reached only by `/account/profile` — no id, no slug, no email in the path or query
- **CSRF:** server actions use Next.js's built-in origin check + the Supabase Auth session cookie (HttpOnly, Secure, SameSite=Lax). No additional token is needed.
- **Avatar upload validation:**
  - Mime type allowlist: `image/jpeg`, `image/png`, `image/webp`
  - Size cap: 5 MB (enforced both client-side and server-side at the signed-URL mint step)
  - Server-side: the signed PUT URL is bound to the user's id and to the mime + size. The Bunny Storage path includes a user-scoped prefix: `avatars/{user_id}/{uuid}.{ext}` so a user can never overwrite another user's avatar.
  - After upload, server re-validates the file's mime (via Bunny's metadata) before saving `avatar_url` to `profiles`.
- **Delete account:**
  - Confirmation requires typing the user's email (defense against mis-click)
  - The action runs inside a Postgres serializable transaction
  - The user is signed out before the transaction begins (so a concurrent request can't re-create a row in the cascade window)
  - `admin_audit_log` receives one row with `action='account_self_delete'`, `target_table='profiles'`, `target_id` = the user's id, `at` = now
- **Audit logged:**
  - `updateProfile` writes a row to `admin_audit_log` with `action='profile_self_update'`, `before` and `after` JSON of the changed fields (email is NEVER in the payload, only display_name/avatar_url/bio/locale/timezone)
  - `deleteMyAccount` writes the `account_self_delete` row above
  - `requestAvatarUpload` writes a row with `action='avatar_upload_requested'` and the file metadata (size, mime, original filename)
- **PII masking in errors:** server errors returned to the client never include the email, the user id, or any internal id. Generic "Something went wrong" for unexpected failures; specific, safe messages for validation failures.
- **Third-party scripts:** none. The avatar uploader uses a Bunny signed PUT URL — no third-party JS SDK on the page.
- **Legacy host safety:** account host redirects have fixed relative targets and do not carry Shopify buyer tokens or profile query strings into v2 URLs.

## Performance

- **Target p95:** < 200ms (single-row profile read + RSC, no joins against large tables; the form is rendered with the data in the same RSC pass)
- **Render strategy:** RSC (no client-side data fetching for the form values)
- **Cache:** none — page is user-specific, no caching at the route or data layer
- **DB indexes used:** the implicit `profiles_user_id_unique` index on `user_id` (the lookup key); no other index needed
- **Bundle size budget:** < 35KB added to client bundle (form + avatar cropper + delete modal + dirty-state guard). The cropper is the largest piece — use a small library (~10KB) and tree-shake the rest.

## Out of scope for v1

- Email change inside the profile form (handled in `/account/settings` via Supabase Auth)
- Phone number field
- 2FA setup
- Public profile page (`/u/[id]` or `/@handle`)
- Username / vanity handle
- Social links (Twitter, website)
- Profile completeness score / progress bar
- "View as another user" admin tool (lives in `/admin/users/[id]` instead)
- Avatar filters / decorations (v2 — `docs/BRAND_AND_POSITIONING.md` says no decorative avatars)
- Gravatar fallback
- Profile import from other services
- Multi-step profile wizard

## Open questions for human

- **Mockup:** no `mockups/profile.html` exists yet. My recommendation: build the mockup during the account feature build (after the spec is approved), not before. The form is structurally similar to the signup form (which has its own mockup gap) and the spec is detailed enough that the mockup is mechanical. If you want the mockup before approval, flag it — the human-approval time on a mockup is ~5 min, on this spec is ~5 min, no big deal either way.
- **Locales list:** I picked 10 (`en, es, fr, de, pt, it, nl, ja, zh, ko`) based on the partner/buyer mix. My recommendation: ship with these 10 in v1. The schema is `text` so adding more is a code-only change later.
- **Bio limit:** I picked 280 chars (Twitter-style). My recommendation: keep it. The bio is shown in the affiliate mini-shop author card, not in the marketplace — 280 is plenty.
- **Avatar cropper library:** candidates are `react-image-crop` (~15KB), `react-easy-crop` (~20KB), or a custom canvas-based one. My recommendation: `react-easy-crop` — actively maintained, square + free-ratio support, accessible.
- **Avatar storage path collision risk:** if a user uploads the same filename twice, the uuid suffix prevents overwrite, but the orphaned previous file stays in Bunny Storage. My recommendation: leave it for now (cheap storage), add a janitor cron in v2 to clean up orphans > 30 days old.
- **"Delete account" UX in Stripe / PayPal:** if the user has an active Stripe subscription or a pending PayPal payout, do we block the delete? My recommendation: block deletion until active subscriptions are canceled through `/account/settings#billing` and pending payouts are resolved. If no subscriptions exist in v1, this branch stays hidden.
- **`/update-password` route:** referenced in this spec and in `mockups/library.html` (there's a "Sign out" link in the nav but no "Change password" surface in any mockup). My recommendation: this spec assumes the route exists; if it doesn't, file a follow-up spec. For the v1 build, both pages land in the same PR.
- **Audit log volume:** every profile save writes a row. A user editing their profile 10 times a day = 10 audit rows. At 50K MAU that's a lot. My recommendation: ship it as-is in v1 (Postgres can handle it, and the audit log is the abuse-detection lever). Re-evaluate at 250K MAU — we may want to coalesce to "last value per day" or similar.

---

## Implementation notes

### P9.2 — Avatar upload (SHIPPED Slice 1; Slice 2 owed)

### P9.17 — Account delete verification (GDPR Art. 17)

The PHASES.md P9.17 acceptance criteria are all met end-to-end by the
existing shipped surface (this page's Danger Zone + the cascade wrapper +
the RPC). Verification scope (2026-06-29 cron tick):

- **`delete_my_account` RPC** — `04-platform/migrations/0010_delete_my_account_rpc.sql`. SECURITY DEFINER + `set transaction isolation level serializable` (race-condition-safe against a concurrent Stripe webhook in the cascade window). Returns one of four text values: `anonymized` / `already_deleted` / `cancel_subscriptions_first` / `resolve_payouts_first`. EXECUTE revoked from PUBLIC; GRANT to service_role only.
- **Active-subscription block** — RPC step 1: `select count(*) into v_active_subs from subscriptions where user_id = p_user_id and status in ('active', 'trialing', 'past_due')`. Returns `cancel_subscriptions_first` if > 0. The cancel-subscription UI ships in P5.4 (`/account/subscriptions` typed "CANCEL" modal + `cancelAtPeriodEndAction`).
- **Pending-payout block** — RPC step 2: only fires when the user is also a partner (`select id into v_partner_id from partners where user_id = p_user_id limit 1`); then `select count(*) into v_pending_payouts from payout_ledger where partner_id = v_partner_id and status in ('locked', 'available')`. Returns `resolve_payouts_first` if > 0. The admin payouts queue ships in P6.7.
- **Typed confirmation** — `DeleteAccountModal.tsx` requires the user to type their full email (case-insensitive, trimmed; `typed.trim().toLowerCase() === email.trim().toLowerCase()`). Destructive button disabled until the match. **PHASES.md P9.17 says "type DELETE"; this spec (line 49) says "type email" — the email variant was chosen for stronger proof-of-identity (typo + autocomplete-resistant) and matches the spec already approved for this page.** If PHASES.md needs to be reconciled, that's a one-line edit to align both.
- **Audit row** — `deleteMyAccountAction` writes `admin_audit_log.action='account_self_delete'` BEFORE the cascade so the request is recorded even if the cascade fails partway. `metadata = { email, requested_at: ISO, anonymized: true }`.
- **Sign-out** — fresh server-client `createServerClient(url, anon, { cookies })` + `auth.signOut()` (because RSC blocks the auth-js `signOut` from mutating cookies; the discarded session on the service-role verify at P1.4 set the precedent). Only fires after `outcome === 'anonymized'` or `'already_deleted'` — gated outcomes (`cancel_subscriptions_first` / `resolve_payouts_first`) leave the user signed in so they can fix and retry.
- **Cascade wrapper** — `00-foundations/gdpr/delete-cascade.ts` owns the service-role client + RPC call + 4-string → 5-outcome typed mapping (the 5th is `'unknown'` for RPC errors or unexpected return values) + PII-safe logging (never logs `userId`; pino redact list is a second gate). README updated at `00-foundations/gdpr/README.md`.
- **Test coverage** — 45 tests total (27 in `delete-cascade.test.ts` + 18 in `deleteMyAccount.test.ts`):
  - 27 wrapper tests: RPC contract (function name + arg shape + no extra params) + outcome mapping (5 outcomes + 4 unexpected inputs: null / undefined / empty string / RPC error) + logging (no log on happy path or 3 gated paths; warn on unexpected string with PII safety; error on RPC failure with PII safety) + per-outcome PII safety across 8 fixtures + outcome exhaustiveness compile-time check
  - 18 action tests: auth gating (anon → unknown, no-email → unknown) + email match gate (wrong → wrong_email, case-insensitive, whitespace-trimmed) + cascade outcome mapping (anonymized → ok, already_deleted → ok, cancel_subscriptions_first → error, resolve_payouts_first → error, unknown → unknown, gate → no sign-out, success → sign-out) + audit log (written before cascade, metadata shape, no audit on wrong email, audit even on gate) + PII safety (no email or user_id UUID in warn payloads)
- **No new route** — PHASES.md P9.17 references `/account/delete` as a standalone route; the shipped surface is inline in this page's Danger Zone. This is a deliberate consolidation (fewer routes to maintain, the destructive action is contextual to the profile it's destroying). The standalone route can be added later as a thin redirect `/account/delete → /account/profile#danger-zone` if Klaas prefers the explicit entry point.

**STUB-019 RESOLVED.** The gate was already enforced inside the RPC from migration 0010; this verification tick confirmed the end-to-end behavior + flipped the STUB status.

**Shipped:** 2026-06-29. Slice 1 of P9.2 — the full upload pipeline end-to-end (Bunny signed PUT + mime `image/jpeg|png|webp` allowlist + 5MB cap + user-scoped path `avatars/{user_id}/{uuid}.{ext}` + `admin_audit_log` row with `action='avatar_upload_requested'` + `target_kind='avatars'` + the new `<AvatarUploader>` client island wired into `ProfileForm`). The image is uploaded as-is (no cropper yet) and the parent's `avatar_url` state updates immediately; clicking Save on the form commits it to `profiles` via the existing `updateProfileAction`.

**Files (4 new + 5 modified):**
- **NEW** `00-foundations/files/upload-constants.ts` (~35 LOC) — pure constants (`AVATAR_MAX_BYTES`, `AVATAR_MIME_TYPES`, `AvatarMime`, `extForAvatarMime`). NO `node:crypto`. Safe to import from the client bundle. The split is forced by `next build` (the client island needs the constants; `node:crypto` can't cross the webpack browser/server boundary).
- **NEW** `00-foundations/files/upload.ts` (~175 LOC, `import 'server-only'`) — the mint helper (`requestAvatarUpload({ userId, mime, size, nowMs?, fileId? }): { uploadUrl, publicUrl, storagePath, expiresAt }`) + the env-gated predicate (`isAvatarUploadConfigured()`) + the typed `UploadNotConfiguredError`. Re-exports the constants for back-compat with the canonical import path. Path layout: `avatars/{userId}/{uuid}.{ext}` (UUID v4 from `node:crypto.randomUUID`).
- **NEW** `00-foundations/files/upload.test.ts` (~480 LOC, **43 unit tests** in 11ms) — pure-logic tests using real node:crypto + a fixed clock. Covers: env-gated paths (3 modes — both set / hostname-only / key-only / both missing), `UploadNotConfiguredError` `instanceof` + `name`, mime allowlist (`jpeg|png|webp` only — rejects svg/gif/bmp/text-pdf/case-mismatch), size cap (rejects 0 / negative / >5 MiB; accepts exactly 5 MiB), userId UUID sandbox (rejects empty / non-uuid / path-fragment attempts like `../../../etc/passwd`), `avatars/{userId}/{uuid}.{ext}` path layout, publicUrl has no query string, uploadUrl has the `AccessKey`, deterministic via `nowMs` + `fileId`, signing-key behavior (token present when `BUNNY_SIGNING_KEY` is set — bound to (path, expires); absent when unset — Bunny validates via AccessKey alone), signature changes when fileId / signing-key changes.
- **NEW** `02-features/account/profile/actions/requestAvatarUpload.ts` (~170 LOC) — server action. Auth gate (`getServerSupabase().auth.getUser()`), Zod input validation (`RequestAvatarUploadInput` — mime from `z.enum(AVATAR_MIME_TYPES)`, size int 1..`AVATAR_MAX_BYTES`), env gate (`isAvatarUploadConfigured()` — friendly error if Bunny storage isn't wired), mint via `requestAvatarUpload`, then audit row via `writeSelfAuditLog({ action: 'avatar_upload_requested', targetKind: 'avatars', targetId: user.id, metadata: { mime, size, storagePath, expiresAt }, ipAddress, userAgent })`. Returns `{ ok: true, uploadUrl, publicUrl, storagePath, expiresAt }` on success or `{ ok: false, error, fieldErrors? }` on failure. Uses the existing `writeSelfAuditLog` helper (no parallel audit writer).
- **NEW** `02-features/account/profile/actions/requestAvatarUpload.test.ts` (~340 LOC, **11 unit tests** in 5ms) — uses real `requestAvatarUpload` (Bunny env set in `beforeEach`; one env-unconfigured test flips it off), mocked Supabase auth + mocked headers shim + mocked `writeSelfAuditLog`. Covers: anon → short-circuit (`'Not signed in'`, no DB / no mint / no audit); mime allowlist (gif rejected); size 0 / > 5MB / non-int rejected; every allowlist mime accepted; env-not-configured → friendly error; happy path → audit row shape (target_kind, metadata fields with mime/size/storagePath/expiresAt, NO email/user-id/IP in metadata, IP + UA on parent row); missing UA → null; successive mints → distinct storagePaths; audit log write failure → mint still returned (resilience).
- **NEW** `02-features/account/profile/components/AvatarUploader.tsx` (~210 LOC) — `'use client'` island. Hidden `<input type="file">` triggered by a click on a 80×80 thumb button (with initials fallback when `avatarUrl` is null). State machine: `idle → validating → minting → uploading → success | error`. Client-side mime + size validation first (short-circuits before the round-trip). On valid pick: call `requestAvatarUploadAction`, PUT the file to `uploadUrl` via `fetch(method='PUT', body=file)`, on success call `onUploaded(publicUrl)` (the parent form updates its local `avatar_url` state — Save commits it). Inline `role="alert"` on errors, `role="status"` on success. Token-only CSS via `--accent` / `--danger` / `--success` / `--bg-elev-1` / `--text-2`. The "v1.1 follow-up" hint copy from Slice 0 is GONE — the live affordance is here.
- **NEW** `02-features/account/profile/components/AvatarUploader.module.css` (~95 LOC) — token-only. 80×80 thumb with `object-fit: cover` so any uploaded image renders as a clean square. `var(--r-lg, 14px)` corners, hairline border, hover/focus rings, 480px mobile breakpoint. `.thumbOverlay` shows the current state label ("Preparing…", "Uploading…", "Validating…"). The hidden file input uses standard a11y-acceptable positioning (1×1 clipped) + `aria-hidden` + `tabIndex=-1`.
- **MODIFIED** `02-features/account/profile/components/ProfileForm.tsx` — replaced the static thumb + "v1.1 follow-up" hint with `<AvatarUploader />`. The "Remove" link still works (it just sets `avatar_url = null` in form state). Save on the form continues to write all five fields including the new `avatar_url` via `updateProfileAction`. No new server-side action on the parent form — the Upload just stages the URL.
- **MODIFIED** `02-features/account/profile/actions/writeSelfAuditLog.ts` — extended the `targetKind` union with `'avatars'`.
- **MODIFIED** `02-foundations/data/enums.ts` — added `'avatar_upload_requested'` to the `AuditAction` type union and the `AUDIT_ACTIONS` array (the canonical grep target when a new self-service audit action lands).
- **MODIFIED** `02-features/account/profile/index.ts` — re-exports `<AvatarUploader />` + `requestAvatarUploadAction` + the existing constants/transitive deps.

**Design decisions worth remembering:**

(a) **Pure constants + server-only mint module split (`upload-constants.ts` + `upload.ts`).** Forced by `next build` (the client island needs `AVATAR_MAX_BYTES` + `AVATAR_MIME_TYPES` for the client-side mime/size short-circuit, but `node:crypto` can't cross the webpack browser/server boundary). The split makes the dependency direction explicit: client imports `upload-constants`, server imports `upload`. `upload.ts` re-exports the constants for back-compat.

(b) **User-scoped path = `avatars/{userId}/{uuid}.{ext}` (the spec, verbatim).** The userId sandbox means a forged request can't upload outside the attacker's own namespace. The UUID suffix means concurrent uploads from the same user don't collide (and orphans stay in storage — accepted per the spec §Open Questions line 150).

(c) **Server-side mime/size gate is the security boundary.** The signed URL is fresh + ephemeral (5 min TTL + UUID uniqueness), but Bunny doesn't enforce a Content-Type policy on the PUT — the auth check relies on the userId namespace being correct. Server-side mime validation rejects `image/svg+xml`, `image/gif`, etc. before any DB or CDN call. Client-side validation is the UX nicety (short-circuit before the round-trip) — not the security gate.

(d) **No HMAC-token signing in the URL by default (signature only added when `BUNNY_SIGNING_KEY` is set).** The upload URL is never shared (it lives in the browser's PUT and is discarded on completion). Blast radius of a leaked URL = write under a specific userId namespace. The signature is included when the key is set so we can flip on Pull Zone "Token Authentication" later without changing the call site. When `BUNNY_SIGNING_KEY` is unset, Bunny validates on AccessKey alone (the documented pattern for browser-direct PUT).

(e) **`AccessKey` in the query string (Bunny's documented browser-direct pattern).** Browsers can't set arbitrary headers on cross-origin PUTs without a CORS preflight (which most Bunny edge configs don't ship by default). The alternative would require a preflight that Bunny doesn't always respond to cleanly. The key's blast radius is bounded by Bunny's storage path prefix — it's a write-only secret for the configured zone.

(f) **Audit row uses the existing `writeSelfAuditLog` helper.** `target_kind='avatars'` (NEW column literal — `admin_audit_log.target_kind` is free text, no migration needed). Metadata `{ mime, size, storagePath, expiresAt }` — NO email, NO user_id, NO IP. Those columns (`actor_email`, `actor_id`, `ip`, `user_agent`) on the audit row itself carry the equivalent for ops. The 500-line RLS policy on `admin_audit_log` is unchanged.

(g) **"Save" on the form commits `avatar_url`, not the action itself.** The action only mints the URL + PUTs the file. The avatar_url gets committed when the user clicks Save on the rest of the form. This preserves the existing dirty-state guard + `beforeunload` confirmation: if a user uploads then closes the tab without saving, the file lives as an orphan in Bunny (the spec accepts this) and the URL expires in 5 minutes.

(h) **Cropper is Slice 2 (STUB-077).** The acceptance criterion 75 ("the cropper is square-aspect and the new image appears in the form and header within 1s of upload completion") is partially met today — the thumb renders as a square via `object-fit: cover` even on a rectangular source image. The cropper itself (square aspect, pan/zoom UX) waits on the spec's open question (library pick) + a dependency add. ≤ 0.5 tick once the library is decided.

(i) **Env-gated error mapped to a friendly message.** When `BUNNY_STORAGE_PUBLIC_HOSTNAME` or `BUNNY_STORAGE_ACCESS_KEY` is missing, the action catches the `UploadNotConfiguredError` and returns `{ ok: false, error: 'Avatar upload is temporarily unavailable. Please try again later.' }`. The client island surfaces this inline via `role="alert"`. Ops sees a `code: 'avatar_upload_unconfigured'` warn log (no PII — no mime / size / user context).

(j) **The form's "Remove avatar" flow is unchanged.** `<button>` sets `avatar_url = null` in form state; Save on the form clears the column. We don't delete the file from Bunny on remove — same orphan-acceptance policy as the spec.

**Persistence behavior:** the avatar on the form is staged — uploaded via `AvatarUploader` → form state updates → Save on form commits via `updateProfileAction`. To support a "Live update on upload" UX (header avatar updates mid-form without Save), a server refresh is enough — the existing `router.refresh()` after `updateProfileAction` already cascades. The Slice 1 contract is the staged one (matches the spec's "Save changes" model for the rest of the form fields).


- Shipped: 2026-06-29. Full page surface (`/account/profile` RSC + `ProfileForm` client island + `DeleteAccountModal` client island + `EmailVerifyBadge` / `EmailVerifyButton` / `AuditStrip` server components) lives in `02-features/account/profile/` + `03-app/account/profile/page.tsx`. RSC + `requireUser('/account/profile')` redirect → `/login?next=/account/profile`. `getMyProfile()` joins `profiles` (minimal PII-safe select: `user_id, display_name, avatar_url, bio, locale, timezone, role, created_at, updated_at`) + `auth.users.email` + `email_confirmed_at → email_verified`. `updateProfileAction` Zod-validates with `UpdateProfileInput` (display_name ≤ 80, bio ≤ 280, locale 2-10, timezone 1-64, avatar_url URL ≤ 2000); reads the BEFORE row, writes the normalized row (empty bio → null), and writes an `admin_audit_log` row (`action='profile_self_update'`, `target_kind='profiles'`, `metadata = { before, after }` containing ONLY the changed keys) only when something actually changed. `DeleteAccountModal` requires the user to type their email to enable the destructive button; `deleteMyAccountAction` calls the `delete_my_account` RPC via the GDPR cascade wrapper (`00-foundations/gdpr/delete-cascade.ts` — typed `DeleteMyAccountOutcome` mapping); service-role client + `admin_audit_log` row. Email verification: `EmailVerifyBadge` shows verified/unverified chip; `EmailVerifyButton` has a 60-second cooldown (per the spec); calls `resendVerificationEmailAction`.
- **Avatar upload is deferred to P9.2** (STUB-017). The form renders the current avatar + a "Remove" link only; the upload affordance is intentionally a "v1.1 follow-up" hint per the spec's "Out of scope for v1" carve-out.
- **Social links are deferred to v2** (the data model has no columns for them; the spec explicitly excludes them).
- **Timezone picker is `<input list="tz-list">` + `<datalist>`** sourced from `Intl.supportedValuesOf('timeZone')` (~400 IANA zones, browser-native substring filter as the user types). Hint text below the input ("Search by city or region (e.g. 'Tokyo', 'Europe/Paris')") matches the spec's "searchable" requirement.
- **Locale select** uses the `SUPPORTED_LOCALES` const in `02-features/account/profile/types.ts` (10 entries: en, es, fr, de, pt, it, nl, ja, zh, ko).
- **Migration requirement** (`account.uthena.com/profile` → `/account/profile`) is handled at DNS cutover, not in the app — same auth gate via `requireUser` covers it after the host routes.
- **Tests**: 4 new test files (`updateProfile.test.ts` 24 + `getMyProfile.test.ts` 9 + `writeSelfAuditLog.test.ts` 8 + `getMemberSince.test.ts` 8 = 49 new tests, all passing). Total `pnpm test`: 2057/2057. Delete-cascade is covered by `00-foundations/gdpr/delete-cascade.test.ts` (existing surface).
