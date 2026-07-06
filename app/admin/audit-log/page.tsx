// /admin/audit-log — admin-only audit log search.
//
// RSC. Reads via `getAuditLogPage`. Filter form is plain HTML GET
// (URL is the source of truth). One small client island handles the
// pagination controls.

import { AdminShell } from '@features/admin'
import { getAuditLogPage } from '@features/admin/platform-settings/queries/getAuditLogPage'
import { AuditLogTable } from '@features/admin/platform-settings/components/AuditLogTable'
import { AuditLogFilters } from '@features/admin/platform-settings/components/AuditLogFilters'

export const dynamic = 'force-dynamic'

const INPUT_KEYS = [
  'actorEmail',
  'action',
  'targetKind',
  'targetId',
  'from',
  'to',
  'beforeId',
  'limit',
] as const

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const actorEmailQuery = stringParam(params, 'actorEmail')
  const actionQuery = stringParam(params, 'action')
  const targetKindQuery = stringParam(params, 'targetKind')
  const targetIdQuery = stringParam(params, 'targetId')
  const fromIso = dateStringToIso(stringParam(params, 'from'))
  const toIso = dateStringToIso(stringParam(params, 'to'))
  const limit = numberParam(params, 'limit', 50, 1, 200)
  const beforeIdRaw = numberParam(params, 'beforeId', 0, 1, Number.MAX_SAFE_INTEGER)

  const page = await getAuditLogPage({
    actorEmailQuery,
    actionQuery,
    targetKindQuery,
    targetIdQuery,
    fromIso: fromIso ?? undefined,
    toIso: toIso ?? undefined,
    limit,
    beforeId: beforeIdRaw > 0 ? beforeIdRaw : undefined,
  })

  return (
    <AdminShell title="Audit log">
      <AuditLogFilters
        initial={{
          actorEmail: actorEmailQuery ?? '',
          action: actionQuery ?? '',
          targetKind: targetKindQuery ?? '',
          targetId: targetIdQuery ?? '',
          from: stringParam(params, 'from') ?? '',
          to: stringParam(params, 'to') ?? '',
        }}
      />
      <AuditLogTable page={page} />
    </AdminShell>
  )
}

function stringParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = params[key]
  if (v == null) return undefined
  const raw = Array.isArray(v) ? v[0] : v
  if (raw == null || raw === '') return undefined
  return raw
}

function numberParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = stringParam(params, key)
  if (raw == null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/** Accept HTML datetime-local format (`YYYY-MM-DDTHH:MM`) and convert
 *  to the strict ISO 8601 the query expects. */
function dateStringToIso(raw: string | undefined): string | null {
  if (raw == null) return null
  // Reject obvious junk
  if (raw.length < 16) return null
  // Convert space-separated "YYYY-MM-DD HH:MM" to T-separated on the way in
  const normalized = raw.replace(' ', 'T')
  const tryDate = new Date(normalized)
  if (Number.isNaN(tryDate.getTime())) return null
  return tryDate.toISOString()
}

// Reference kept so future grep work doesn't think these are unused.
INPUT_KEYS satisfies readonly string[]
