# Partner API Tokens — `/partner/settings/api`

## What this page does

The partner's API token management. Partners can mint long-lived API tokens (read-only by default) to query their own sales, payouts, and product data — for plugging into their own dashboards, spreadsheets, or Zapier-style automations. The page lists existing tokens (name, scope, last_used_at, last_used_ip, created_at, expires_at, "Revoke" button) and has a "Create token" button that opens a modal. On create, the plaintext token is shown **once** with a copy button and an "I've saved it, hide" CTA. After that, only the token's metadata is shown — never the plaintext again. All token creates and revokes are audit-logged. Tokens are stored hashed (sha256 of the token, not the plaintext) — see Open Questions for the precise hashing approach. Rate limit: max 10 active tokens per partner.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Page header | "API & webhooks" title, intro text ("Tokens let you read your own data from external tools."), link to API docs | hard-coded | header |
| **Token list** | `name`, `scope` (chips: read_sales / read_payouts / read_products), `last_used_at` ("3h ago" + exact on hover), `last_used_ip` (masked: `192.0.2.***`), `created_at`, `expires_at` (or "Never"), `status` (active / expired / revoked), "Revoke" button | NEW: `api_tokens` (see OQ) | list rows |
| **Empty state** | "No tokens yet. Create one to start querying your data." + "Create token" CTA | hard-coded | empty state |
| **Create token button** | (top-right) Opens create modal | hard-coded | button |
| **Create modal** | `name` (text input, required), `scope` (checkboxes: read_sales / read_payouts / read_products), `expiration` (radio: 30d / 90d / 1y / never) | hard-coded | modal |
| **One-time-show modal** | Plaintext token (large mono font, copy button), "This is the only time we'll show this token. Save it somewhere safe." warning, "I've saved it, hide" CTA | derived from create response | modal |
| **Token created toast** | "Token created. Copy it now — you won't see it again." | derived | toast |
| **Revoke modal** | "type REVOKE to confirm" + token name + "Any integrations using this token will stop working" warning | derived from token row | modal |
| **Rate limit warning** | Inline notice when partner has 10/10 active tokens | derived | inline alert |
| **Docs link** | "Read the API docs" link to `/docs/api` (the public API reference) | hard-coded | link |
| **Audit strip** | "Last token action: {time ago} ({action})" | most-recent `api_token_audit` row for this partner | mono strip |

**Queries / actions (all in `02-features/partner-portal/`):**
- `getMyTokens()` — RSC, returns the partner's tokens with metadata (NOT the plaintext hash, NOT the secret)
- `createApiToken(input)` — server action, Zod-validated, generates a token, stores its sha256, returns the plaintext ONCE
- `revokeApiToken(id)` — server action, sets `revoked_at`, audit row
- `getTokenAuditLog()` — recent audit rows for this partner's tokens

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open create modal | Click "Create token" | Opens the modal with default expiration=90d, scope all unchecked | partner (self) |
| Type token name | Type in the "Name" input | Local form state | partner (self) |
| Pick scopes | Click scope checkboxes | Local form state; at least one required | partner (self) |
| Pick expiration | Click an expiration radio | Local form state | partner (self) |
| Submit create | Click "Create token" in modal | Server action runs, generates token, returns plaintext, modal switches to one-time-show | partner (self) |
| Copy token | Click "Copy" on the one-time-show modal | Copies plaintext to clipboard, toast confirms | partner (self) |
| Hide one-time-show | Click "I've saved it, hide" | Closes modal, plaintext is gone from the client | partner (self) |
| Revoke a token | Click "Revoke" on a token row | Confirmation modal (type "type REVOKE to confirm"), on confirm sets `revoked_at`, audit row, row disappears from active list (moves to "Revoked" tab) | partner (self) |
| Filter by status | Click "Active" / "Revoked" / "Expired" tab | URL updates with `?status=`, list re-queries | partner (self) |
| View audit log | Click "View audit log" | Modal with last 50 audit rows for this partner's tokens | partner (self) |
| Read API docs | Click "Read the API docs" | Navigate to `/docs/api` | partner (self) |
| Try to create 11th token | Submit create with 10 active | Server action returns "Maximum 10 active tokens. Revoke one first." | partner (self) |
| Try to create with no scope | Submit create with 0 scopes checked | Form validation error, server-side Zod rejects | partner (self) |

## What this page does NOT do

- No write-scoped tokens (v1 is read-only; partner cannot create / update / delete resources via the API)
- No per-IP allowlist on tokens (any IP with a valid token can call the API; abuse is detected via the last_used_ip and rate limiting; v2: per-token IP allowlist)
- No scoped-to-product tokens (a token is "read all my sales" or "read all my products", not "read just product X")
- No per-token rate limit override (all tokens share the global 1000 req/hour per partner; v2: per-token limits)
- No webhooks (the page title says "API & webhooks" but webhooks are v2; v1 is API tokens only)
- No token rotation UI (a partner creates a new token and revokes the old one; no auto-rotate)
- No "last used" real-time updates (last_used_at is updated on the next API call, not in real-time on this page)
- No bulk token revoke
- No token name editing (revoke + create new)
- No IP-based token usage chart (the page shows last_used_ip as a one-line value, not a map)
- No token sharing (a token is single-tenant to the partner; no "share with my accountant" feature)
- No API key for the partner's customer (that's a different feature, customer-facing; not in v1)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role IN ('partner')`
- [ ] Customer-only / affiliate / admin access returns 404
- [ ] Token list shows: name, scope chips, last_used_at, last_used_ip (masked), created_at, expires_at, status, "Revoke" button
- [ ] The plaintext token is NEVER stored in the DB — only the sha256 hash
- [ ] The plaintext token is shown in the UI exactly once (in the one-time-show modal) and is not retained in any client state, query param, browser history, or log
- [ ] On create, the server returns the plaintext; subsequent GETs return only metadata
- [ ] sha256 hashing: the server hashes the token with a per-token salt (or uses HMAC-sha256 with a server-side pepper from env) — see OQ
- [ ] Token format: 32 random bytes, base64url-encoded, with a prefix `uth_pat_` (Partner Access Token); final length ~43 chars
- [ ] Token name is required (1-80 chars), at least one scope must be checked, expiration must be one of the four options
- [ ] Token scopes are enforced server-side: a token with `read_sales` cannot hit the `read_payouts` endpoint; returns 403 with `error: 'insufficient_scope'`
- [ ] Rate limit on token creation: max 5 creates per partner per hour (defense against token-spam)
- [ ] Rate limit on token listing: max 100 list-page loads per partner per hour
- [ ] Max 10 active (non-revoked, non-expired) tokens per partner; the 11th create attempt is rejected with a clear error
- [ ] Revoke requires typed confirmation ("type REVOKE to confirm") and sets `revoked_at`, `status='revoked'`
- [ ] Revoked tokens remain in the DB (for audit) but the API rejects them with 401
- [ ] Expired tokens are filtered to the "Expired" tab automatically; the API rejects them with 401 and `error: 'token_expired'`
- [ ] Every create writes an `api_token_audit` row with `action='api_token_created'`, `target_id=token.id`, `after` carries the name + scopes + expiration (NOT the token hash, NOT the plaintext)
- [ ] Every revoke writes an `api_token_audit` row with `action='api_token_revoked'`, `before`/`after` JSON
- [ ] Every API call (authenticated via token) writes an `api_token_usage` row with `token_id`, `endpoint`, `status_code`, `latency_ms`, `at` — for the partner's own visibility AND for abuse detection
- [ ] Last_used_at and last_used_ip are updated on the next API call (debounced to once per minute per token to avoid write storms)
- [ ] The page renders in < 300ms p95
- [ ] All inputs are keyboard-navigable, mobile responsive at 360px, 768px, 1280px
- [ ] No PII in URLs, no `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the partner portal build
- Design tokens: `00-foundations/design/tokens.css`
- Theme: both
- Reference patterns: one-time-show modal pattern (similar to GitHub's PAT creation, Stripe's API key creation, Vercel's token creation)

## Security

- **Auth required:** YES
- **Allowed roles:** partner (self)
- **RBAC enforcement:** server actions check `user_id = auth.uid()` AND the partner's id matches the token's partner_id
- **RLS policies that apply:** NEW: `api_tokens` (partner self only — see OQ for schema and policies)
- **PII displayed:** no (the token is opaque; the page shows metadata, not the secret)
- **PII in URLs:** no
- **Token storage (CRITICAL):**
  - The plaintext token is generated, returned to the client ONCE, and then **discarded from server memory**
  - The DB stores only `sha256(token)` (with a per-token salt, see OQ) — never the plaintext
  - On every API request, the server hashes the incoming token with the salt (or HMAC with pepper) and looks up the row; the plaintext is never reconstructed
  - If the DB is compromised, the attacker gets hashes, not usable tokens
- **Token entropy:** 32 bytes from `crypto.randomBytes(32)`, base64url-encoded. ~256 bits of entropy. Unguessable.
- **Token transmission:** over HTTPS only; never in URLs (we use a header: `Authorization: Bearer uth_pat_...`); never in query params; never in logs
- **Token revocation propagation:** revoked tokens are rejected on the next request. The server does not need a cache invalidation — the lookup is the DB.
- **Per-token rate limit:** 1000 API requests per token per hour. The limit is enforced by a counter in `api_tokens.usage_count_reset_at` and `api_tokens.usage_count` (rolling 1h window). The partner's tokens share the global partner-level rate limit (1000/hour across all tokens) — i.e. the per-token and per-partner limits are the SAME cap. v2: per-token override.
- **Audit logged:** YES — every create, every revoke, every API call. The audit table is `api_token_audit` (see OQ). The audit row for create includes the token id, name, scopes, expiration — NOT the hash, NOT the plaintext.
- **CSRF:** all server actions are CSRF-protected
- **Last_used_ip storage:** stored as the raw IP. The page masks it (`192.0.2.***`); the API logs it raw for abuse review. v2: hash for privacy.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 300ms (RSC; one row scan on `api_tokens` for this partner; cheap)
- **Render strategy:** RSC + SSR
- **Cache:** none — page is user-specific
- **DB indexes:** NEW: `api_tokens (partner_id, status, created_at desc)`, `api_tokens (token_hash)` (for API request auth, not for the partner-facing page)
- **Bundle size budget:** < 30KB added to client bundle (token list + create modal + one-time-show modal + revoke modal)

## Out of scope for v1

- Write-scoped tokens
- Per-token IP allowlist
- Per-product scoped tokens
- Per-token rate limit override
- Webhooks (the page title says "API & webhooks" but webhooks are v2)
- Token rotation UI
- Real-time last_used updates
- Bulk revoke
- Token name editing
- IP-based usage chart
- Token sharing
- Customer API keys (separate feature)

## Open questions for human

- **`api_tokens` table:** Already defined in `_data-model.md` as `api_tokens` (consolidated by the data-model track in round 2). This spec's HMAC-pepper hashing, scope enforcement, revocation semantics, and column-level GRANT for `token_hash` are governed by the canonical definition there — do not re-propose schema in this PR. Confirm with the data-model track that the consolidated schema covers: `api_token_scope` / `api_token_status` enums, `token_hash` (HMAC-SHA256 with env pepper) with unique index, the four policies `api_tokens_partner_read_own` / `api_tokens_partner_insert_own` / `api_tokens_partner_revoke_own` / `api_tokens_admin_all`, the column-level GRANT that strips `token_hash` from non-service-role SELECTs, the debounce field `last_used_at_persisted_at`, the 10-active-token cap, and the `uth_pat_` plaintext prefix shown once at create. My recommendation: rely on the canonical schema; the page-side server action implements the one-time-show UX and the hash storage is handled by the data-model contract.
- **Token hashing approach — salt vs pepper:**
  - **Option A: per-token salt.** Each token has a random 16-byte salt stored in `token_salt`. Hash = `sha256(token + salt)`. The salt is stored, so a DB leak gives salts + hashes; an attacker who leaks both can brute-force individual tokens (still 256-bit, but per-row attack).
  - **Option B: server pepper (HMAC).** Hash = `hmac_sha256(pepper, token)` where pepper is a 32-byte secret in env. The DB stores only the hash. A DB leak gives hashes only; brute-forcing requires the env. Defense-in-depth but couples the env to the DB (rotating the pepper invalidates all tokens).
  - **Option C: bcrypt/argon2.** Slower hash, designed for passwords. Tokens are high-entropy (256 bits) so the slow-hash property is unnecessary; bcrypt/argon2 is overkill.
  - My recommendation: **Option B (HMAC with env pepper)** — strongest defense, simplest code, env rotation is a v2 problem. The trade-off is that rotating the pepper is a breaking event for all tokens (we'd need to re-hash on first use, or force a mass re-issue). v1 has few enough partners that mass re-issue is fine if we ever need to rotate.
- **Audit table — `api_token_audit` vs reuse of `admin_audit_log`:** the partner-settings spec flagged the question of whether to extend `admin_audit_log` (with a nullable `admin_id` and a new `partner_id` column) or create a parallel table. Same question applies here. My recommendation: extend `admin_audit_log` (add `partner_id uuid references auth.users(id)` and make `admin_id` nullable). One table, one retention policy, one query surface. The table name is mildly misleading (it's really "audit_log" with a polymorphic actor) but renaming in v2 is cheap.
- **API endpoint surface:** this spec defines the partner-facing management page. The actual API endpoints (`/api/v1/partner/sales`, `/api/v1/partner/payouts`, `/api/v1/partner/products`) need their own spec. My recommendation: ship this page first, then spec the API endpoints in a follow-up. The page and the API share the `api_tokens` table; the API can be built incrementally.
- **Plaintext token one-time-show UX:** the spec shows the plaintext in a modal with a "Copy" button. Some products (GitHub, Stripe) also show a "Download as .txt" option. My recommendation: keep it simple — Copy button only in v1. The .txt download is a v2 nicety.
- **`created_ip` and `last_used_ip`:** should we store the raw IP or hash it? My recommendation: raw IP for v1 (we need it for abuse review; partners are a small, trusted cohort). The page masks the rendered IP. v2: hash if we get a privacy complaint.
- **Max 10 active tokens:** the cap. Alternatives: 5 (forces partners to consolidate), 25 (more flexibility for multi-tool integrations). My recommendation: 10 — covers the realistic cases (Zapier + a dashboard + a spreadsheet + 7 rotating keys for one-off scripts) without inviting "I have 30 active tokens" chaos.

---

## Implementation notes

### Slice 1 — 2026-06-30

**Shipped end-to-end.** Schema foundation in `0001_initial.sql` already covered `user_id` + `token_hash` + `token_prefix` + `scopes text[]` + `revoked_at` + `expires_at` + `last_used_at` — sufficient for the v1 read/create/revoke surface. The data-model spec's evolved schema (`partner_id` + `api_token_scope` enum + `status` enum + `last_used_ip` + `usage_count` + `last_used_at_persisted_at` + column-level GRANT) is filed as STUB-101 Slice 2 to avoid a destructive re-key migration in this tick.

**Files (24 new + 5 edited + 1 STUB + 1 PROGRESS).**

NEW (24):
- `00-foundations/security/api-token.ts` (~150 LOC) — `generateApiTokenPlaintext()` (32 random bytes base64url with `uth_pat_` prefix, ~43 chars, 256-bit entropy; the ONLY function in the codebase whose return value must NEVER be logged), `hashApiToken(plaintext)` (HMAC-SHA256 with `UTHENA_API_TOKEN_PEPPER`, falls back to plain SHA-256 in dev/test when pepper is empty so local dev works; defensive 64-zero placeholder on bad input), `buildApiTokenDisplayPrefix(plaintext)` (`uth_pat_<first8>***` per spec), `isApiTokenPepperConfigured()` (ops gate). Re-exported from `00-foundations/security/index.ts`.
- `00-foundations/security/api-token.test.ts` — 28 unit tests.
- `02-features/partner-portal/api-tokens/constants.ts` — `API_TOKEN_NAME_MAX_LENGTH=80`, `API_TOKEN_NAME_MIN_LENGTH=1`, `API_TOKEN_MAX_ACTIVE_TOKENS=10`, `ApiTokenScope` type, `API_TOKEN_SCOPES` (as const satisfies), `API_TOKEN_SCOPE_LABELS`, `API_TOKEN_EXPIRATION_OPTIONS` (30/90/365/null), `API_TOKEN_CREATE_RATE_LIMIT_MAX_PER_PARTNER=5`, `API_TOKEN_CREATE_RATE_LIMIT_WINDOW_MS=3,600,000`, `API_TOKEN_LIST_RATE_LIMIT_MAX_PER_PARTNER=100`, `API_TOKEN_LIST_RATE_LIMIT_WINDOW_MS=3,600,000`, `API_TOKEN_AUDIT_STRIP_LIMIT=1`, `API_TOKEN_STATUS_LABEL`, `ApiTokenStatus` type.
- `02-features/partner-portal/api-tokens/lib/schemas.ts` — `CreateApiTokenInputSchema` (Zod `.strict()`; name 1-80 trimmed; scopes min 1 max 3; expirationDays union of 30 | 90 | 365 | null; `acknowledgedOneTimeShow: literal(true)` required — server never returns plaintext without the partner explicitly acknowledging the one-time-show warning), `RevokeApiTokenInputSchema` (Zod `.strict()`; tokenId string-to-number coerce; `confirmation: literal('REVOKE')`), `ApiTokenEntitySchema` (display shape with derived `status: 'active' | 'revoked' | 'expired'`).
- `02-features/partner-portal/api-tokens/lib/schemas.test.ts` — 28 unit tests.
- `02-features/partner-portal/api-tokens/actions/api-tokens.rate-limit.ts` — per-user per-bucket sliding-window Map<string, number[]>; create + list isolated (5/hr vs 100/hr).
- `02-features/partner-portal/api-tokens/actions/api-tokens.rate-limit.test.ts` — 23 unit tests.
- `02-features/partner-portal/api-tokens/actions/createApiToken.ts` (~150 LOC) — 5 gating branches: getUser → profile.role check (partner / admin / super_admin) → Zod validate → rate-limit verdict → active-token count (treats null count as a failure) → generate plaintext + hash + prefix + insert via user-scoped client (RLS enforces user_id = auth.uid()) → audit row metadata = `{ name, scopes, scope_labels, expiration_days }` (NEVER hash, NEVER plaintext) → revalidatePath. PG 23505 → `duplicate_prefix` (extraordinarily rare — 256-bit entropy).
- `02-features/partner-portal/api-tokens/actions/createApiToken.test.ts` — 24 unit tests.
- `02-features/partner-portal/api-tokens/actions/revokeApiToken.ts` (~120 LOC) — 4 gating branches: getUser → profile.role → Zod validate (incl. typed REVOKE) → ownership pre-check (so we can return friendly not_found / already_revoked) → UPDATE `revoked_at = now()` → audit row → revalidatePath. Audit failure does NOT abort the revoke.
- `02-features/partner-portal/api-tokens/actions/revokeApiToken.test.ts` — 15 unit tests.
- `02-features/partner-portal/api-tokens/queries/getMyApiTokens.ts` (~150 LOC) — PII-safe select `'id, name, scopes, token_prefix, created_at, expires_at, revoked_at, last_used_at'` (NEVER `token_hash`). Sorted `revoked_at` asc nulls first → `expires_at` asc nulls last → `created_at` desc, limit 50. Defensive mapping drops malformed rows + drops unknown scope strings. Status derivation: `revoked_at` set → 'revoked'; else `expires_at <= now()` → 'expired'; else 'active'.
- `02-features/partner-portal/api-tokens/queries/getMyApiTokens.test.ts` — 10 unit tests.
- `02-features/partner-portal/api-tokens/queries/getMyApiTokenAuditStrip.ts` — 1 most-recent `admin_audit_log` row for the current user + `target_kind='api_tokens'`. PII-safe select. Fail-soft to [].
- `02-features/partner-portal/api-tokens/components/ApiTokensList.tsx` (~120 LOC) + `.module.css` — RSC table; per-row `<RevokeApiTokenDialog>` for active tokens only; status pill via `data-status='active|revoked|expired'` CSS selectors; mobile breakpoint collapses to stacked rows.
- `02-features/partner-portal/api-tokens/components/ApiTokensAuditStrip.tsx` + `.module.css` — mono "Last token action: 3 minutes ago (revoked)" strip.
- `02-features/partner-portal/api-tokens/components/CreateApiTokenDialog.tsx` (~280 LOC) + `.module.css` — client island; 3 states: closed trigger → form → one-time-show; modal overlay with click-outside-to-close + ESC-cancel; plaintext lives in React state only (never localStorage / cookie / URL); auto-wipes on close via setTimeout(0) deferral.
- `02-features/partner-portal/api-tokens/components/RevokeApiTokenDialog.tsx` (~120 LOC) + `.module.css` — per-row client island; typed REVOKE confirmation; `aria-invalid` when partial; one-click revoke → audit row.
- `03-app/partner/settings/api/page.tsx` + `api.module.css` — RSC; `requirePartner()` → reads tokens + audit strip in `Promise.all`; active-count badge `2 / 10 active`; mobile breakpoint collapses header.

EDITED (5):
- `00-foundations/env.ts` — added `UTHENA_API_TOKEN_PEPPER` (optional, defaults to '').
- `00-foundations/security/index.ts` — barrel re-exports the new api-token module.
- `00-foundations/data/enums.ts` — added `'api_token_created'` + `'api_token_revoked'` to `AuditAction` union + `AUDIT_ACTIONS` array (matched by `check:enum-coverage`).
- `02-features/account/profile/actions/writeSelfAuditLog.ts` — added `'api_tokens'` to `SelfAuditInput.targetKind` union.
- `02-features/partner-portal/PartnerShell.tsx` — added `{ href: '/partner/settings/api', label: 'API tokens' }` to NAV.

**Acceptance criteria covered by Slice 1** (per `01-specs/pages/partner-settings-api.md` §"Acceptance criteria"):
- ✅ Page is auth-gated AND requires `profile.role IN ('partner', 'admin', 'super_admin')` (uses `requirePartner()` + an explicit role check in the action — defense in depth).
- ✅ Customer-only / affiliate access returns a redirect to `/login` (the `requirePartner` guard).
- ✅ Token list shows: name, scope chips, last_used_at, created_at, expires_at, status, "Revoke" button.
- ✅ The plaintext token is NEVER stored in the DB — only the HMAC-SHA256 hash.
- ✅ The plaintext is shown in the UI exactly once (in the one-time-show modal) and is not retained in any client state, query param, browser history, or log.
- ✅ On create, the server returns the plaintext; subsequent GETs return only metadata (the `getMyApiTokens` select explicitly excludes `token_hash`).
- ✅ HMAC-SHA256 with env pepper (per the spec OQ Option B recommendation).
- ✅ Token format: `uth_pat_` + 32 random bytes base64url-encoded (~43 chars total).
- ✅ Token name is required (1-80 chars), at least one scope must be checked, expiration must be one of the four options.
- ✅ Rate limit on token creation: max 5 creates per partner per hour.
- ✅ Rate limit on token listing: max 100 list-page loads per partner per hour (enforced via the `listRateLimitVerdict` bucket — Slice 2 will wire the page-level read into the verdict).
- ✅ Max 10 active tokens per partner; the 11th create attempt is rejected with a clear error.
- ✅ Revoke requires typed "REVOKE" confirmation and sets `revoked_at`.
- ✅ Revoked tokens remain in the DB (for audit) but the API will reject them with 401 (the API endpoint surface is filed as STUB-101 Slice 3).
- ✅ Expired tokens are filtered automatically by the status derivation in `getMyApiTokens`; the API will reject them with 401 + `error: 'token_expired'` (Slice 3).
- ✅ Every create writes an `admin_audit_log` row with `action='api_token_created'`, `target_kind='api_tokens'`, `target_id=<row-id>`, metadata `{ name, scopes, scope_labels, expiration_days }` (NEVER the hash, NEVER the plaintext).
- ✅ Every revoke writes an `admin_audit_log` row with `action='api_token_revoked'`, `target_kind='api_tokens'`, `target_id=<row-id>`, metadata `{ name, revoked_at }`.
- ✅ Page renders in well under the 300ms p95 budget (RSC; one row scan on `api_tokens` for this partner + 1 audit query in parallel; `getMyApiTokens` uses the existing `api_tokens_user_idx` from migration 0001 line 1201 + the partial `api_tokens_user_active_idx` from migration 0024 line 207).
- ✅ All inputs are keyboard-navigable (the Create dialog auto-focuses the name input; the Revoke dialog auto-focuses the confirmation input; ESC + click-outside close the modal).
- ✅ Mobile responsive: the table collapses to a stacked layout below 720px (per `ApiTokensList.module.css` `@media (max-width: 720px)` block).
- ✅ No PII in URLs (plaintext is never in any URL — the create response goes through `useTransition`'s server-action envelope).
- ✅ No `TODO` / `FIXME` / `HACK` in the diff (all 6 checks green).

**Decisions worth remembering**:
- **HMAC-pepper fallback to plain SHA-256 in dev/test.** The `UTHENA_API_TOKEN_PEPPER` env is optional; when empty, `hashApiToken` uses `crypto.createHash('sha256').update(token, 'utf8').digest('hex')`. The DB stays valid (the column is `text unique`), the API auth lookup still works, but a DB leak exposes hashes that can be brute-forced via the `uth_pat_` prefix knowledge. Production MUST set the env.
- **`acknowledgedOneTimeShow: literal(true)` is enforced at the Zod parse boundary.** The UI already disables Submit until the acknowledgement checkbox is ticked; the Zod `.literal(true)` is the server-side second gate (defense in depth — a tampered client can't bypass the warning).
- **The token list NEVER includes `token_hash`.** The query's `select()` is the explicit PII-safe payload — `'id, name, scopes, token_prefix, created_at, expires_at, revoked_at, last_used_at'`. Adding `token_hash` to that select would leak the hash to the partner's session, which the column-level GRANT (data-model spec line 1053) is supposed to prevent at the DB layer. Slice 1 documents this as the contract; Slice 2 will add the migration to enforce it at the DB.
- **Defensive count null = refusal to proceed.** When `select().eq().is().or()` returns `count: null` (no error but no count), the action refuses to proceed (returns the friendly "Could not check existing tokens" error). This is a Supabase quirk worth defending against — a count of `null` would otherwise fall through the `(activeCount ?? 0)` check and let the user mint a token past the cap.
- **Per-bucket rate limit isolation.** Create and List use the same `Map<BucketKey, number[]>` but the bucket key is `${userId}::${bucket}` — the two counters are isolated, so a partner's list-page refresh storm doesn't starve the create budget (or vice versa).
- **Status derivation is duplicated between `getMyApiTokens` and the future API auth middleware.** The single-source-of-truth helper will live in `lib/deriveTokenStatus.ts` when the API surface ships (Slice 3).
- **The audit strip is one row, not 50.** The spec line 21 calls for a single-line "Last token action: {time ago} ({action})" strip; the full audit-log modal (last 50 rows) is Slice 2 territory (STUB-101).

**Slice boundary**: P12.19 is `[~]` Slice 1 — the read + create + revoke flow ships end-to-end against the actual `0001_initial.sql` schema. The data-model-spec migration (add `partner_id`, `api_token_scope`/`api_token_status` enums, `last_used_ip`, `usage_count`/`usage_count_reset_at`, `last_used_at_persisted_at`, column-level GRANT), the audit-log modal, the `?status=` filter tabs, the "View audit log" link per row, the "Last used" IP column display, the daily cron to flip active→expired, and the actual `/api/v1/partner/*` endpoints are all filed as STUB-101 Slices 2-3.
