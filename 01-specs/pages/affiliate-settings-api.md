# Affiliate API Tokens — `/affiliate/settings/api`

## What this page does

The affiliate's API token management. Affiliates can mint long-lived API tokens (read-only by default) to query their own click, commission, link, and payout data — for plugging into their own dashboards, spreadsheets, or Zapier-style automations. The page lists existing tokens (name, scope, last_used_at, last_used_ip, created_at, expires_at, "Revoke" button) and has a "Create token" button that opens a modal. On create, the plaintext token is shown **once** with a copy button and an "I've saved it, hide" CTA. After that, only the token's metadata is shown — never the plaintext again. All token creates and revokes are audit-logged. Tokens are stored HMAC-hashed (sha256 of the token, with a server-side pepper from env) — see Open Questions for the precise hashing approach. Rate limit: max 5 active tokens per affiliate.

The shape is intentionally identical to `/partner/settings/api` (same data model, same UX, same security properties) so an affiliate who also sells as a partner uses the same mental model for both surfaces. The two pages differ only in: which row of `api_tokens` they see, the token prefix (`uth_aat_` for affiliates, `uth_pat_` for partners), and the available scopes (affiliate sees affiliate-scoped reads; partner sees partner-scoped reads — see OQ §1).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Page header | "API & webhooks" title, intro text ("Tokens let you read your own data from external tools."), link to API docs | hard-coded | header |
| **Token list** | `name`, `scope` (chips: read_clicks / read_commissions / read_links / read_payouts), `last_used_at` ("3h ago" + exact on hover), `last_used_ip` (masked: `192.0.2.***`), `created_at`, `expires_at` (or "Never"), `status` (active / expired / revoked), "Revoke" button | `api_tokens` (rows where `affiliate_id = self` — see OQ §1) | list rows |
| **Empty state** | "No tokens yet. Create one to start querying your data." + "Create token" CTA | hard-coded | empty state |
| **Create token button** | (top-right) Opens create modal | hard-coded | button |
| **Create modal** | `name` (text input, required), `scope` (checkboxes: read_clicks / read_commissions / read_links / read_payouts), `expiration` (radio: 30d / 90d / 1y / never) | hard-coded | modal |
| **One-time-show modal** | Plaintext token (large mono font, copy button), "This is the only time we'll show this token. Save it somewhere safe." warning, "I've saved it, hide" CTA | derived from create response | modal |
| **Token created toast** | "Token created. Copy it now — you won't see it again." | derived | toast |
| **Revoke modal** | "type REVOKE to confirm" + token name + "Any integrations using this token will stop working" warning | derived from token row | modal |
| **Rate limit warning** | Inline notice when affiliate has 5/5 active tokens | derived | inline alert |
| **Docs link** | "Read the API docs" link to `/docs/api/affiliate` (the affiliate API reference) | hard-coded | link |
| **Audit strip** | "Last token action: {time ago} ({action})" | most-recent `admin_audit_log` row for this affiliate's tokens (filter: `action in ('api_token_created', 'api_token_revoked')` and `affiliate_id = self`) | mono strip |

**Queries / actions (all in `02-features/affiliate-portal/`):**
- `getMyAffiliateApiTokens()` — RSC, returns the affiliate's tokens with metadata (NOT the plaintext hash, NOT the secret). Filters `api_tokens.affiliate_id = self`. The `token_hash` column is excluded by the column-level GRANT on `api_tokens` — the partner-facing equivalent does the same.
- `createAffiliateApiToken(input)` — server action, Zod-validated, generates a token, stores its HMAC, returns the plaintext ONCE. Sets `affiliate_id = self` (partner_id is null). Rejects when the affiliate has 5/5 active tokens.
- `revokeAffiliateApiToken(id)` — server action, sets `status='revoked'` and `revoked_at`, audit row. Validates `affiliate_id = self` before any write.
- `getAffiliateApiTokenAuditLog()` — recent audit rows for this affiliate's tokens (joined to `admin_audit_log` filtered by `affiliate_id`).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open create modal | Click "Create token" | Opens the modal with default expiration=90d, scope all unchecked | affiliate (self) |
| Type token name | Type in the "Name" input | Local form state | affiliate (self) |
| Pick scopes | Click scope checkboxes | Local form state; at least one required | affiliate (self) |
| Pick expiration | Click an expiration radio | Local form state | affiliate (self) |
| Submit create | Click "Create token" in modal | Server action runs, generates token, returns plaintext, modal switches to one-time-show | affiliate (self) |
| Copy token | Click "Copy" on the one-time-show modal | Copies plaintext to clipboard, toast confirms | affiliate (self) |
| Hide one-time-show | Click "I've saved it, hide" | Closes modal, plaintext is gone from the client | affiliate (self) |
| Revoke a token | Click "Revoke" on a token row | Confirmation modal (type "REVOKE" to confirm), on confirm sets `revoked_at`, audit row, row disappears from active list (moves to "Revoked" tab) | affiliate (self) |
| Filter by status | Click "Active" / "Revoked" / "Expired" tab | URL updates with `?status=`, list re-queries | affiliate (self) |
| View audit log | Click "View audit log" | Modal with last 50 audit rows for this affiliate's tokens | affiliate (self) |
| Read API docs | Click "Read the API docs" | Navigate to `/docs/api/affiliate` | affiliate (self) |
| Try to create 6th token | Submit create with 5 active | Server action returns "Maximum 5 active tokens. Revoke one first." | affiliate (self) |
| Try to create with no scope | Submit create with 0 scopes checked | Form validation error, server-side Zod rejects | affiliate (self) |

## What this page does NOT do

- No write-scoped tokens (v1 is read-only; affiliate cannot create / update / delete resources via the API)
- No per-IP allowlist on tokens (any IP with a valid token can call the API; abuse is detected via the last_used_ip and rate limiting; v2: per-token IP allowlist)
- No scoped-to-link tokens (a token is "read all my clicks" or "read all my commissions", not "read just link X")
- No per-token rate limit override (all tokens share the global 600 req/hour per affiliate; v2: per-token limits) — see OQ §3
- No webhooks (the page title says "API & webhooks" but webhooks are v2; v1 is API tokens only — same deferral as `/partner/settings/api`)
- No token rotation UI (an affiliate creates a new token and revokes the old one; no auto-rotate)
- No "last used" real-time updates (last_used_at is updated on the next API call, not in real-time on this page)
- No bulk token revoke
- No token name editing (revoke + create new)
- No IP-based token usage chart (the page shows last_used_ip as a one-line value, not a map)
- No token sharing (a token is single-tenant to the affiliate; no "share with my accountant" feature)
- No API key for the affiliate's referred customer (that's a different feature, customer-facing; not in v1)
- No public minishop API endpoints (the minishop at `/[handle]` is server-rendered HTML; programmatic access to its data is via the partner-style endpoints, not a separate surface)

## Acceptance criteria

- [ ] Page is auth-gated AND requires `profiles.role IN ('affiliate')`
- [ ] Customer-only / partner / admin access returns 404 (this is an affiliate-only surface)
- [ ] Suspended affiliates (`affiliates.status = 'suspended'`) can read the page (to see why they were suspended via a banner) but cannot create new tokens; the "Create token" button is disabled with a tooltip
- [ ] Token list shows: name, scope chips, last_used_at, last_used_ip (masked), created_at, expires_at, status, "Revoke" button
- [ ] The plaintext token is NEVER stored in the DB — only the HMAC hash
- [ ] The plaintext token is shown in the UI exactly once (in the one-time-show modal) and is not retained in any client state, query param, browser history, or log
- [ ] On create, the server returns the plaintext; subsequent GETs return only metadata
- [ ] HMAC hashing: `hmac_sha256(UTHENA_API_TOKEN_PEPPER, token)` where the pepper is a 32-byte secret in env. Same pepper as the partner-side tokens (single env var, single rotation event — see OQ §2)
- [ ] Token format: 32 random bytes, base64url-encoded, with a prefix `uth_aat_` (Affiliate Access Token); final length ~43 chars
- [ ] Token name is required (1-80 chars), at least one scope must be checked, expiration must be one of the four options
- [ ] Token scopes are enforced server-side: a token with `read_clicks` cannot hit the `read_commissions` endpoint; returns 403 with `error: 'insufficient_scope'`
- [ ] Rate limit on token creation: max 3 creates per affiliate per hour (defense against token-spam; lower than partner's 5/h because affiliates are higher-volume and lower-stakes)
- [ ] Rate limit on token listing: max 60 list-page loads per affiliate per hour
- [ ] Max 5 active (non-revoked, non-expired) tokens per affiliate; the 6th create attempt is rejected with a clear error
- [ ] Revoke requires typed confirmation ("type REVOKE to confirm") and sets `revoked_at`, `status='revoked'`
- [ ] Revoked tokens remain in the DB (for audit) but the API rejects them with 401
- [ ] Expired tokens are filtered to the "Expired" tab automatically; the API rejects them with 401 and `error: 'token_expired'`
- [ ] Every create writes an `admin_audit_log` row with `action='api_token_created'`, `target_id=token.id`, `affiliate_id=token.affiliate_id`, `after` carries the name + scopes + expiration (NOT the token hash, NOT the plaintext)
- [ ] Every revoke writes an `admin_audit_log` row with `action='api_token_revoked'`, `affiliate_id=token.affiliate_id`, `before`/`after` JSON
- [ ] Every API call (authenticated via token) writes an `api_token_usage` row with `token_id`, `endpoint`, `status_code`, `latency_ms`, `at` — for the affiliate's own visibility AND for abuse detection
- [ ] Last_used_at and last_used_ip are updated on the next API call (debounced to once per 5 minutes per token to avoid write storms)
- [ ] The page renders in < 300ms p95
- [ ] All inputs are keyboard-navigable, mobile responsive at 360px, 768px, 1280px
- [ ] No PII in URLs, no `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the affiliate portal build (deferred to PH14 implementation)
- Design tokens: `00-foundations/design/tokens.css`
- Theme: both
- Reference patterns: one-time-show modal pattern (same as GitHub's PAT creation, Stripe's API key creation, Vercel's token creation); the partner counterpart at `/partner/settings/api` is the structural twin — the spec was written first and the affiliate version is intentionally a clone with affiliate-specific scope names and a different prefix

## Security

- **Auth required:** YES
- **Allowed roles:** affiliate (self)
- **RBAC enforcement:** server actions check `affiliate_id = (select id from affiliates where user_id = auth.uid())` on every read and write. The token's `affiliate_id` is set at create time and never changes (no admin-override path in v1).
- **RLS policies that apply:**
  - `api_tokens` — `api_tokens_affiliate_read_own` (select, where `affiliate_id = self`); `api_tokens_affiliate_insert_own` (insert, where `affiliate_id = self` and `partner_id is null`); `api_tokens_affiliate_revoke_own` (update, where `affiliate_id = self` and `partner_id is null` and the UPDATE only changes `status`, `revoked_at`, `revoked_reason` — not `scopes`, `token_hash`, or `affiliate_id`); `api_tokens_admin_all` (admin sees all). The `partner_*` policies are kept (for partner tokens). The column-level GRANT on `token_hash` is unchanged. — see OQ §1 for the schema extension
  - `admin_audit_log` — admin read only; the server action uses `service_role` to insert
- **PII displayed:** no (the token is opaque; the page shows metadata, not the secret)
- **PII in URLs:** no
- **Token storage (CRITICAL):**
  - The plaintext token is generated, returned to the client ONCE, and then **discarded from server memory**
  - The DB stores only `hmac_sha256(UTHENA_API_TOKEN_PEPPER, token)` — never the plaintext
  - On every API request, the server hashes the incoming token with the pepper and looks up the row; the plaintext is never reconstructed
  - If the DB is compromised, the attacker gets hashes, not usable tokens; brute-forcing requires the env pepper
- **Token entropy:** 32 bytes from `crypto.randomBytes(32)`, base64url-encoded. ~256 bits of entropy. Unguessable.
- **Token transmission:** over HTTPS only; never in URLs (we use a header: `Authorization: Bearer uth_aat_...`); never in query params; never in logs
- **Token revocation propagation:** revoked tokens are rejected on the next request. The server does not need a cache invalidation — the lookup is the DB.
- **Per-token rate limit:** 600 API requests per token per hour (lower than the partner's 1000/h — affiliates are higher-volume but lower-stakes; the 1000/h figure would invite scraping). The limit is enforced by a counter in `api_tokens.usage_count_reset_at` and `api_tokens.usage_count` (rolling 1h window). The affiliate's tokens share the global affiliate-level rate limit (600/hour across all tokens) — i.e. the per-token and per-affiliate limits are the SAME cap. v2: per-token override.
- **Audit logged:** YES — every create, every revoke, every API call. The audit table is `admin_audit_log` (extended with `affiliate_id` — see OQ §1). The audit row for create includes the token id, name, scopes, expiration, affiliate_id — NOT the hash, NOT the plaintext.
- **CSRF:** all server actions are CSRF-protected
- **Last_used_ip storage:** stored as the raw IP. The page masks it (`192.0.2.***`); the API logs it raw for abuse review. v2: hash for privacy.
- **Third-party scripts:** none

## Performance

- **Target p95:** < 300ms (RSC; one row scan on `api_tokens` filtered by `affiliate_id`; cheap)
- **Render strategy:** RSC + SSR
- **Cache:** none — page is user-specific
- **DB indexes used:** `api_tokens (partner_id, status, created_at desc)` (existing — covers partner side); a new index `api_tokens (affiliate_id, status, created_at desc)` is required for the affiliate side (see OQ §1)
- **Bundle size budget:** < 30KB added to client bundle (token list + create modal + one-time-show modal + revoke modal). Reuses the same primitives as the partner version: the partner and affiliate pages can share 90%+ of the components, with the only divergence being the scope enum and the token prefix.

## Out of scope for v1

- Write-scoped tokens
- Per-token IP allowlist
- Per-link scoped tokens
- Per-token rate limit override
- Webhooks (the page title says "API & webhooks" but webhooks are v2)
- Token rotation UI
- Real-time last_used updates
- Bulk revoke
- Token name editing
- IP-based usage chart
- Token sharing
- Customer API keys (separate feature)
- Per-affiliate / per-link API quotas
- Long-lived refresh tokens (the API uses bearer tokens, not OAuth)

## Open questions for human

1. **`api_tokens` table — extend the existing one or create a parallel `affiliate_api_tokens`?** The data model currently has a single `api_tokens` table with `partner_id bigint not null references partners(id)`. The cleanest extension:
   - Make `partner_id` nullable; add `affiliate_id bigint null references affiliates(id)`.
   - Add a CHECK constraint: `(partner_id IS NOT NULL) <> (affiliate_id IS NOT NULL)` (exactly one is set).
   - Add new scopes to the `api_token_scope` enum: `read_clicks`, `read_commissions`, `read_links` (the existing `read_sales` / `read_payouts` / `read_products` stay for the partner side; `read_payouts` is shared).
   - Add a new index `api_tokens (affiliate_id, status, created_at desc)`.
   - Add new RLS policies `api_tokens_affiliate_read_own` / `api_tokens_affiliate_insert_own` / `api_tokens_affiliate_revoke_own` (mirroring the partner policies but filtering on `affiliate_id` and requiring `partner_id is null`).
   - Keep the `api_tokens_admin_all` policy as-is (admin sees all).
   - Add `affiliate_id` to `admin_audit_log` (nullable, FK to `affiliates.id`) so audit rows can be filtered by actor and target.

   The alternative is a parallel `affiliate_api_tokens` table with the same shape, but that doubles the schema and the RLS surface for no real win. The polymorphic `api_tokens` is the right call. Confirm the extension in `_data-model.md` (or push back if the data-model track wants a separate table — the trade-off is duplication vs. CHECK constraint).

2. **Token hashing — same pepper as partner tokens, or separate?** My recommendation: **single pepper, single env var (`UTHENA_API_TOKEN_PEPPER`)**, all tokens (partner + affiliate) share it. Reasons: one env var to rotate, one migration, one mental model. The trade-off: rotating the pepper is a breaking event for all tokens (we'd need a mass re-issue, or a re-hash-on-first-use flow). v1 has few enough tokens that mass re-issue is fine if we ever need to rotate. The downside is that a partner token leak and an affiliate token leak are not compartmentalized — but they share the same DB anyway, so the security boundary is already "anyone with the env can mint valid tokens." Confirm single pepper.

3. **Rate limit cap — 600/h is below the partner's 1000/h. Why?** Affiliates are higher-volume (more click events to query) but lower-stakes per call (clicks are aggregated; commissions are sparse). The lower cap encourages batching on the affiliate's side (cron every 10 minutes is more efficient than polling every 30 seconds) and gives us room to scale without re-tuning. Confirm the 600/h cap — alternative would be 1000/h (same as partner, simpler to reason about) or 300/h (very strict, may frustrate users).

4. **`read_payouts` — shared scope name for both partner and affiliate, or rename for affiliate?** The partner scope `read_payouts` and the affiliate scope `read_payouts` would return different shapes (partner: `payout_ledger` rows where `partner_id = self`; affiliate: `affiliate_payouts` rows where `affiliate_id = self`). The same enum value would resolve to different SQL at the API auth middleware level. My recommendation: keep the shared name. Reasons: the API endpoint paths disambiguate (`/api/v1/affiliate/payouts` vs `/api/v1/partner/payouts`), the scope name is the SAME capability (read MY payouts), and a polymorphic enum value is cheaper than a per-role enum. Alternative: rename to `read_partner_payouts` and `read_affiliate_payouts` for explicitness — at the cost of two enum values and slightly noisier UI. My recommendation: shared name. Confirm or push back.

5. **5 active tokens vs 10 for partner — same justification? My recommendation: 5 active for affiliates (lower than partner's 10). Reasons: most affiliates have ONE integration (Zapier or a dashboard) and a couple of dev keys; 5 is enough headroom. Lower cap = lower surface for a compromised-affiliate scenario. Alternative: 10 to match partner, simpler. Confirm 5.

6. **Per-affiliate per-hour rate cap on token creation — 3/h (vs 5/h for partner). Same reasoning:** affiliates are higher-volume users; the 3/h cap is enough for legitimate flows (create one, lose it, create another) without inviting token-spam. Alternative: 5/h to match partner. Confirm 3/h.

7. **Audit table — extend `admin_audit_log` with `affiliate_id`, or reuse the same pattern as the partner one?** The partner spec flagged this question (its OQ §"Audit table"). The affiliate version lands in the same boat. My recommendation: extend `admin_audit_log` with `affiliate_id uuid references affiliates(id)`, make `admin_id` nullable (it already is nullable per the existing data model — confirm), and have the `partner_id` and `affiliate_id` columns act as a polymorphic "actor" or "target" — only one is set per row. The audit row's `action` field disambiguates (`api_token_created` doesn't care whether the actor is partner or affiliate; the row's `affiliate_id` or `partner_id` does). Confirm the schema extension.

8. **API endpoint surface — same recommendation as the partner spec.** This spec defines the affiliate-facing management page. The actual API endpoints (`/api/v1/affiliate/clicks`, `/api/v1/affiliate/commissions`, `/api/v1/affiliate/links`, `/api/v1/affiliate/payouts`) need their own spec — ship this page first, then spec the endpoints in a follow-up. The page and the API share the same `api_tokens` table; the API can be built incrementally.

9. **Plaintext token one-time-show UX — same as partner:** modal with a "Copy" button. No `.txt` download in v1. Confirm or push back.

10. **`created_ip` and `last_used_ip` — same as partner:** raw IP for v1 (small, trusted cohort; needed for abuse review; the page masks the rendered IP). v2: hash if we get a privacy complaint. Confirm.

11. **What happens when an affiliate is suspended?** Per the acceptance criteria, a suspended affiliate can READ the page (to see the suspension banner) but cannot CREATE new tokens. Existing tokens are REVOKED on suspension (a server-side hook on `affiliates.status` update from `approved` to `suspended` revokes all the affiliate's active tokens and writes an audit row with `action='api_token_revoked_on_suspension'`, `reason='affiliate suspended'`). Confirm: should suspension auto-revoke, or just disable the create button and let the suspended user revoke manually? My recommendation: auto-revoke on suspension (one less thing for the suspended user to think about; the API is the wrong surface for a suspended affiliate to keep using).

---

## Implementation notes

- (filled by the building agent)
