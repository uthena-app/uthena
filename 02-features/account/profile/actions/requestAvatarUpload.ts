'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { getServerSupabase } from '@foundations/data/supabase'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  type AvatarMime,
  UploadNotConfiguredError,
  isAvatarUploadConfigured,
  requestAvatarUpload,
} from '@foundations/files/upload'
import { loggerFor } from '@foundations/log/pino'
import { writeSelfAuditLog } from './writeSelfAuditLog'

const log = loggerFor({ component: 'account.profile.avatar' })

// Input schema — mime allowlist + size cap, enforced at the action
// boundary before we mint anything. Matches the spec
// (`01-specs/pages/account-profile.md` §Security line 104). The
// mime is narrowed to the same enum the foundation module uses so
// the server-side gate is the same allowlist the helper enforces.
const RequestAvatarUploadInput = z.object({
  mime: z.enum(AVATAR_MIME_TYPES),
  size: z.number().int().min(1).max(AVATAR_MAX_BYTES),
})

export type RequestAvatarUploadResult =
  | {
      ok: true
      uploadUrl: string
      publicUrl: string
      storagePath: string
      expiresAt: string // ISO 8601 string for JSON serialization
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

/**
 * Mint a one-shot signed PUT URL for an avatar upload. The caller is
 * responsible for:
 *   - Validating the picked file client-side BEFORE calling this
 *     (mime allowlist + 5MB cap; client islands short-circuit on
 *     failure with an inline error so the user isn't waiting on a
 *     round-trip to find out).
 *   - Issuing a `PUT <uploadUrl>` with the file as the request body
 *     and `Content-Type: <mime>` header.
 *   - Using the `publicUrl` as the value for `profiles.avatar_url`
 *     (via the existing `updateProfileAction` on Save — so this
 *     action doesn't write the DB row; the avatar is "staged" until
 *     the user clicks Save).
 *
 * What this action does server-side:
 *   1. Auth gate: must be signed in. The avatar is the user's own.
 *      Supabase Auth session is the canonical source.
 *   2. Zod-validate mime (allowlist) + size (1..5MB).
 *   3. Env gate: Bunny storage must be configured. Without it, the
 *      endpoint returns a friendly error so the client can render
 *      a "temporarily unavailable" state.
 *   4. Mint the signed upload URL via `requestAvatarUpload`.
 *   5. Write an `admin_audit_log` row with `action='avatar_upload_requested'`,
 *      `target_kind='avatars'`, metadata `{ mime, size, storagePath,
 *      expiresAt }`. The metadata NEVER includes the email, the user
 *      id, the IP, or the user agent in plain — those are stored on
 *      the parent row (actor_id / actor_email / ip / user_agent).
 *      The IP + UA are read via Next's `headers()` for the audit row
 *      and never logged via `console.*`.
 *   6. Return `{ uploadUrl, publicUrl, storagePath, expiresAt }`.
 *
 * The action NEVER auto-saves the avatar to `profiles`. The user
 * must click Save on the form, which runs `updateProfileAction`
 * with the new `avatar_url`. This preserves the existing dirty-state
 * guard and `beforeunload` confirmation: if the user picks an
 * avatar then closes the tab, the upload URL expires in 5 minutes
 * and Bunny storage gets a janitor cleanup later (per spec §Open
 * Questions line 150 — orphan files are accepted, not deleted).
 */
export async function requestAvatarUploadAction(
  input: unknown,
): Promise<RequestAvatarUploadResult> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !user.id || !user.email) {
    return { ok: false, error: 'Not signed in' }
  }

  // Zod-validate first; skip Bunny entirely if the input is bad.
  const parsed = RequestAvatarUploadInput.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the errors below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path[0]?.toString() ?? '_', i.message]),
      ),
    }
  }
  const mime: AvatarMime = parsed.data.mime
  const size = parsed.data.size

  // Env gate — fail-open on Bunny-not-configured is the wrong call
  // (users would lose their avatar silently). Fail closed with a
  // friendly error.
  if (!isAvatarUploadConfigured()) {
    log.warn(
      { code: 'avatar_upload_unconfigured', mime, size },
      'requestAvatarUploadAction called but Bunny storage is not configured',
    )
    return {
      ok: false,
      error: 'Avatar upload is temporarily unavailable. Please try again later.',
    }
  }

  let minted
  try {
    minted = requestAvatarUpload({
      userId: user.id,
      mime,
      size,
    })
  } catch (err) {
    if (err instanceof UploadNotConfiguredError) {
      // Race: env was configured at the gate check but cleared on the
      // helper call. Treat it identically.
      return {
        ok: false,
        error: 'Avatar upload is temporarily unavailable. Please try again later.',
      }
    }
    log.warn(
      { code: 'avatar_upload_mint_failed', msg: (err as Error).message },
      'requestAvatarUploadAction: mint failed',
    )
    return { ok: false, error: 'Could not prepare the upload. Please try again.' }
  }

  // Audit row. The metadata is intentionally minimal: mime + size +
  // storage path + expiresAt. No email, no IP — those columns on the
  // audit row itself carry the equivalent information for ops.
  const hdrs = await headers()
  await writeSelfAuditLog({
    userId: user.id,
    userEmail: user.email,
    action: 'avatar_upload_requested',
    // New target kind. The column is free text so no migration is
    // needed; the union in `writeSelfAuditLog` is extended in the
    // same PR (see modified SelfAuditInput.targetKind).
    targetKind: 'avatars',
    targetId: user.id,
    metadata: {
      mime,
      size,
      storagePath: minted.storagePath,
      expiresAt: minted.expiresAt.toISOString(),
    },
    ipAddress: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent') ?? null,
  })

  return {
    ok: true,
    uploadUrl: minted.uploadUrl,
    publicUrl: minted.publicUrl,
    storagePath: minted.storagePath,
    expiresAt: minted.expiresAt.toISOString(),
  }
}
