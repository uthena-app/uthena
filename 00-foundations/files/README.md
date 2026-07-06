# 00-foundations/files/

File handling. Everything related to uploading, storing, signing, streaming, and auditing files lives here. This folder is the boundary between "the user uploaded a thing" and "the rest of the app gets a URL to that thing."

## Files

- **`bunny.ts`** — Bunny.net client wrapper. Has methods for: `getUploadUrl()`, `getStreamUrl()`, `getSignedDownloadUrl()`, `deleteFile()`. See `docs/ARCHITECTURE.md` §4 for the storage strategy.
- **`signed-url.ts`** — the canonical signed-URL helpers. The 4h TTL for streams and 24h TTL for downloads are defined here, not anywhere else.
- **`upload.ts`** — resumable upload manager (client-side, using tus.io protocol or Bunny's built-in chunked upload). Used by the partner upload wizard.
- **`audit.ts`** — logs every signed URL generation to `file_downloads`. This is the abuse-detection log.
- **`rate-limit.ts`** — rate limits on signed URL generation (60/hour, 1000/day per user).
- **`mime.ts`** — file type allow-list per upload zone (videos: MP4/MOV; source: PDF/PPTX/DOCX/ZIP; etc.).
- **`scan.ts`** — malware scan client (ClamAV). Called by the upload-complete webhook handler in `04-platform/webhooks/`. See "Malware scanning" below.

## The signed URL contract

**All file access in the app goes through signed URLs.** No direct bucket URLs. No "anyone with the URL can download" links. Always signed, always expiring, always IP-bound (for streaming).

**Signed URLs never appear in emails.** Every email that gives access to a file links to an auth-gated page (`/library`, `/library/vault`) — never to the file itself. The user logs in, then generates their own signed URL on-site. This rule is enforced at email-template review (`04-platform/emails/README.md`) and audited in `06-quality/checklists/security-audit.md`.

```ts
// In a server action
import { generateSignedDownloadUrl } from '00-foundations/files/signed-url';
import { logFileAccess } from '00-foundations/files/audit';

const url = await generateSignedDownloadUrl({
  fileId,
  userId,            // for audit (IP binding applies to streams only)
  expiresIn: '24h',
});
await logFileAccess({ userId, fileId, ip, userAgent });
return url;
```

**The 4h TTL on streams** is short. Why?
- Streams are bound to an IP. If a user shares their stream URL, it only works for their IP, and only for 4 hours.
- 4h is enough to watch a single lesson. To watch another, the player requests a new URL.
- The 4h window is what makes the IP binding actually useful.

**The 24h TTL on downloads** is long.
- Downloads are signed but NOT IP-bound (we tried IP binding on downloads and it broke too many legitimate use cases — partner downloads on phone, then on laptop, etc.).
- 24h gives the user time to actually use the URL.
- The audit log + rate limit are our defense against URL sharing abuse.

**Accepted risk — revocation lag.** A signed URL stays valid until its TTL expires, even if the user's `library_grant` is revoked (refund, abuse) after the URL was minted. Worst case: 24h of residual download access post-revocation. We accept this for v1 because (a) the user already had the file, (b) shortening the TTL hurts legitimate slow/retry downloads, and (c) revocation blocks all NEW URL generation immediately. If residual access is unacceptable in a specific incident (mass leak, legal demand), rotate the signing key — that kills every live URL at once. Procedure: `05-ops/runbooks/security-incident.md`.

**Large downloads (1GB+).**
- Signed URLs MUST permit HTTP Range requests so browsers and download managers can resume interrupted downloads. Verify the Bunny token config does not break Range (`Accept-Ranges: bytes` must survive token auth).
- A download that fails after URL expiry is resolved by regenerating the URL on `/library/vault` (counts against the rate limit — that's fine, the limit is 60/hour).
- **Test the download path with a real 1GB file in staging — including a kill-and-resume mid-download.** Same bar as the upload rule below. Don't ship without it.

## The 3 storage tiers

(Also covered in `docs/ARCHITECTURE.md` §4 — repeated here because it's relevant to the code in this folder.)

| Tier | Where | What lives here | Access |
|---|---|---|---|
| **Origin (cold)** | Bunny Storage (or B2) | Originals uploaded by partners | Never served directly. Read by transcoding pipeline only. |
| **Stream (hot)** | Bunny Stream | HLS-encoded video variants | Signed URLs, 4h TTL, IP-bound |
| **Edge cache** | Bunny CDN | HLS segments | Free, no auth |

The keys live in `product_files.storage_path` (originals) and `product_files.bunny_video_id` (stream). Migrations handle the path conventions.

## upload.ts — resumable uploads

Partners upload files up to 50GB. Network blips happen. We need resumable uploads.

The upload manager:
- Splits files into chunks (5MB default)
- Uploads chunks in parallel (max 3 at a time)
- Persists upload state in IndexedDB (so closing the tab doesn't lose progress)
- Resumes from the last successful chunk on page reload
- Reports progress to the parent component
- Handles cancel/pause via AbortController

We use the **tus protocol** (resumable open standard) or Bunny's built-in chunked upload. Whichever Bunny supports natively — check `bunny.ts` for the actual implementation.

**Test the upload path with a real 1GB file in staging.** Don't ship without it.

## audit.ts — the abuse log

Every signed URL generation is logged. The log structure:

```ts
{
  id: number;
  user_id: uuid;          // null for anonymous
  product_id: number;
  file_id: number;
  ip_address: inet;      // streams: raw IP (required for IP binding)
  ip_hash: text;         // downloads: sha256(ip + daily_salt) — privacy-preserving, still supports same-day distinct-IP abuse detection (matches the log-schema rule in 04-platform/observability/)
  user_agent: text;
  signed_url_expires_at: timestamptz;
  downloaded_at: timestamptz default now();
}
```

The `file_downloads` table in the DB mirrors this. The `audit.ts` helper is the only thing that should write to it. Retention: IP/IP-hash columns are nulled after 90 days (GDPR minimization; the row itself stays for download history).

**The log is monitored.** This table records URL *generation*. URL *access* (who actually hit the CDN, from where, how often) comes from Bunny CDN access logs, ingested per `04-platform/observability/README.md` ("CDN log ingestion"). Both feed the abuse flags:
- > 1000 URLs generated per user per day → flag for review (source: this table)
- Same URL accessed from > 10 distinct IPs in a day → flag (source: CDN logs)
- Generated URL accessed > 10 times in an hour → flag (source: CDN logs)

If a user is flagged, the admin can revoke their library_grant and force a re-issue.

## rate-limit.ts — abuse limits

Two layers of rate limits:

1. **Per-user:** max 60 signed URL generations per hour, 1000 per day. Default. Tunable.
2. **Per-IP:** max 500 signed URL generations per hour, 5000 per day. (Prevents a user from creating 1000 accounts to bypass their per-user limit.)

Implementation: Upstash Redis in prod, in-memory Map in dev. Same API for both.

```ts
import { rateLimit } from '00-foundations/files/rate-limit';

const result = await rateLimit({
  key: `signed-url:${userId}`,
  limit: 60,
  window: '1h',
});
if (!result.allowed) {
  throw new Error('Rate limit exceeded. Try again in 23 minutes.');
}
```

## scan.ts — malware scanning (v1, blocking)

Every partner-uploaded file is scanned before it can be served to a customer. This is v1 scope, not v2 — we redistribute uploaded ZIPs to paying customers; one infected archive at scale is an existential trust event.

The flow:

1. Partner upload completes → Bunny webhook fires → handler in `04-platform/webhooks/` calls `scan.ts`
2. `scan.ts` runs ClamAV against the file (ZIPs are scanned recursively, including nested archives; max nesting depth 5, max decompressed size 10x — both to block zip bombs)
3. **Clean** → file is marked `scan_status='clean'` and becomes eligible for review/publication
4. **Infected** → file is marked `scan_status='infected'` and quarantined (never served, never reviewable), the partner gets a clear error on the upload page, an admin alert fires
5. **Scan failure** (timeout, oversized) → `scan_status='failed'`, treated as NOT clean; admin can manually re-trigger

A file with `scan_status != 'clean'` can never be attached to a published product — enforce this in the publish server action AND as a DB constraint. The product submit checklist (see `01-specs/pages/instructor-upload.md`) shows scan status per file.

## mime.ts — the file type allow-list

Each upload zone has a type allow-list:

```ts
export const videoMimeTypes = ['video/mp4', 'video/quicktime'] as const;
export const sourceMimeTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
  'application/zip',
  'application/x-zip-compressed',
] as const;
export const assetMimeTypes = [
  'text/html', 'text/plain', 'application/pdf', 'image/png', 'image/jpeg', 'image/svg+xml', 'application/zip',
] as const;
```

Validation happens on both client (UX — reject before upload) and server (security — actually enforce).

## What does NOT go here

- Database schema for files (that's in `01-specs/pages/_data-model.md`)
- Webhook handlers for upload events (those are in `04-platform/webhooks/`)
- The actual file viewer / player UI (that's in `02-features/library/components/`)
- Image processing / optimization (use `next/image`; if you need custom processing, it goes in a feature folder, not here)

If you find yourself adding business logic to a file in this folder, you're probably in the wrong folder. Move it to the relevant feature.

## refund-proof-upload.ts — user-side refund evidence (P9.12)

The `/account/orders/[id]/refund` page lets a user optionally attach a proof-of-issue file (screenshot / receipt / PDF, ≤ 10 MiB, `image/jpeg | image/png | application/pdf`). This is the user-side evidence delivery surface; admins view the files via the P14.9 admin queue using a separate signed-URL download helper (not yet wired — STUB-066-followup).

The upload pattern mirrors the avatar surface (P9.2):
- `refund-proof-upload-constants.ts` — pure constants (mime allowlist, 10 MiB cap, ext mapper, filename sanitizer). Safe to import from client islands.
- `refund-proof-upload.ts` — server-only mint helper. Same `UploadNotConfiguredError` class as the avatar surface (re-exported for ergonomics); the action's `instanceof` check is unchanged.
- Storage path: `refund-proofs/{userId}/{uuid}.{ext}`. The userId namespace sandbox bounds a forged request's write surface (a leaked upload URL only permits a write under the attacker's own userId). The UUID suffix means concurrent uploads from the same user don't collide (orphan files are accepted per the spec; janitor cleanup is a v2 follow-up).

**Why proofs are private, not public**: the avatar surface returns a `publicUrl` for client-side display; refund proofs are admin-only and the action returns only `uploadUrl` + `storagePath`. The `sanitizedFilename` returned alongside is the server-side sanitized version (a-zA-Z0-9._-, capped 120 chars) — the canonical value the form passes to `createRefundRequestAction` as `proof_filename`. Keeping the sanitizer on the server means the rules live in one place.

**ClamAV scanning is intentionally NOT run on refund-proof uploads.** The spec accepts this — see `01-specs/pages/account-refund.md` §Security line 102. The blast radius of a malicious proof is "the admin who opens it", which is the same blast radius as the admin opening any email attachment. v1 is fail-open here; a future cron can scan the `refund-proofs/` prefix without code changes at this surface.
