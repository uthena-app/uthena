// reencrypt-legacy-payout-methods.ts — STUB-052 fix. Background cron
// that re-encrypts legacy plaintext `partners.payout_method` rows at
// rest.
//
// Background: P6.5 Slice 1 wired application-layer AES-256-GCM
// encryption for the partner's PayPal payout email
// (00-foundations/security/encryption.ts, `encryptString` /
// `decryptStringOrPassThrough`). The encrypt path runs on every NEW
// write (`02-features/partner-portal/actions/updatePartnerSettings.ts`),
// so any partner who edits their payout method after that tick ships
// an encrypted envelope. But rows written BEFORE that tick still have
// the legacy plaintext shape:
//
//   payout_method = { paypal_email: 'alice@example.com' }
//
// These rows render correctly today (the read path,
// `decryptPayoutMethod.ts`, transparently falls back to plaintext via
// `decryptStringOrPassThrough` when the value doesn't match the
// encrypted-envelope regex), but the email sits in the DB unencrypted
// — a PII-at-rest gap per AGENTS.md §2 ("No PII in logs... No secrets
// in code") and the partner-settings spec's encryption-at-rest
// requirement. This cron closes that gap without changing the
// read-path contract: it reads legacy rows, encrypts the plaintext
// value with the SAME `encryptString()` helper the live write path
// uses (no new crypto library — reuses 00-foundations/security/encryption.ts
// per the ponytail rule), and writes back
// `payout_method.paypal_email_encrypted`. The legacy `paypal_email`
// key is DELETED on the same write (not kept for a "rollback cycle" —
// keeping plaintext PII around after we've already encrypted it would
// defeat the point; git history + admin_audit_log are the rollback
// path if ever needed).
//
// Idempotent + paginated + per-row audit log, per the STUB-052 spec:
//   - Idempotent: `needsReencryption()` only matches rows where
//     `paypal_email` is a non-empty plaintext string that ISN'T
//     already an encrypted envelope, so a row this cron already
//     processed (or a row a partner encrypted themselves via a normal
//     settings edit) is never re-selected on the next run.
//   - Paginated: sweeps all partners in batches of PAGE_SIZE (keyset
//     on id) so a partner table with many rows doesn't hold one giant
//     result set in memory or one giant transaction.
//   - Per-row audit log: one `admin_audit_log` row per successfully
//     re-encrypted partner (masked email only — never the plaintext).
//   - Summary metric: logs a `reencrypted_count` / `failed_count`
//     summary line for ops (matches the `release-locked-balances.ts` /
//     `cron-partition-rollforward.ts` cron logging convention).
//
// Schedule via Coolify's scheduler (same convention as the other
// crons in this directory):
//
//   0 5 * * *  /usr/bin/node /app/04-platform/ci/scripts/cron/reencrypt-legacy-payout-methods.ts

import 'server-only'
import { getServiceSupabase } from '@foundations/data/supabase'
import { encryptString, isEncryptedEnvelope } from '@foundations/security/encryption'

const PAGE_SIZE = 200
/** System actor UUID for cron-triggered audit rows — matches the
 *  established pattern in 00-foundations/auth/rate-limit.ts and the
 *  webhook handlers added alongside this cron (onPaymentFailed.ts /
 *  onDispute.ts). */
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

type LegacyPartnerRow = {
  id: number
  payout_method: Record<string, unknown> | null
}

/** Mask an email for logging/audit — same shape as
 *  `02-features/partner-portal/format.ts` `maskEmail` (kept local to
 *  avoid importing a feature module from a platform cron script; the
 *  masking logic is trivial and stable). Exported for the unit test
 *  (`reencrypt-legacy-payout-methods.test.ts`). */
export function maskEmailForAudit(email: string): string {
  const at = email.indexOf('@')
  if (at <= 1) return '***'
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

export async function reencryptOnePartner(
  service: ReturnType<typeof getServiceSupabase>,
  row: LegacyPartnerRow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Fresh read-modify-write: re-fetch the row immediately before
  // writing (rather than trusting the page-read snapshot) so a race
  // with a concurrent partner self-edit — which could have already
  // encrypted this row between the sweep's SELECT and this write — is
  // never clobbered. If the fresh read no longer needs re-encryption
  // (already encrypted, or the email was cleared), this is a no-op
  // success.
  const { data: fresh, error: freshErr } = await service
    .from('partners')
    .select('id, payout_method')
    .eq('id', row.id)
    .maybeSingle()
  if (freshErr) {
    return { ok: false, error: `re-read failed: ${freshErr.message}` }
  }
  if (!fresh || !needsReencryption(fresh as LegacyPartnerRow)) {
    return { ok: true }
  }

  const plaintext = (fresh as LegacyPartnerRow).payout_method?.paypal_email as string
  let encrypted: string
  try {
    encrypted = encryptString(plaintext.trim())
  } catch (err) {
    return { ok: false, error: `encrypt failed: ${err instanceof Error ? err.message : 'unknown'}` }
  }

  // Rebuild payout_method: encrypted envelope in, legacy plaintext key
  // OUT (never leave plaintext PII at rest once we hold the encrypted
  // form — see the file header for why this diverges from the
  // original STUB-052 spec's "keep for one cycle" note).
  const nextPayoutMethod: Record<string, unknown> = { ...((fresh as LegacyPartnerRow).payout_method ?? {}) }
  delete nextPayoutMethod.paypal_email
  nextPayoutMethod.paypal_email_encrypted = encrypted

  const { error: updateErr } = await service
    .from('partners')
    .update({ payout_method: nextPayoutMethod } as never)
    .eq('id', row.id)

  if (updateErr) {
    return { ok: false, error: updateErr.message }
  }

  try {
    await service.from('admin_audit_log').insert({
      actor_id: SYSTEM_ACTOR_ID,
      actor_email: 'system:reencrypt_cron@uthena.audit',
      action: 'partner_payout_method_reencrypted',
      target_kind: 'partners',
      target_id: String(row.id),
      metadata: { paypal_email_masked: maskEmailForAudit(plaintext.trim()) },
    } as never)
  } catch {
    // Best-effort — the re-encryption itself already succeeded; an
    // audit-write failure shouldn't fail the whole row.
  }

  return { ok: true }
}

/** Legacy-plaintext detector — the row needs re-encryption iff
 *  `payout_method.paypal_email` is a non-empty string AND it is NOT
 *  already an encrypted envelope. Reuses `isEncryptedEnvelope` (the
 *  same strict 3-segment base64url check the live read path uses in
 *  `02-features/partner-portal/queries/decryptPayoutMethod.ts`) so the
 *  cron's notion of "legacy" never drifts from the app's notion of
 *  "already encrypted". Deliberately does NOT rely on a PostgREST JSON
 *  operator filter string (`payout_method->paypal_email`) — filtering
 *  in application code keeps this money/PII-adjacent script's
 *  correctness independent of exact PostgREST JSON-path filter syntax
 *  support, which isn't exercised anywhere else in this codebase.
 *  Exported for the unit test. */
export function needsReencryption(row: LegacyPartnerRow): boolean {
  const raw = row.payout_method?.paypal_email
  if (typeof raw !== 'string' || raw.trim() === '') return false
  return !isEncryptedEnvelope(raw)
}

export async function main() {
  const service = getServiceSupabase()
  let reencryptedCount = 0
  let failedCount = 0
  const failures: Array<{ partner_id: number; error: string }> = []

  // Paginated sweep over ALL partners with a non-null payout_method
  // (keyset on id, ascending — stable ordering across pages even if
  // rows are updated mid-sweep, since updated rows keep their id).
  // The legacy/already-encrypted decision is made in JS via
  // `needsReencryption` rather than a DB-side JSON filter (see the
  // comment on that function). Bounded by a max-iterations guard so a
  // pathological loop can't run forever.
  const MAX_ITERATIONS = 5000
  let afterId = 0
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const { data: rows, error: readErr } = await service
      .from('partners')
      .select('id, payout_method')
      .not('payout_method', 'is', null)
      .gt('id', afterId)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)

    if (readErr) {
      console.error(
        JSON.stringify({ ok: false, code: 'reencrypt_read_failed', msg: readErr.message }),
      )
      process.exitCode = 2
      return
    }
    if (!rows || rows.length === 0) break

    for (const row of rows as LegacyPartnerRow[]) {
      afterId = row.id
      if (!needsReencryption(row)) continue
      const result = await reencryptOnePartner(service, row)
      if (result.ok) {
        reencryptedCount++
      } else {
        failedCount++
        failures.push({ partner_id: row.id, error: result.error })
      }
    }

    if (rows.length < PAGE_SIZE) break // last page
  }

  console.log(
    JSON.stringify({
      ok: failedCount === 0,
      reencrypted_count: reencryptedCount,
      failed_count: failedCount,
      failures: failures.slice(0, 20), // cap the log line size
    }),
  )
  if (failedCount > 0) process.exitCode = 1
}

// CLI entry point — only runs when invoked directly (`tsx
// reencrypt-legacy-payout-methods.ts` / the Coolify cron command),
// not when imported by a test. Matches the `isDirectInvocation` guard
// used by 04-platform/ci/scripts/db-bootstrap.ts and db-types.ts.
function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false
  return (
    process.argv[1].endsWith('reencrypt-legacy-payout-methods.ts') ||
    process.argv[1].endsWith('reencrypt-legacy-payout-methods')
  )
}

if (isDirectInvocation()) {
  main().catch((err) => {
    console.error(
      JSON.stringify({
        ok: false,
        code: 'reencrypt_legacy_payout_methods_unhandled_error',
        msg: err instanceof Error ? err.message : 'unknown',
      }),
    )
    process.exitCode = 2
  })
}
