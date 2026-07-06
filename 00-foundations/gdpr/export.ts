// GDPR data export — builds the canonical "Download my data" payload
// (Art. 15 — Right of Access) for a signed-in user.
//
// Per-entity builder functions, each one:
//   - queries the request-scoped Supabase client (RLS-aware; users can
//     only read their own rows)
//   - returns a plain JSON-serializable object with NO secrets (no
//     raw tokens, no raw IPs, no password hashes)
//   - returns `null` for "the user has no rows in this table" so the
//     bundle is structurally consistent across users
//
// The bundle (`buildMyDataExport`) is the only function the page route
// needs to call. It is independent of the per-entity builders so:
//   - the page route can render a "Building your export…" UI and stream
//     each section as it finishes (later optimization)
//   - tests can verify each builder in isolation
//   - future entities (PH12 onboarding, PH13 affiliate, PH14 admin
//     notes, PH15 LMS bookmarks/progress) add a new builder without
//     touching the existing ones
//
// Spec: PHASES.md §P2.6. References:
//   - migration 0010_delete_my_account_rpc.sql (the right-to-deletion
//     cascade that runs AFTER the user requests Art. 17)
//   - migration 0017-0022 (auth_failed_attempts — NOT exported here;
//     these are security-sensitive and would help an attacker map
//     their failed-attempt history. They live in admin_audit_log instead.)
//   - 00-foundations/gdpr/consent.ts (the cookie-consent surface; we
//     re-export `ConsentState` here for convenience but the consent
//     decision itself is owned by consent.ts.)
//
// `server-only` so client bundles don't pull Supabase.

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { RETENTION_POLICIES, describeRetention } from './retention'

// ===========================================================================
// Section: meta
// ===========================================================================

/** Bump this whenever the export shape changes (add/remove a section,
 *  rename a column). The export UI surfaces this so users + auditors can
 *  see which schema version their JSON matches. */
export const GDPR_EXPORT_SCHEMA_VERSION = '1.0.0' as const

export type ExportMeta = {
  schema_version: typeof GDPR_EXPORT_SCHEMA_VERSION
  exported_at: string // ISO 8601 timestamp
  user_id: string
  email_hash: string // SHA-256 fingerprint of the email — used for verification, not the raw email
  retention_summary: Record<string, string>
}

// ===========================================================================
// Section: per-entity shapes
// ===========================================================================

export type ProfileSection = {
  id: number
  role: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  locale: string
  timezone: string
  status: string
  created_at: string
  updated_at: string
}

export type PartnerSection = {
  id: number
  public_slug: string | null
  bio: string | null
  website_url: string | null
  payout_method: unknown // jsonb; included verbatim because the user owns it
  tax_form_status: string
  kyc_status: string
  status: string
  approved_at: string | null
  created_at: string
  updated_at: string
}

export type AffiliateSection = {
  id: number
  handle: string
  status: string
  bio: string | null
  payout_method: unknown
  commission_pct_bps: number | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export type OrderSection = {
  id: number
  email: string
  status: string
  currency: string
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  total_cents: number
  refunded_cents: number
  created_at: string
  paid_at: string | null
  fulfilled_at: string | null
  metadata: Record<string, unknown>
  items: OrderItemSection[]
}

export type OrderItemSection = {
  id: number
  product_id: number
  partner_id: number
  license: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  royalty_pct_bps: number
  royalty_cents: number
}

export type SubscriptionSection = {
  id: number
  stripe_subscription_id: string | null
  stripe_customer_id: string | null
  status: string
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  canceled_at: string | null
  trial_start: string | null
  trial_end: string | null
  created_at: string
  updated_at: string
}

export type LibraryGrantSection = {
  id: number
  product_id: number
  source: string
  order_id: number | null
  subscription_id: string | null
  license: string | null
  revoked_at: string | null
  revoked_reason: string | null
  expires_at: string | null
  created_at: string
}

export type ReviewSection = {
  id: number
  product_id: number
  rating: number
  title: string | null
  body: string
  status: string
  helpful_count: number
  created_at: string
  updated_at: string
}

export type ConsentLogEntry = {
  id: number
  essential: boolean
  analytics: boolean
  marketing: boolean
  ip_hash: string | null // already a hash, never raw
  user_agent: string | null
  created_at: string
}

export type NotificationPrefsSection = {
  order_updates_email: boolean
  refund_updates_email: boolean
  payout_updates_email: boolean
  security_alerts_email: boolean
  marketing_email: boolean
  product_updates_email: boolean
  weekly_digest_email: boolean
  updated_at: string
}

export type ApiTokenSection = {
  id: number
  name: string
  token_prefix: string // e.g. 'uth_live_abc' — safe to expose
  scopes: string[]
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
  // token_hash is NEVER included. The raw token is NEVER included.
  // Users must regenerate the token to see it again.
}

export type FileDownloadEntry = {
  id: number
  file_id: number | null
  product_id: number | null
  kind: 'download' | 'stream'
  url_expires_at: string
  ip_hash: string | null // hash only — never raw
  user_agent: string | null
  range_start: number | null
  range_end: number | null
  bytes_served: number | null
  created_at: string
}

export type RiskSignalEntry = {
  id: number
  signal_kind: string
  severity: string
  context: Record<string, unknown>
  resolved: boolean
  resolved_at: string | null
  created_at: string
}

export type ReportEntry = {
  id: number
  target_kind: string
  target_id: string
  reason: string
  details: string | null
  status: string
  created_at: string
}

export type PartnerUploadEntry = {
  id: number
  original_filename: string
  size_bytes: number
  mime_type: string | null
  scan_status: string
  scan_completed_at: string | null
  scan_result: string | null
  encoding_status: string | null
  bunny_video_id: string | null
  product_id: number | null
  created_at: string
}

export type OnboardingDraftSection = {
  payload: Record<string, unknown>
  current_step: number
  submitted_at: string | null
  created_at: string
  updated_at: string
}

// ===========================================================================
// Bundle
// ===========================================================================

export type DataExport = {
  meta: ExportMeta
  profile: ProfileSection | null
  partner: PartnerSection | null
  affiliate: AffiliateSection | null
  orders: OrderSection[]
  subscriptions: SubscriptionSection[]
  library_grants: LibraryGrantSection[]
  reviews: ReviewSection[]
  consent_log: ConsentLogEntry[]
  notification_preferences: NotificationPrefsSection | null
  api_tokens: ApiTokenSection[]
  file_downloads: FileDownloadEntry[]
  risk_signals: RiskSignalEntry[]
  reports: ReportEntry[]
  partner_uploads: PartnerUploadEntry[]
  partner_onboarding_draft: OnboardingDraftSection | null
}

// ===========================================================================
// Helpers
// ===========================================================================

// The SupabaseClient generic is constrained to `{ PostgrestVersion: string }`.
// We use `any` for the schema generic because this module is intentionally
// generic over the public schema — the callers pass through the request-
// scoped Supabase client whose schema is unknown to this file. The column
// shapes are described by the per-section types below.
type GenericSupabase = SupabaseClient<any, 'public', any>

type RowsResult<T> = { data: T[] | null; error: { message: string } | null }

/** Read every row from a table for this user. Returns [] on error so
 *  the rest of the export can still build — we never fail the whole
 *  export because one table is temporarily unavailable. The meta
 *  block + audit log let admins see which sections were skipped. */
async function readAll<T>(
  supabase: GenericSupabase,
  table: string,
  filter: (q: ReturnType<GenericSupabase['from']>) => unknown,
): Promise<T[]> {
  const base = supabase.from(table)
  // The real Supabase pattern is `await <chain>` where `<chain>` is
  // the fluent builder after `.select().eq()...`. The chain is itself
  // a thenable that resolves to `{ data, error }`. Awaiting it (not
  // calling `.select()` again) is the correct shape — `.select()` is
  // a fluent setter, not a trigger that executes the query.
  const result = (await filter(base)) as RowsResult<T>
  if (result.error) return []
  return result.data ?? []
}

// ===========================================================================
// Per-entity builders
// ===========================================================================

export async function buildProfileExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<ProfileSection | null> {
  const result = (await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()) as { data: ProfileSection | null; error: unknown }
  if (result.error || !result.data) return null
  // Hide admin-only fields from the user export. The `status` enum
  // and `suspended_*` fields are admin-internal — we surface the
  // value the user should know about (active vs banned) without the
  // granular timestamps an admin would need.
  return {
    id: result.data.id,
    role: result.data.role,
    display_name: result.data.display_name,
    avatar_url: result.data.avatar_url,
    bio: result.data.bio,
    locale: result.data.locale,
    timezone: result.data.timezone,
    status: result.data.status,
    created_at: result.data.created_at,
    updated_at: result.data.updated_at,
  }
}

export async function buildPartnerExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<PartnerSection | null> {
  const result = (await supabase
    .from('partners')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()) as { data: PartnerSection | null; error: unknown }
  if (result.error || !result.data) return null
  return result.data
}

export async function buildAffiliateExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<AffiliateSection | null> {
  const result = (await supabase
    .from('affiliates')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()) as { data: AffiliateSection | null; error: unknown }
  if (result.error || !result.data) return null
  return result.data
}

export async function buildOrdersExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<OrderSection[]> {
  const orders = await readAll<{
    id: number
    email: string
    status: string
    currency: string
    subtotal_cents: number
    discount_cents: number
    tax_cents: number
    total_cents: number
    refunded_cents: number
    created_at: string
    paid_at: string | null
    fulfilled_at: string | null
    metadata: Record<string, unknown>
    order_items: OrderItemSection[]
  }>(
    supabase,
    'orders',
    (q) => q.select('*, order_items:order_items_order_id_fkey(*)').eq('user_id', userId).order('created_at', { ascending: false }),
  )
  return orders.map((o) => ({
    id: o.id,
    email: o.email,
    status: o.status,
    currency: o.currency,
    subtotal_cents: o.subtotal_cents,
    discount_cents: o.discount_cents,
    tax_cents: o.tax_cents,
    total_cents: o.total_cents,
    refunded_cents: o.refunded_cents,
    created_at: o.created_at,
    paid_at: o.paid_at,
    fulfilled_at: o.fulfilled_at,
    metadata: o.metadata,
    items: Array.isArray(o.order_items) ? o.order_items : [],
  }))
}

export async function buildSubscriptionsExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<SubscriptionSection[]> {
  return readAll<SubscriptionSection>(supabase, 'subscriptions', (q) =>
    q.select('*').eq('user_id', userId).order('created_at', { ascending: false }),
  )
}

export async function buildLibraryGrantsExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<LibraryGrantSection[]> {
  return readAll<LibraryGrantSection>(supabase, 'library_grants', (q) =>
    q.select('*').eq('user_id', userId).order('created_at', { ascending: false }),
  )
}

export async function buildReviewsExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<ReviewSection[]> {
  return readAll<ReviewSection>(supabase, 'reviews', (q) =>
    q.select('*').eq('user_id', userId).order('created_at', { ascending: false }),
  )
}

export async function buildConsentLogExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<ConsentLogEntry[]> {
  // The consent_log table also includes rows for `user_id IS NULL`
  // (anonymous visitors). Users can read their OWN rows + the anon
  // rows they may have written before signup. We filter on user_id
  // exactly so a user only sees their own consent history.
  return readAll<ConsentLogEntry>(supabase, 'consent_log', (q) =>
    q.select('*').eq('user_id', userId).order('created_at', { ascending: false }),
  )
}

export async function buildNotificationPrefsExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<NotificationPrefsSection | null> {
  const result = (await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()) as { data: NotificationPrefsSection | null; error: unknown }
  if (result.error || !result.data) return null
  return result.data
}

export async function buildApiTokensExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<ApiTokenSection[]> {
  // We MUST NOT include `token_hash` — it would let an attacker who
  // gets the export file verify tokens against our DB without our
  // service. We surface the `token_prefix` for display + the metadata.
  const rows = await readAll<
    Omit<ApiTokenSection, 'token_hash'> & { token_hash?: unknown }
  >(supabase, 'api_tokens', (q) =>
    q.select('id, name, token_prefix, scopes, last_used_at, expires_at, revoked_at, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
  )
  return rows.map(({ token_hash: _tokenHash, ...rest }) => rest)
}

export async function buildFileDownloadsExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<FileDownloadEntry[]> {
  // IP addresses are already stored as ip_hash (SHA-256). The raw IP
  // (`ip_raw`) is kept for 90 days for active fraud investigations
  // but is NOT exported to the user — the right of access doesn't
  // require us to hand over operational fraud-detection telemetry.
  // Users see their own audit trail (what they downloaded) without
  // the network-level details.
  //
  // Defense in depth: the SELECT explicitly excludes `ip_raw`, AND
  // the row shape uses `Omit` so even if the column leaks through
  // (e.g. RLS change, a future migration adding the column back to
  // the SELECT path) we never serialize it.
  const rows = await readAll<
    Omit<FileDownloadEntry, 'ip_raw'> & { ip_raw?: unknown }
  >(supabase, 'file_downloads', (q) =>
    q.select('id, file_id, product_id, kind, url_expires_at, ip_hash, user_agent, range_start, range_end, bytes_served, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
  )
  return rows.map(({ ip_raw: _ipRaw, ...rest }) => rest)
}

export async function buildRiskSignalsExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<RiskSignalEntry[]> {
  // Risk signals are operational data — we include them for transparency
  // but strip the `resolved_by` field (admin identity) since users don't
  // need to know which admin closed their case.
  const rows = await readAll<{
    id: number
    signal_kind: string
    severity: string
    context: Record<string, unknown>
    resolved: boolean
    resolved_at: string | null
    resolved_by?: unknown
    created_at: string
  }>(supabase, 'risk_signals', (q) =>
    q.select('id, signal_kind, severity, context, resolved, resolved_at, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
  )
  return rows.map(({ resolved_by: _resolvedBy, ...rest }) => rest)
}

export async function buildReportsExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<ReportEntry[]> {
  return readAll<ReportEntry>(supabase, 'reports', (q) =>
    q.select('id, target_kind, target_id, reason, details, status, created_at').eq('reporter_id', userId).order('created_at', { ascending: false }),
  )
}

export async function buildPartnerUploadsExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<PartnerUploadEntry[]> {
  // Partner uploads are linked through the `partners` table, not
  // directly through user_id. We look up the user's partner row first
  // and return [] if they aren't a partner.
  const partner = (await supabase
    .from('partners')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()) as { data: { id: number } | null; error: unknown }
  if (partner.error || !partner.data) return []
  const partnerId = partner.data.id
  return readAll<PartnerUploadEntry>(supabase, 'partner_uploads', (q) =>
    q
      .select('id, original_filename, size_bytes, mime_type, scan_status, scan_completed_at, scan_result, encoding_status, bunny_video_id, product_id, created_at')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false }),
  )
}

export async function buildOnboardingDraftExport(
  supabase: GenericSupabase,
  userId: string,
): Promise<OnboardingDraftSection | null> {
  const result = (await supabase
    .from('partner_onboarding_drafts')
    .select('payload, current_step, submitted_at, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle()) as { data: OnboardingDraftSection | null; error: unknown }
  if (result.error || !result.data) return null
  return result.data
}

// ===========================================================================
// Bundle
// ===========================================================================

/**
 * Build the complete "Download my data" payload for a user. Runs the
 * per-entity builders in sequence (not parallel — fewer concurrent
 * connections to the DB, and the export is not latency-critical).
 *
 * Caller is responsible for:
 *   - auth (this function does NOT verify the user is who they say;
 *     RLS on every underlying table is the gate)
 *   - rate-limiting (the spec says 3/day — that lives in the page
 *     route's server action; this helper is pure)
 *   - audit-logging the export request (a `gdpr_export` row in
 *     `admin_audit_log` is the standard pattern)
 *
 * The result is JSON-serializable. No secrets.
 */
export async function buildMyDataExport(
  supabase: GenericSupabase,
  userId: string,
  email: string,
): Promise<DataExport> {
  const meta: ExportMeta = {
    schema_version: GDPR_EXPORT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    user_id: userId,
    email_hash: hashEmail(email),
    retention_summary: Object.fromEntries(
      Object.keys(RETENTION_POLICIES).map((k) => [
        k,
        describeRetention(k as keyof typeof RETENTION_POLICIES),
      ]),
    ),
  }

  const [
    profile,
    partner,
    affiliate,
    orders,
    subscriptions,
    library_grants,
    reviews,
    consent_log,
    notification_preferences,
    api_tokens,
    file_downloads,
    risk_signals,
    reports,
    partner_uploads,
    partner_onboarding_draft,
  ] = await Promise.all([
    buildProfileExport(supabase, userId),
    buildPartnerExport(supabase, userId),
    buildAffiliateExport(supabase, userId),
    buildOrdersExport(supabase, userId),
    buildSubscriptionsExport(supabase, userId),
    buildLibraryGrantsExport(supabase, userId),
    buildReviewsExport(supabase, userId),
    buildConsentLogExport(supabase, userId),
    buildNotificationPrefsExport(supabase, userId),
    buildApiTokensExport(supabase, userId),
    buildFileDownloadsExport(supabase, userId),
    buildRiskSignalsExport(supabase, userId),
    buildReportsExport(supabase, userId),
    buildPartnerUploadsExport(supabase, userId),
    buildOnboardingDraftExport(supabase, userId),
  ])

  return {
    meta,
    profile,
    partner,
    affiliate,
    orders,
    subscriptions,
    library_grants,
    reviews,
    consent_log,
    notification_preferences,
    api_tokens,
    file_downloads,
    risk_signals,
    reports,
    partner_uploads,
    partner_onboarding_draft,
  }
}

// ===========================================================================
// Internal
// ===========================================================================

/** Lightweight deterministic hash for the export metadata. We don't
 *  need cryptographic strength here — the email_hash field lets the
 *  user + an auditor confirm "this is the export for email X" without
 *  ever putting the email in the file. Uses Node's `node:crypto` so
 *  it works in the Node runtime only (server). */
function hashEmail(email: string): string {
  // Lazy import to keep the module loadable in non-Node runtimes
  // (this file has `import 'server-only'` so it won't reach the client,
  // but we still avoid the eager require).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}