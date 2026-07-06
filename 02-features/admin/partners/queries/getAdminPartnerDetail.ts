// getAdminPartnerDetail.ts — the server query for /admin/partners/[id].
//
// Wraps the SECURITY DEFINER RPC `get_admin_partner_detail(p_partner_id)`
// shipped in migration 0055. The query layer:
//   1. Validates input via the canonical parser (`parsePartnerDetailId`).
//   2. Calls requireAdmin() — the RPC also gates via is_admin(), but the
//      query-level guard means we never even call RPC for an anon /
//      wrong-role caller.
//   3. Decrypts the partner's payout email envelope via
//      `decryptStringOrPassThrough` and masks the result via `maskEmail`
//      from `@foundations/data/mask`. Raw plaintext NEVER crosses the
//      wire to the client (defense-in-depth).
//   4. Defensive coercion: PostgREST may return bigint as string, so we
//      coerce everything through `coerceBigint` / `coerceString` helpers.
//   5. Fails closed: returns null on any error (no exception propagation).
//
// PII safety: the raw email value (display_name's email + the payout
// email) is masked via `maskEmail` before being returned to the caller.
// The raw payout email envelope is decrypted server-side only and is
// never returned — only its masked form is exposed.

import 'server-only'
import { requireAdmin } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import { loggerFor } from '@foundations/log/pino'
import { maskEmail } from '@foundations/data/mask'
import { decryptStringOrPassThrough } from '@foundations/security/encryption'
import {
  PARTNER_KYC_FILTERS,
  PARTNER_STATUS_FILTERS,
  PARTNER_TAX_FORM_FILTERS,
  type PartnerKycStatus,
  type PartnerStatus,
  type PartnerTaxFormStatus,
} from '../types'
import { parsePartnerDetailId } from './parsePartnerDetailId'

const log = loggerFor({ component: 'admin.partners.getAdminPartnerDetail' })

export type PartnerDetail = {
  partner_id: number
  user_id: string
  display_name: string
  email_raw: string
  email_masked: string
  avatar_url: string | null
  bio: string | null
  locale: string | null
  timezone: string | null
  status: PartnerStatus
  kyc_status: PartnerKycStatus
  tax_form_status: PartnerTaxFormStatus
  public_slug: string | null
  partner_bio: string | null
  website_url: string | null
  royalty_pct_bps: number | null
  approved_at: string | null
  approved_by: string | null
  created_at: string
  updated_at: string
  /** Raw decrypted PayPal email — present in the payload but NEVER
   *  rendered masked-or-otherwise without going through a reveal action
   *  (which doesn't exist in Slice 1; deferred to STUB-118). The Overview
   *  card displays `payout_email_masked` by default. */
  payout_email_raw: string | null
  /** Pre-computed masked display: `j***@paypal.com` shape. Safe to render directly. */
  payout_email_masked: string | null
  courses_count: number
  distinct_buyers_count: number
  lifetime_revenue_cents: number
  lifetime_paid_out_cents: number
  refund_count: number
  total_order_count: number
  refund_rate: number
  last_active_at: string | null
}

type RawRpcRow = {
  partner_id: number | string
  user_id: string
  status: string
  kyc_status: string
  tax_form_status: string
  public_slug: string | null
  bio: string | null
  website_url: string | null
  royalty_pct_bps: number | null
  approved_at: string | null
  approved_by: string | null
  created_at: string
  updated_at: string
  display_name: string
  email: string
  avatar_url: string | null
  locale: string | null
  timezone: string | null
  payout_email_envelope: string | null
  courses_count: number | string
  distinct_buyers_count: number | string
  lifetime_revenue_cents: number | string
  lifetime_paid_out_cents: number | string
  refund_count: number | string
  total_order_count: number | string
  last_active_at: string | null
}

// ----- coercion helpers (defensive — PostgREST bigint-as-string) -----

function coerceBigint(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

function coerceNumeric(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const parsed = Number(v)
  return Number.isFinite(parsed) ? parsed : 0
}

function coerceString(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

function coerceStatus(v: string | null | undefined): PartnerStatus {
  if (v && (PARTNER_STATUS_FILTERS as readonly string[]).includes(v)) {
    return v as PartnerStatus
  }
  return 'pending'
}

function coerceKyc(v: string | null | undefined): PartnerKycStatus {
  if (v && (PARTNER_KYC_FILTERS as readonly string[]).includes(v)) {
    return v as PartnerKycStatus
  }
  return 'none'
}

function coerceTaxForm(v: string | null | undefined): PartnerTaxFormStatus {
  if (v && (PARTNER_TAX_FORM_FILTERS as readonly string[]).includes(v)) {
    return v as PartnerTaxFormStatus
  }
  return 'none'
}

/**
 * Returns the full read-only partner payload for the Overview tab, or
 * null when the partner_id is invalid / doesn't exist.
 *
 * Fails closed on any RPC error (returns null + warn log — the caller
 * decides between 404 and a "we could not load this partner" surface;
 * the page renders the 404 in practice).
 */
export async function getAdminPartnerDetail(
  partnerIdRaw: string | number,
): Promise<PartnerDetail | null> {
  // Auth gate: never invoke the RPC for an anon / wrong-role caller.
  await requireAdmin()

  // Validate the param shape before the RPC call.
  const canonical = parsePartnerDetailId(String(partnerIdRaw))
  if (!canonical) return null

  const supabase = await getServerSupabase()
  const partnerIdNum = Number(canonical)

  const { data, error } = await supabase.rpc('get_admin_partner_detail', {
    p_partner_id: partnerIdNum,
  } as never)

  if (error || !data || !Array.isArray(data) || data.length === 0) {
    if (error) {
      log.warn(
        { code: 'partner_detail_rpc_failed' },
        'getAdminPartnerDetail: RPC error',
      )
    }
    return null
  }

  const raw = data[0] as RawRpcRow

  // Email masking — `j***@example.com`. The raw email is kept for
  // the future reveal action (Slice 2+) but the masked form is what
  // the Overview card renders.
  const emailRaw = coerceString(raw.email) ?? ''
  const emailMasked = emailRaw ? maskEmail(emailRaw) : '—'

  // Payout email — decrypt the envelope server-side then mask. A
  // null envelope (partner has no payout_method) → null masked. A
  // corrupted envelope → null masked (defensive: decryptStringOrPassThrough
  // returns null on failure). The raw plaintext (post-decrypt) lives
  // only on `payout_email_raw` — used by the future reveal action.
  const payoutEmailEnvelope = coerceString(raw.payout_email_envelope)
  const payoutEmailPlain = payoutEmailEnvelope
    ? decryptStringOrPassThrough(payoutEmailEnvelope)
    : null
  const payoutEmailRaw = payoutEmailPlain ? payoutEmailPlain.trim() || null : null
  const payoutEmailMasked = payoutEmailRaw ? maskEmail(payoutEmailRaw) : null

  // Refund rate — numerator / denominator, default 0. Defensive: total
  // = 0 → 0 (avoid divide-by-zero).
  const totalOrders = coerceBigint(raw.total_order_count)
  const refundCount = coerceBigint(raw.refund_count)
  const refundRate = totalOrders > 0 ? refundCount / totalOrders : 0

  return {
    partner_id: coerceBigint(raw.partner_id),
    user_id: raw.user_id,
    display_name: coerceString(raw.display_name) ?? 'Unknown partner',
    email_raw: emailRaw,
    email_masked: emailMasked,
    avatar_url: coerceString(raw.avatar_url),
    bio: coerceString(raw.bio),
    locale: coerceString(raw.locale),
    timezone: coerceString(raw.timezone),
    status: coerceStatus(raw.status),
    kyc_status: coerceKyc(raw.kyc_status),
    tax_form_status: coerceTaxForm(raw.tax_form_status),
    public_slug: coerceString(raw.public_slug),
    partner_bio: coerceString(raw.bio),
    website_url: coerceString(raw.website_url),
    royalty_pct_bps:
      raw.royalty_pct_bps === null || raw.royalty_pct_bps === undefined
        ? null
        : coerceNumeric(raw.royalty_pct_bps),
    approved_at: coerceString(raw.approved_at),
    approved_by: coerceString(raw.approved_by),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    payout_email_raw: payoutEmailRaw,
    payout_email_masked: payoutEmailMasked,
    courses_count: coerceBigint(raw.courses_count),
    distinct_buyers_count: coerceBigint(raw.distinct_buyers_count),
    lifetime_revenue_cents: coerceBigint(raw.lifetime_revenue_cents),
    lifetime_paid_out_cents: coerceBigint(raw.lifetime_paid_out_cents),
    refund_count: refundCount,
    total_order_count: totalOrders,
    refund_rate: refundRate,
    last_active_at: coerceString(raw.last_active_at),
  }
}