# 00-foundations/gdpr/

GDPR compliance helpers — the canonical source of truth for everything that touches personal data on Uthena. Two flows live here:

- **Right of access (Art. 15)** — the "Download my data" JSON export built by `export.ts`
- **Right to deletion (Art. 17)** — wired into the `delete_my_account` Postgres RPC at `04-platform/migrations/0010_delete_my_account_rpc.sql`; the application-side action lives at `02-features/account/profile/actions/deleteMyAccount.ts`

Plus a retention-window reference table consumed by the privacy policy, the future cleanup cron, and the export bundle's metadata.

## Files

| File | Purpose |
|---|---|
| **`consent.ts`** | Cookie-consent decisions. `recordConsent(userId, state, ip, ua)` writes one row per consent change to `consent_log`. `ConsentState` (essential + analytics + marketing). The IP is hashed before storage. |
| **`export.ts`** | Right-of-access builders. One per-entity builder (`buildProfileExport`, `buildOrdersExport`, …) plus `buildMyDataExport(supabase, userId, email)` that bundles everything. Strict PII scrubbing: no `token_hash`, no raw IP, no admin-internal suspension/ban reasons, no `resolved_by` admin identity. |
| **`export.test.ts`** | 30+ unit tests covering every per-entity builder + the bundle. Critically asserts the JSON never contains `token_hash`, `ip_raw`, `password`, `banned_by`, etc. |
| **`retention.ts`** | `RETENTION_POLICIES` — a typed `as const` map of every user-data table → its retention window + cleanup action + rationale. `describeRetention(table)` returns a human-readable summary for the privacy policy. |
| **`retention.test.ts`** | Coverage + shape tests for `RETENTION_POLICIES`. Verifies the 7-year / 24-month / 90-day / 30-day constants and that `days` is null OR a positive integer. |
| **`delete-cascade.ts`** | Right-to-deletion (Art. 17) wrapper. `deleteMyAccountCascade(userId)` invokes the `delete_my_account` Postgres RPC via the service-role client + maps the 4 possible RPC outcomes to a typed `DeleteMyAccountOutcome` union. Logs PII-safely (never logs the user_id). The page-route server action composes this with email verification + audit-log + sign-out. |
| **`delete-cascade.test.ts`** | Unit tests for the cascade wrapper — every RPC outcome maps to the right typed result, RPC errors → `unknown`, PII safety asserted across every log-emitting path. |
| **`README.md`** | This file. |

> Files the spec mentions but are NOT yet built (parked in `docs/PROGRESS.md` / `PHASES.md`):
>
> - **`anonymize-helpers.ts`** — the per-table anonymization functions. Today those live inside the `delete_my_account` SQL function (which is the right place — Postgres transactions are atomic, the app code can't be). If we add a "soft-delete for compliance review" later, this file will be the entry point.

## How a builder is structured

Every builder has the same shape:

```ts
export async function buildXExport(
  supabase: SupabaseClient,
  userId: string,
): Promise<XSection | null> {
  const { data, error } = await supabase
    .from('x')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  // ... shape into the export-only subset (strip secrets, admin fields, etc.)
  return shaped
}
```

Three rules every builder follows:

1. **Returns `null` on "no row" and `[]` on "no rows".** The bundle is structurally consistent across users (an empty export has the same shape as a populated one — just with nulls/empties).
2. **Strips admin-internal fields.** The profile export hides `suspended_reason`, `banned_reason`, `banned_by`, `warnings_count` — these are admin-only. The risk-signal export hides `resolved_by`. The API-token export hides `token_hash`.
3. **Never surfaces raw PII.** IPs are already hashed at storage time (`file_downloads.ip_hash`); the export reads only the hash. We never log the email — the export metadata includes `email_hash` (SHA-256) for verification, never the email itself.

## How `buildMyDataExport` is wired

The page route at `/account/settings` (P9.9) renders the "Download my data" button. Clicking it triggers:

```
[client]  click → POST /api/account/export
            (auth required, rate-limited 3/day per user)
[server]  /api/account/export
            → requireUser()
            → audit-log row: 'gdpr.export_requested'
            → buildMyDataExport(supabase, userId, user.email)
            → JSON response + Content-Disposition: attachment
            → audit-log row: 'gdpr.export_completed'
```

The route, the rate limit, and the audit-log row are PH9 territory (P9.16 — Data export). The bundle + per-entity builders are Phase 2 P2.6 — that's this slice.

## Retention policy table

The `RETENTION_POLICIES` map mirrors every user-data table. Highlights:

| Table | Retention | Action |
|---|---|---|
| `orders`, `order_items`, `refunds`, `subscriptions`, `risk_signals`, `reports` | 7 years | anonymize |
| `consent_log`, `admin_audit_log` | 24 months | anonymize |
| `file_downloads` | 90 days | anonymize |
| `cart_items` | 30 days | hard_delete |
| `profiles`, `partners`, `affiliates`, `library_grants`, `reviews`, `api_tokens`, `notification_preferences`, `partner_uploads` | indefinite | keep + delete on account deletion |

Each policy's `rationale` is the one-line justification that will appear on the privacy policy page and in the audit log entry that the cleanup cron writes before sweeping.

## Spec

- [`PHASES.md` §P2.6](../../PHASES.md) — acceptance criteria
- [`04-platform/migrations/0010_delete_my_account_rpc.sql`](../../04-platform/migrations/0010_delete_my_account_rpc.sql) — the Art. 17 cascade
- [`docs/RETIREMENT.md`](../../docs/RETIREMENT.md) — what's been replaced (no relevant items yet)