'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { encryptString } from '@foundations/security/encryption'
import { writeSelfAuditLog } from '@features/account/profile/actions/writeSelfAuditLog'
import { maskEmail } from '../format'

const log = loggerFor({ component: 'partner.settings' })

// P12.17 — per-platform social-handle validators. Each is a separate
// Zod schema so the field-level error message can name the platform.
// Patterns:
//   - twitter: 1-15 alnum + underscore (no leading @ in storage; the
//     UI strips it on save)
//   - linkedin: 3-100 chars, alnum + hyphen + underscore + period
//     (matches LinkedIn's slug convention roughly)
//   - youtube: @handle / @channel / full URL — accepted as-is so the
//     UI can keep whatever the user typed; Zod just bounds the length
//   - github: 1-39 alnum + hyphen (matches GitHub's username rules)
//   - website: SafeUrl (http/https only; rejects javascript:/data:/
//     vbscript:/file: at parse time — see AGENTS.md "No PII or XSS")
//
// Each schema is permissive on empty strings (treats `""` as
// "not set" → null in storage). The UI controls which fields are
// shown; the action accepts them all because the form sends the full
// shape on every save.
const TwitterHandle = z
  .string()
  .max(50, 'Max 50 characters')
  .regex(/^@?[A-Za-z0-9_]{1,15}$/, 'Use 1-15 letters, digits, or underscore (with optional @)')
  .or(z.literal(''))
  .optional()

const LinkedInSlug = z
  .string()
  .max(100, 'Max 100 characters')
  .regex(/^[A-Za-z0-9._-]{3,100}$/, 'Use letters, digits, dot, hyphen, or underscore')
  .or(z.literal(''))
  .optional()

const YouTubeHandle = z
  .string()
  .max(200, 'Max 200 characters')
  .or(z.literal(''))
  .optional()

const GitHubHandle = z
  .string()
  .max(50, 'Max 50 characters')
  .regex(/^[A-Za-z0-9-]{1,39}$/, 'Use 1-39 letters, digits, or hyphen')
  .or(z.literal(''))
  .optional()

// SafeUrl regex — http(s) only; rejects javascript:, data:, vbscript:,
// file:. Mirrors the SafeUrl pattern used elsewhere in the project.
const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i
const WebsiteUrl = z
  .string()
  .max(500, 'Max 500 characters')
  .regex(SAFE_URL, 'Enter a URL starting with https://')
  .or(z.literal(''))
  .optional()

const PartnerSettingsSchema = z.object({
  bio: z.string().max(500, 'Max 500 characters').optional().default(''),
  website_url: z
    .string()
    .url('Enter a valid URL (https://…)')
    .or(z.literal(''))
    .optional()
    .default(''),
  tax_country: z
    .string()
    .min(2)
    .max(2, 'Use a 2-letter country code')
    .optional()
    .default('US'),
  tax_id: z.string().max(64).optional().default(''),
  paypal_email: z.string().email('Enter a valid email').or(z.literal('')).optional().default(''),
  // P12.17 — social links (flat object). Each field is its own Zod
  // schema so the field-level error message names the platform.
  // `.strict()` rejects unknown keys (defense in depth — a stale
  // client sending extra fields is rejected at the parse boundary).
  social_links: z
    .object({
      twitter: TwitterHandle,
      linkedin: LinkedInSlug,
      youtube: YouTubeHandle,
      github: GitHubHandle,
      website: WebsiteUrl,
    })
    .strict()
    .optional()
    .default({}),
  // P12.17 — opt-in public profile toggle. Always sent from the form
  // (true or false) so the action can distinguish "user toggled OFF"
  // from "user didn't visit the field".
  is_public: z.boolean().optional().default(false),
})

export type PartnerSettingsResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

/**
 * Field set we audit-log. The plaintext PayPal email and tax ID
 * NEVER appear in the audit row — only the masked form (or the
 * field name when the value was empty / unchanged). Per
 * `01-specs/pages/partner-settings.md` §"Security" §"Audit logged":
 *   "The PayPal email and tax id are NEVER in the audit row
 *    payload — only the fact that they changed."
 *
 * P12.17 — added `social_links` and `is_public` to the audited set.
 * `social_links` is a flat object — the audit row stores the full
 * before/after JSON (handles are public-facing, no PII risk).
 * `is_public` is a boolean — the before/after stored as plain
 * strings ("true"/"false").
 */
const AUDITED_FIELDS = [
  'bio',
  'website_url',
  'tax_country',
  'tax_id',
  'paypal_email',
  'social_links',
  'is_public',
] as const
type AuditedField = (typeof AUDITED_FIELDS)[number]

type FieldDiff = {
  before: { masked: string | null } | { value: unknown } | null
  after: { masked: string | null } | { value: unknown } | null
}

/**
 * Build the audit-row diff for a single field. PII-aware: the PayPal
 * email and tax_id are masked; the others (bio, website_url, country)
 * are stored verbatim (the bio and website_url are public-facing
 * per the partner-settings spec, and country is a 2-letter code).
 *
 * P12.17 — `social_links` is a flat object (handles are public,
 * stored as JSON in the diff); `is_public` is a boolean (stored
 * as `{ value: 'true' | 'false' }` for readability).
 */
function diffForField(
  field: AuditedField,
  beforeValue: unknown,
  afterValue: unknown,
): FieldDiff | null {
  // For social_links + is_public, deep-equality via JSON.stringify
  // is sufficient — both are JSON-serializable with stable shape.
  if (field === 'social_links' || field === 'is_public') {
    const beforeJson = JSON.stringify(beforeValue ?? null)
    const afterJson = JSON.stringify(afterValue ?? null)
    if (beforeJson === afterJson) return null
    return {
      before: { value: beforeValue ?? null },
      after: { value: afterValue ?? null },
    }
  }

  const beforeStr = typeof beforeValue === 'string' ? beforeValue : beforeValue == null ? '' : String(beforeValue)
  const afterStr = typeof afterValue === 'string' ? afterValue : afterValue == null ? '' : String(afterValue)
  if (beforeStr === afterStr) return null

  // PII fields — mask for the audit row.
  if (field === 'paypal_email') {
    return {
      before: { masked: beforeStr ? maskEmail(beforeStr) : null },
      after: { masked: afterStr ? maskEmail(afterStr) : null },
    }
  }
  if (field === 'tax_id') {
    // The tax_id mask format is `***-**-{last4}` for digits-only
    // IDs. Reuse the same shape. If the value isn't a clean EIN/SSN,
    // we still emit the raw value here because masking a free-form
    // tax ID could be misleading — but the audit row already
    // stores the field name so an admin can investigate.
    return {
      before: { masked: beforeStr ? `***-**-${beforeStr.replace(/\D/g, '').slice(-4) || '****'}` : null },
      after: { masked: afterStr ? `***-**-${afterStr.replace(/\D/g, '').slice(-4) || '****'}` : null },
    }
  }

  // Non-PII fields — store the value. Country is a 2-letter code
  // (no PII risk); bio + website_url are public-facing by spec.
  return {
    before: { masked: beforeStr || null },
    after: { masked: afterStr || null },
  }
}

/**
 * Update the current user's partner row. Server-only. The
 * user_id is always derived from the session — never trusted
 * from the client. RLS is the second line of defense.
 *
 * Encryption (P6.5 Slice 1): the `paypal_email` value is
 * encrypted via `encryptString` (AES-256-GCM, application-layer
 * envelope `<iv>.<tag>.<ct>`) BEFORE writing to the
 * `partners.payout_method` JSONB column. The DB never sees
 * plaintext. The legacy plaintext `paypal_email` field is
 * abandoned — new writes go under `paypal_email_encrypted`.
 * The `decryptStringOrPassThrough` helper in the read path
 * handles both shapes transparently during the STUB-052
 * backfill window.
 *
 * Audit (P6.5 Slice 1): writes one `admin_audit_log` row on
 * every successful update via `writeSelfAuditLog`. The metadata
 * contains masked before/after for each changed field; the
 * plaintext PayPal email / tax id NEVER appears in the audit
 * row. Best-effort — a failed audit write doesn't abort the
 * update.
 */
export async function updatePartnerSettingsAction(input: unknown): Promise<PartnerSettingsResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  const parsed = PartnerSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        // P12.17 — use the full dotted path so nested errors
        // (e.g. `social_links.twitter`, `social_links.website`)
        // surface under the same key the form reads. The previous
        // `i.path[0]?.toString()` only captured the top-level
        // segment ("social_links"), which collapsed every nested
        // error into the same key — useless for the per-field error
        // display.
        parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]),
      ),
    }
  }

  // Snapshot the current row's audited fields so the audit log can
  // include a meaningful before/after diff. Runs in parallel with
  // the update below (we don't need the snapshot's return value
  // before issuing the update).
  //
  // P12.17 — snapshot now also reads social_links + is_public so the
  // audit row records before/after for the new fields.
  const snapshotPromise = supabase
    .from('partners')
    .select('id, bio, website_url, tax_country, tax_id, payout_method, social_links, is_public')
    .eq('user_id', user.id)
    .maybeSingle()

  // Build the update object. Empty strings → null. The
  // `payout_method` jsonb column gets the ENCRYPTED PayPal email
  // nested under `paypal_email_encrypted`.
  //
  // P12.17 — social_links is stored as-is (Zod already validated
  // each field's regex at the parse boundary; we trust the app
  // layer). is_public is always written as the boolean from the
  // form (the form always sends true OR false so the action can
  // distinguish "user toggled OFF" from "user didn't visit").
  const { paypal_email, tax_country, tax_id, bio, website_url, social_links, is_public } = parsed.data
  const update: Record<string, unknown> = {
    bio: bio === '' ? null : bio,
    website_url: website_url === '' ? null : website_url,
    tax_country: tax_country.toUpperCase(),
    tax_id: tax_id === '' ? null : tax_id,
    social_links: compactSocialLinks(social_links),
    is_public,
  }
  if (paypal_email) {
    update.payout_method = { paypal_email_encrypted: encryptString(paypal_email) }
  } else {
    update.payout_method = null
  }

  const { error } = await supabase
    .from('partners')
    .update(update)
    .eq('user_id', user.id)

  if (error) {
    log.warn({ code: 'partner_settings_failed', msg: error.message }, 'partner settings update failed')
    return { ok: false, error: 'Could not save. Please try again.' }
  }

  // Build the audit diff from the snapshot.
  try {
    const { data: snapshot } = await snapshotPromise
    if (snapshot) {
      const beforePayout = snapshot.payout_method as Record<string, unknown> | null
      // Read the legacy `paypal_email` plaintext or decrypt the
      // new envelope so the audit diff reflects the BEFORE value
      // accurately. (Decryption failures → null — the audit row
      // will then show before=null even when the value was set,
      // which is the right signal — the row was corrupted.)
      const { decryptStringOrPassThrough } = await import('@foundations/security/encryption')
      const beforePaypalEmail =
        (typeof beforePayout?.paypal_email === 'string' ? beforePayout.paypal_email : null) ??
        (typeof beforePayout?.paypal_email_encrypted === 'string'
          ? decryptStringOrPassThrough(beforePayout.paypal_email_encrypted)
          : null)

      const beforeMap: Record<AuditedField, unknown> = {
        bio: snapshot.bio,
        website_url: snapshot.website_url,
        tax_country: snapshot.tax_country,
        tax_id: snapshot.tax_id,
        paypal_email: beforePaypalEmail,
        social_links: snapshot.social_links ?? {},
        is_public: snapshot.is_public === true,
      }
      const afterMap: Record<AuditedField, unknown> = {
        bio: parsed.data.bio || null,
        website_url: parsed.data.website_url || null,
        tax_country: tax_country.toUpperCase(),
        tax_id: parsed.data.tax_id || null,
        paypal_email: parsed.data.paypal_email || null,
        social_links: compactSocialLinks(social_links),
        is_public,
      }

      const diff: Partial<Record<AuditedField, FieldDiff>> = {}
      const fieldsChanged: AuditedField[] = []
      for (const field of AUDITED_FIELDS) {
        const d = diffForField(field, beforeMap[field], afterMap[field])
        if (d) {
          diff[field] = d
          fieldsChanged.push(field)
        }
      }

      if (fieldsChanged.length > 0) {
        const partnerId = (snapshot as { id: number | string }).id
        await writeSelfAuditLog({
          userId: user.id,
          userEmail: user.email ?? '',
          action: 'settings_self_update',
          targetKind: 'partners',
          targetId: String(partnerId),
          metadata: {
            target_table: 'partners',
            fields_changed: fieldsChanged,
            diff,
          },
        })
      }
    }
  } catch (auditErr) {
    // Best-effort audit — never abort the update.
    log.warn(
      { code: 'partner_settings_audit_failed', msg: (auditErr as Error).message },
      'partner settings audit write failed (settings saved; audit dropped)',
    )
  }

  revalidatePath('/partner/settings')
  return { ok: true }
}

/**
 * P12.17 — Strip null/empty/whitespace-only social-link fields before
 * writing to the DB. Keeps the jsonb payload tight (only set fields
 * are persisted) and makes the deep-equality check in
 * `diffForField` cheaper.
 *
 * Always returns an object (never null); if every field is empty,
 * returns `{}` to match the column default.
 */
function compactSocialLinks(input: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return out
  const obj = input as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.trim() !== '') {
      out[key] = value
    }
  }
  return out
}
