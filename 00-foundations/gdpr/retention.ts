// Retention windows — the canonical source of truth for "how long do we
// keep each type of user data?" Used by:
//   - the data export surface (P2.6) — labels every section of the
//     user's export with its retention policy
//   - the background cleanup cron (PH19 — split out so a future job
//     can sweep rows older than `RETAIN_DAYS` for each table)
//   - the privacy policy / terms surface (PH10) — the rendered copy
//     on `/legal/privacy` mirrors these constants
//   - the audit-log retention policy (PH18 P3.3) — admin_audit_log
//     uses the same `RETENTION_AUDIT_LOG_MONTHS_HOT` constant
//
// Design notes:
//   - All values are exported as DAYS for consistency. Months are
//     converted at the call site if needed (we use 30-day months for
//     math; the legal definition of a month varies by jurisdiction).
//   - Retention windows longer than 7 years are unusual for non-
//     financial data; the 7-year ceiling below mirrors common US tax /
//     financial-services retention requirements. EU GDPR Art. 5(1)(e)
//     requires "no longer than necessary" — these windows are the
//     business case for why each piece of data must be kept that long.
//   - **Account deletion** is a separate, immediate event handled by
//     `delete_my_account` RPC (P1.4 migration 0010). The retention
//     windows here describe routine data hygiene for ACTIVE accounts;
//     deletion is a deliberate user-initiated action that overrides
//     these windows with an anonymization cascade.
//   - Keep this file dependency-free (no Supabase, no env). It's a
//     pure config module so the privacy-policy surface can import it
//     without dragging in `server-only` deps.

export type RetentionPolicy = {
  /** Human-readable label for the privacy policy + the export UI. */
  label: string
  /** How many days the data is kept. After this, a cleanup cron
   *  anonymizes or hard-deletes (the choice is per-entity). */
  days: number | null
  /** What the cleanup cron does at the end of the window. */
  action: 'anonymize' | 'hard_delete' | 'archive' | 'keep_indefinitely'
  /** Plain-English reason for the retention window (for the privacy
   *  policy + the admin audit-log entry that explains the sweep). */
  rationale: string
}

/**
 * Retention windows for every user-data table. The keys match the
 * Supabase table names. The shape is the same for every entity —
 * add a new entry here when you add a new user-data table.
 *
 * IMPORTANT: this object is exported as `as const` so consumers can
 * iterate the keys (e.g. to render a summary table in the privacy
 * policy) without losing the typed shape.
 */
export const RETENTION_POLICIES = {
  // --- Identity -----------------------------------------------------------
  profiles: {
    label: 'Profile',
    days: null, // kept while account is active; deleted on account deletion
    action: 'keep_indefinitely',
    rationale: 'Kept while your account is active. Hard-deleted (not anonymized) when you delete your account.',
  },
  auth_identities: {
    label: 'Login identities (passwords, OAuth)',
    days: null,
    action: 'keep_indefinitely',
    rationale: 'Kept while your account is active. Managed by Supabase Auth — purged on account deletion.',
  },

  // --- Commerce -----------------------------------------------------------
  orders: {
    label: 'Order history',
    days: 7 * 365,
    action: 'anonymize',
    rationale: '7-year retention for tax + financial reporting compliance. PII (your email) is replaced with an anonymized marker after the window.',
  },
  order_items: {
    label: 'Order line items',
    days: 7 * 365,
    action: 'anonymize',
    rationale: 'Lives with the order — inherits the 7-year retention. The product you bought stays in the order, but your identity is anonymized.',
  },
  refunds: {
    label: 'Refund records',
    days: 7 * 365,
    action: 'anonymize',
    rationale: '7-year retention mirrors tax + dispute-resolution windows. Refund notes that name you are anonymized after.',
  },

  // --- Subscriptions ------------------------------------------------------
  subscriptions: {
    label: 'Subscription history',
    days: 7 * 365,
    action: 'anonymize',
    rationale: 'Kept while the subscription is active + 7 years after cancellation for financial audit.',
  },

  // --- Library + engagement ----------------------------------------------
  library_grants: {
    label: 'Course access grants',
    days: null,
    action: 'keep_indefinitely',
    rationale: 'Kept while your account is active so you can re-download. Hard-deleted with your profile.',
  },
  file_downloads: {
    label: 'Download / stream audit log',
    days: 90,
    action: 'anonymize',
    rationale: '90-day operational retention for fraud + abuse detection. IP addresses are hashed, never raw.',
  },
  reviews: {
    label: 'Product reviews',
    days: null,
    action: 'keep_indefinitely',
    rationale: 'Kept while your account is active. Hard-deleted when you delete your account (the review content is yours).',
  },

  // --- Compliance + consent ----------------------------------------------
  consent_log: {
    label: 'Cookie consent log',
    days: 730, // 24 months
    action: 'anonymize',
    rationale: '24-month retention per ePrivacy guidance — enough to defend a complaint in case of regulator inquiry.',
  },
  api_tokens: {
    label: 'API access tokens',
    days: null,
    action: 'keep_indefinitely',
    rationale: 'Kept while your account is active. Revocation is instant; hard-deleted with your profile.',
  },
  admin_audit_log: {
    label: 'Admin audit log (when you are the actor)',
    days: 730,
    action: 'anonymize',
    rationale: '24-month retention for security investigations. PII fields anonymized; event shape preserved.',
  },

  // --- Partner / affiliate surfaces --------------------------------------
  partners: {
    label: 'Partner profile',
    days: null,
    action: 'keep_indefinitely',
    rationale: 'Kept while you are a partner. The partner record (and its product linkage) is preserved; PII fields (bio, website, payout method) are anonymized on account deletion.',
  },
  affiliates: {
    label: 'Affiliate profile',
    days: null,
    action: 'keep_indefinitely',
    rationale: 'Kept while you are an affiliate. The handle + payout history are preserved; PII fields (bio, payout method) are anonymized on account deletion.',
  },
  partner_uploads: {
    label: 'Partner upload records',
    days: null,
    action: 'keep_indefinitely',
    rationale: 'Tied to the partner record. Encoding + scan metadata survive account deletion; the partner identity is anonymized.',
  },
  partner_onboarding_drafts: {
    label: 'Partner onboarding draft',
    days: null,
    action: 'hard_delete',
    rationale: 'Wiped when you delete your account — drafts are pre-submission work and have no compliance value.',
  },

  // --- Risk + reports -----------------------------------------------------
  risk_signals: {
    label: 'Fraud / abuse signals',
    days: 7 * 365,
    action: 'anonymize',
    rationale: '7-year retention for fraud-pattern detection. Your identity is replaced with the same anonymized marker used elsewhere.',
  },
  reports: {
    label: 'Content reports you filed',
    days: 7 * 365,
    action: 'anonymize',
    rationale: '7-year retention for legal-defense value. Reporter identity is anonymized after.',
  },

  // --- Soft-state ---------------------------------------------------------
  notification_preferences: {
    label: 'Notification preferences',
    days: null,
    action: 'keep_indefinitely',
    rationale: 'Kept while your account is active. Hard-deleted with your profile.',
  },
  cart_items: {
    label: 'Cart items',
    days: 30,
    action: 'hard_delete',
    rationale: '30-day idle expiry — abandoned carts are deleted automatically. See cart-expiration cron.',
  },
} as const satisfies Record<string, RetentionPolicy>

/** Convenience: list the policies as an array (for the privacy policy UI). */
export const RETENTION_POLICIES_LIST: readonly RetentionPolicy[] =
  Object.values(RETENTION_POLICIES)

/** Convenience: look up the policy for a given table name. */
export function getRetentionPolicy(
  table: keyof typeof RETENTION_POLICIES,
): RetentionPolicy {
  return RETENTION_POLICIES[table]
}

/** Returns the human-readable retention for a section in the export UI. */
export function describeRetention(
  table: keyof typeof RETENTION_POLICIES,
): string {
  const p = RETENTION_POLICIES[table]
  if (p.action === 'keep_indefinitely') {
    return `${p.label}: kept while your account is active.`
  }
  if (p.days === null) return `${p.label}: ${p.rationale}`
  const years = Math.round((p.days / 365) * 10) / 10
  const dayLabel = years >= 1 ? `~${years} years` : `${p.days} days`
  return `${p.label}: ${dayLabel} (${p.rationale.split('.')[0]}).`
}