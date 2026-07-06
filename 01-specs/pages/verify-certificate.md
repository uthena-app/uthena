# Verify Certificate — `/verify/certificate/[code]`

## What this page does

The **public** certificate verification page. Anyone — including anonymous visitors — can land on this URL to verify a certificate of completion. The URL takes the public 8-character base-32 `code` printed on the certificate PDF (e.g. `7F2K9P4QX`).

The page shows: product title, partner display name, issue date, the certificate holder's `display_name` (public per `profiles` RLS), and a status badge — **Verified**, **Not found**, or **Revoked**. No login is required. No PII beyond the holder's `display_name` is exposed; the holder's email, real name, `user_id`, and any other profile data are not returned.

**This page is the ONLY public surface for certificate codes.** The internal `id` (`bigint`) is never used in URLs, never indexed publicly, and never exposed to a logged-out visitor. The 8-char base-32 code is the only handle. Brute-force resistance is ~40 bits of entropy per code; the 60-requests-per-IP-per-hour rate limit is the real defense (a 40-bit sweep would take ~3 years at the rate limit, assuming no collisions).

If the certificate is `active`, the page shows the verification result. If the code does not match any row, the page shows a "Not found" state (and logs the attempt to admin_audit_log for abuse monitoring). If the certificate is `revoked` (e.g. the underlying product was refunded, or the partner was banned), the page shows a "Revoked on {date}" badge with a reason if admin provided one.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Certificate verification" title | hard-coded | H1 |
| Status badge | "Verified" / "Not found" / "Revoked on {revoked_at}" with optional reason | `certificates.status` | color-coded badge: green / amber / red |
| Verified card | "This certificate is authentic and was issued by Uthena." | hard-coded | sentence under badge |
| Verified card | product `title` | `products.title` (joined via `certificates.product_id`) | large text, linked to `/products/[slug]` |
| Verified card | "Issued by {partner.display_name}" | `partners.user_id` → `profiles.display_name` | small text |
| Verified card | "Issued on {issued_at}" in human format | `certificates.issued_at` | small muted text |
| Verified card | "Holder: {profiles.display_name}" | `auth.users` → `profiles.display_name` (the certificate owner) | small text, **no email, no user_id** |
| Verified card | "Verify another certificate" link → `/verify/certificate` (a tiny landing page with a code input — see Open Questions §3) | hard-coded link | secondary action |
| Revoked state | "This certificate was revoked on {revoked_at}." | `certificates.revoked_at` | prominent text |
| Revoked state | reason (if `revoked_reason` is non-null) | `certificates.revoked_reason` | small italic text below |
| Not-found state | "We couldn't find a certificate with that code." | hard-coded | amber tone |
| Not-found state | "If you reached this page from a link, the certificate may be fake, mistyped, or revoked." | hard-coded | helpful follow-up sentence |
| Footer | "Uthena verification • {current_year}" | hard-coded | small muted text |

**Server load:** `verifyCertificateByCode(code)` in `02-features/certificates/queries/verifyCertificateByCode.ts` — looks up `certificates` by `certificate_code` (unique index), joins `products` (read-only, public) and `profiles` (the partner's and the holder's `display_name` only). The query is performed under the **service role** to bypass RLS (anon visitors have no auth.uid()), then a strict allowlist returns only the public-safe fields above.

**No PII leak:** the query result is filtered through a Zod schema that strips everything except the fields listed in the table. Even if the underlying `certificates` row had an unintended PII column, it would not reach the response.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Verify a code | Navigate to `/verify/certificate/[code]` | Page renders the verify result for that code | public |
| Open product page | Click the product title in the verified card | Navigate to `/products/[slug]` | public |
| Verify another | Click "Verify another certificate" | Navigate to a small landing page with a code input (`/verify/certificate` — see Open Questions §3) | public |
| Direct visit to `/verify/certificate` (no code) | Navigate to the bare path | The small landing page with a code input | public |
| Browser back / refresh | — | Re-renders the same result, no side effect | public |

## What this page does NOT do

- No login, no "sign in to verify", no "sign in to see more details" (the page is fully public)
- No email, no real name, no `user_id`, no IP address, no profile photo, no `profiles.bio`, no order history — none of the holder's PII beyond `display_name`
- No "this certificate is bound to [user]" with extra holder detail (the holder's `display_name` is the only identifier shown, and it is already public per `profiles` RLS)
- No QR-code generation / dynamic image rendering (the certificate PDF lives on the buyer's own account; this is verification, not re-download)
- No "share" button (sharing is the buyer's job, via the code or the PDF)
- No "issue a new certificate" CTA (issuance is automatic on course completion — see `account-certificates.md`)
- No payment / billing data (certificates are not commerce)
- No "report this certificate" form (v1; the link `support@uthena.com` is the abuse channel — see Open Questions §4)
- No sitemap.xml entry per code (we do not list every code; the page is reachable only when someone has the URL)

## Acceptance criteria

- [ ] Page is publicly accessible; no auth required, no "sign in" prompt
- [ ] A valid `active` certificate shows: "Verified" badge, product title (linked to `/products/[slug]`), partner name, issue date, holder `display_name`
- [ ] A valid `revoked` certificate shows: "Revoked on {date}" badge, the reason (if set), and the same product/partner fields (the holder's name is still shown — revocation is about the cert, not the holder)
- [ ] An unknown or mistyped code shows: "Not found" badge with the helpful follow-up sentence, NO product or partner info (the row does not exist — there is nothing to show)
- [ ] Rate limited: max 60 verification requests per IP per hour; exceeding returns HTTP 429 with a "Too many requests" page (or a soft client-side throttle, see Open Questions §2)
- [ ] Rate limit events are logged to `admin_audit_log` with `action='verify_certificate_rate_limited'` (no PII — hash the IP via the same daily-salt mechanism as `affiliate_clicks`)
- [ ] Suspicious sweep detection: > 30 distinct codes from a single IP in 10 minutes triggers a `verify_certificate_suspicious_sweep` log row and a soft block for 24h
- [ ] Only `display_name`, `issued_at`, product `title`/`slug`, partner `display_name`, and status fields are returned to the client — verified by a snapshot test against the API response shape
- [ ] The internal `id` (`bigint`) NEVER appears in the URL, in the response body, or in client-side state for this public page
- [ ] Page is ISR with a 5-minute revalidate (public, low write volume — refresh hourly via webhook on revoke events; see Performance)
- [ ] Schema.org `WebPage` + `EducationalCredential` JSON-LD is present on the verified state (good for SEO and verifiability)
- [ ] Open Graph tags: `og:title = "{holder} completed {product}"`, `og:description = "Verified by Uthena on {date}"`
- [ ] No `TODO` / `FIXME` / `HACK` in the diff

## Design reference

- Mockup: not yet built — to be created during the certificates feature build
- Components: `00-foundations/ui/StatusBadge.tsx` (verified/not-found/revoked variants), `00-foundations/ui/VerifiedCard.tsx`, `00-foundations/ui/NotFoundCard.tsx`
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (primary) + light (secondary)

## Security

- **Auth required:** NO — public route
- **Allowed roles:** anyone, including anonymous visitors
- **RLS policies that apply:** the query is run under the **service role** to bypass RLS for anonymous access. The result is filtered through a strict Zod allowlist before serialization. The 8-char base-32 code is the only handle; `id` is never returned.
- **PII displayed:** YES — the holder's `display_name` (a string the user chose; per `profiles` RLS, profiles are public-read for `display_name`, `avatar_url`, and `bio`). **No email, no real name, no `user_id`, no IP, no profile photo by default** (we could include `avatar_url` if the holder set one — flag in Open Questions §5).
- **PII in URLs:** NO. The `[code]` is a CSPRNG-generated 8-char base-32 string. It does not encode the holder's identity, the product, or the issue date. Brute-force is mitigated by rate limiting, not entropy.
- **Rate limiting:** 60 requests per IP per hour. The IP is hashed via the daily-salt mechanism from `affiliate_clicks` (no raw IP stored). A second tier sweeps: > 30 distinct codes from one IP in 10 minutes triggers a soft block + audit log.
- **Audit logged:**
  - **Every successful verify** — `admin_audit_log` row with `action='verify_certificate', target_table='certificates', target_id=<code>`. (Volume note: cert verifies are not high-traffic; if they become so, we sample at 10% in v2. Flag in Open Questions.)
  - **Every not-found** — sampled at 100% in v1 (the not-found signal is the brute-force detector). Logged with `action='verify_certificate_not_found'`.
  - **Rate-limit hits** — `action='verify_certificate_rate_limited'`.
  - **Sweeps** — `action='verify_certificate_suspicious_sweep'`.
- **Open redirect / SSRF protection:** N/A — no outbound requests, no user-controlled redirects.
- **CSRF:** no state-changing actions on this page.
- **No file access, no signed URLs, no streaming.** Pure metadata render.
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 150ms (single indexed lookup + a few small joins; ISR cache hit is < 50ms)
- **Render strategy:** RSC + ISR. The page is ISR with a 5-minute revalidate for the verified and revoked states. A revoke event triggers an on-demand revalidation of the affected codes (a webhook from the admin tool, or a DB trigger calling a Next.js revalidation route).
- **Cache:** the verified result is cached per code in the Next.js data cache (5min TTL). The not-found result is cached for 60s (so an attacker probing codes does not hammer the DB). Rate-limit counters live in Redis (or the equivalent `00-foundables/cache` helper) with a 1-hour TTL.
- **DB indexes used:** `certificates (certificate_code)` (via the unique constraint — O(log n) lookup), `products (id)` (PK), `profiles (user_id)` (PK).
- **Bundle size budget:** < 5KB added to client bundle (status badge, card). RSC ships HTML.
- **No images, no fonts, no third-party calls.** Static content with one read query.

## Out of scope for v1

- "Report this certificate" abuse form (v1: abuse reports go to support@uthena.com)
- Auto-redirect after verification (the page is a destination, not a step in a flow)
- Holder's avatar on the verified card (flag in Open Questions §5)
- Per-certificate social-share image / OG card (v2)
- Public list of all certificates (the page is per-code only; we do not expose a directory)
- Signed certificate PDF download from this page (the PDF is the buyer's, on `/account/certificates`; the verify page is verification, not re-download)
- Sample-verify landing page beyond the bare `/verify/certificate` text input (Open Questions §3)
- Anon visitor analytics (we use Plausible, page-view only; no per-visitor tracking here)

## Open questions for human

1. **`certificates` table — confirms the schema from `account-certificates.md` Open Q §1.** This spec assumes the table exists with: `id bigserial`, `user_id uuid`, `product_id bigint`, `issued_at timestamptz`, `certificate_code text unique` (8-char base-32), `pdf_storage_path text`, `status certificate_status` (`active` | `revoked`), `revoked_at timestamptz nullable`, `revoked_reason text nullable`, plus the `revoked_by` audit field. **My recommendation: approve the schema as proposed in `account-certificates.md` and the new `revoked_at` / `revoked_reason` columns are sufficient for this spec.** No new table is needed for verification — the same `certificates` table serves both the buyer's gallery and the public verify page.
2. **Rate limit numbers: 60/IP/hour feels right, but 30 distinct codes/10min as the sweep threshold is conservative.** A real employer doing a batch of background checks (HR verifying 30+ certificates) could trip it. My recommendation: 60/hour soft, 30 distinct codes/10min soft-block for 24h. Soft-block means "show a captcha, not 403" (v1: just slow down the response; v2: actual captcha). Confirm the soft-block approach.
3. **`/verify/certificate` landing page (no code in the URL).** When someone lands at the bare path or clicks "Verify another certificate", they need a way to type a code. My recommendation: a 1-field page (text input + "Verify" button) that POSTs/redirects to `/verify/certificate/[code]`. Should this be in the same spec, or follow-up? My recommendation: **same spec** — it's the same surface, just a different entry. Add an "in-this-spec" mini subsection before the AC list.
4. **Abuse-report form.** The brief doesn't include one. My recommendation: **defer to v2**. For v1, abuse reports come in via support@uthena.com and admin reviews via the existing `admin-refunds.md`-style audit-log interface. Confirm defer.
5. **Holder avatar on the verified card.** Showing the holder's `profiles.avatar_url` (if set) makes the verify page feel more "real" but adds a third-party fetch (Bunny CDN) to a previously-metadata-only page. My recommendation: **do not show the avatar in v1** — keep the page metadata-only. Add in v2 if the user feedback asks for it. Confirm.
6. **Per-certificate OG image.** "John completed the AI Personal Branding course — verified by Uthena" is a nice share target. My recommendation: **defer to v2** — generating a per-cert OG image is a v2 job (out of scope here). For v1 we use the static Uthena OG image.

---

## Implementation notes

- (filled by the building agent)
