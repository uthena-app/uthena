# 04-platform/storage/

File storage configuration. Bunny.net buckets, CDN, signed URL key rotation, lifecycle rules. The deploy-time configuration that makes the 3-tier storage model in `00-foundations/files/README.md` actually work.

## Files

- **`buckets.tf`** (or `.sh` for non-Terraform setups) — Bunny Storage zone creation, region config, replication rules.
- **`cdn.yaml`** — Bunny CDN pull zone config, edge cache rules, HLS streaming config.
- **`keys.md`** — the master record of signed-URL signing keys. When keys are rotated, when they expire, who's responsible.
- **`lifecycle.ts`** — lifecycle rules: when do we delete cold-tier originals? When do we move things between tiers?
- **`backup.md`** — backup policy: how often, to where, how restored.

## The 3-tier storage model

(Detailed in `00-foundations/files/README.md` — repeated briefly here for context.)

| Tier | Where | Configured in |
|---|---|---|
| **Origin (cold)** | Bunny Storage zone `uthena-origin` | `buckets.tf` |
| **Stream (hot)** | Bunny Stream library | `cdn.yaml` |
| **Edge cache** | Bunny CDN pull zone | `cdn.yaml` |

Each tier has its own config file or section. The relationship is:

```
Partner upload → Origin (cold, never served)
  → Transcoding pipeline reads origin, writes Stream (hot)
  → CDN pulls from Stream, caches at edge
  → Signed URLs come from the CDN, bound to the user
```

## Signed URL key rotation

The signing key in `00-foundations/files/signed-url.ts` is rotated quarterly. Rotation procedure:

1. Generate a new key pair in the HSM / Vault
2. Add the new key to Bunny's signing config (dual-sign for the rotation window)
3. Update `00-foundations/files/signed-url.ts` to use the new key
4. Open a PR, get human review
5. After deploy, verify old URLs still work (during dual-sign window)
6. After 7 days, remove the old key from Bunny
7. Update `keys.md` with the rotation record

The full procedure is in `05-ops/runbooks/secret-rotation.md`.

## Lifecycle rules

Originals (cold tier) are retained for **7 years** (compliance for digital products with tax implications). Streams (hot tier) are retained **indefinitely** (the active product). Edge cache is controlled by Bunny's default 30-day TTL.

What about products that get taken down (e.g. partner terminates, refund abuse)? Lifecycle:

- **Stream:** deleted from Bunny within 24 hours of takedown
- **Origin:** retained (in case the takedown is disputed; deleted manually by admin)
- **CDN edge cache:** purged on takedown

The `lifecycle.ts` script handles this:

```ts
// Pseudo-code
export async function takedownProduct(productId: string) {
  await deleteStreamVideos(productId);
  await purgeCdnCacheForProduct(productId);
  // Origin is kept; admin can delete manually
  await auditLog('product.takedown', { productId });
}
```

## Backups

- **Origin bucket:** daily snapshot to a separate region (Hetzner Storage Box or B2). 30-day retention.
- **Stream library:** no backup (can be regenerated from origin by re-running the transcoding pipeline)
- **Edge cache:** no backup (it's a cache)
- **Database:** daily logical backup + 7-day point-in-time recovery. See `05-ops/runbooks/`.

## CDN config

The Bunny CDN config (`cdn.yaml`) defines:

- **Origins:** the Bunny Storage zone and Stream library
- **Pull zones:** which zones the CDN pulls from
- **Edge rules:**
  - `*.m3u8` → 5-minute cache (manifests change as bitrate ladders adjust)
  - `*.ts` → 1-year cache (segments are immutable)
  - `*.jpg` → 30-day cache
  - Everything else → default
- **Token authentication:** the URL signing is enforced at the CDN layer
- **Geo restrictions:** none in v1 (we serve globally)
- **Hotlink protection:** enforced via signed URLs (no referer-based blocking)

## Bunny account hardening

ADR-0001 made Bunny a single vendor for all content — which makes the Bunny *account* a single point of failure. The account gets the same rigor as the code. Verified at every security audit (`06-quality/checklists/security-audit.md`):

- [ ] **2FA enabled** on the Bunny account (and on every team member's access, if Bunny team accounts are used)
- [ ] **API keys are scoped**: the app's key can manage storage zones and signing only — not billing, not account settings. Separate read-only key for the CDN log ingestion job (`04-platform/observability/README.md`)
- [ ] **Token authentication enabled on every zone** — storage zones AND Stream library AND pull zones. A zone without token auth is a public bucket; creating one is a Critical audit finding
- [ ] **No zone allows directory listing**
- [ ] **API keys live in Doppler/Vault** (never in the repo) and rotate per `05-ops/runbooks/secret-rotation.md`
- [ ] **Signing keys** rotate quarterly (routine, dual-sign) — and the no-overlap emergency rotation has been rehearsed in staging (`05-ops/runbooks/security-incident.md` Play A)
- [ ] **Webhook endpoints verify Bunny's signature** (same rule as Stripe/PayPal — `04-platform/webhooks/`)
- [ ] **Dashboard access list reviewed**: who can log in to the Bunny dashboard, and is each person still on the team?

## When you need to change storage config

1. Open a PR with the change
2. Tag the platform agent for review
3. The platform agent merges after a manual test in staging
4. The change is deployed to prod via the standard deploy pipeline

Storage changes that affect production traffic (e.g. changing CDN cache rules) are deployed during low-traffic windows (02:00–04:00 UTC).

## What does NOT go here

- File upload logic (that's in `00-foundations/files/upload.ts`)
- Signed URL generation (that's in `00-foundations/files/signed-url.ts`)
- Video transcoding (that's a separate pipeline; config in `04-platform/ci/`)
- Application-level file access (server actions in `02-features/[name]/actions/`)

If you're writing TypeScript that touches the database or generates URLs, you're in the wrong folder.
