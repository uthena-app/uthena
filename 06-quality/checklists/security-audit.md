# Security audit checklist

Run this audit before every major release (v1.0, v2.0, etc.) and quarterly. The audit is a thorough review of the security posture of the app. Every unchecked item is a finding that needs a remediation plan.

## Authentication

- [ ] Passwords are stored using Argon2id (not bcrypt, not MD5, not SHA-1)
- [ ] Password requirements are documented and enforced (min 12 chars, no max, breached-password check)
- [ ] Email verification is required before the user can purchase (not for browsing)
- [ ] Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`
- [ ] Session tokens are rotated on privilege change (e.g. after email verification)
- [ ] Session timeout is set (30 days max for active sessions, 7 days idle)
- [ ] Logout invalidates the session server-side (not just clearing the cookie)
- [ ] "Remember me" is a separate, explicit opt-in
- [ ] Magic link / passwordless login is rate-limited (5/hour per email)
- [ ] Failed login attempts are rate-limited (10/hour per email, 50/hour per IP)
- [ ] Account lockout after 10 failed attempts, unlockable via password reset

## Authorization (RLS)

- [ ] Every table in the DB has RLS enabled (`check-rls-coverage.sh` confirms)
- [ ] Every table has at least one RLS policy
- [ ] RLS policies are tested for both authorized AND unauthorized access
- [ ] Service role key is only used in server contexts (never sent to the client)
- [ ] Anon role cannot read any user data (verify with a test query as anon)
- [ ] Authenticated role can only read its own data (verify with a cross-user test)
- [ ] Admin role exists and is checked in the application layer, not just the DB
- [ ] No SQL queries bypass RLS by using the service role unnecessarily

## Data protection

- [ ] All PII fields are documented in `01-specs/pages/_data-model.md` (with the `pii: true` tag)
- [ ] PII is encrypted at rest where required (tax IDs, payout emails)
- [ ] PII is masked in logs (no email addresses, no names, no IPs in plain text)
- [ ] PII is masked in error reports sent to Sentry
- [ ] PII is purged after the retention period (account deletion cascade, GDPR)
- [ ] No PII in URLs (use UUIDs, not slugs based on names)
- [ ] No PII in cookies (session token only, no user info encoded)
- [ ] Backups do not contain unencrypted PII (verify by restoring a backup to a test DB and scanning)

## API security

- [ ] All server actions validate input with Zod before touching the DB
- [ ] All API routes have an explicit auth check (or are explicitly public)
- [ ] All API routes are rate-limited (Upstash Redis)
- [ ] CORS is configured correctly (only the app's own origin)
- [ ] CSRF protection is in place for state-changing operations
- [ ] File upload endpoints validate the MIME type AND the file extension
- [ ] File upload endpoints validate the file size
- [ ] File upload endpoints use signed upload URLs (the client never gets the bucket credentials)
- [ ] File download endpoints validate the user's library grant (not just the user_id)
- [ ] No IDOR vulnerabilities (test by changing user_id in requests)

## Webhooks

- [ ] All webhook endpoints verify the source's signature
- [ ] All webhook handlers are idempotent (safe to receive duplicates)
- [ ] Webhook secrets are stored in env vars (not in code)
- [ ] Webhook endpoints do not echo the request body in the response
- [ ] Webhook endpoints do not include sensitive data in error messages

## File / content security

- [ ] All file access goes through signed URLs (no direct bucket URLs)
- [ ] Stream URLs are IP-bound AND user-bound (4h TTL)
- [ ] Download URLs are signed with 24h TTL
- [ ] Download URLs permit HTTP Range requests (verify a kill-and-resume of a 1GB+ file in staging)
- [ ] No signed file URLs in any email template (emails link to auth-gated pages only — see `04-platform/emails/README.md`)
- [ ] Signed URL generation is rate-limited (60/hour per user, 500/hour per IP)
- [ ] Every signed URL generation is logged to `file_downloads` (IP/IP-hash columns nulled after 90 days)
- [ ] Bunny CDN access logs are ingested and abuse flags fire (test with a synthetic >10-distinct-IP access — see `04-platform/observability/README.md`)
- [ ] Emergency signing-key rotation procedure has been rehearsed (`05-ops/runbooks/security-incident.md`)
- [ ] Uploaded files are scanned for malware in v1, blocking publication (ClamAV via `00-foundations/files/scan.ts`; ZIPs scanned recursively; quarantine on detection; `scan_status='clean'` required to publish)
- [ ] Uploaded videos are transcoded to HLS (no MP4-only delivery)
- [ ] No file types outside the allow-list are accepted (verify by trying to upload an .exe)

## Payment security

- [ ] We are PCI-DSS SAQ-A eligible (we never see card numbers)
- [ ] Stripe Elements is the only payment form (no custom card form)
- [ ] Stripe webhooks verify the signature on every event
- [ ] Stripe API calls use idempotency keys
- [ ] Stripe customer portal is the only way to manage payment methods
- [ ] Refunds go through the Stripe API (no manual DB updates to orders)
- [ ] PayPal webhooks verify the signature on every event
- [ ] PayPal batch submissions use `senderItemId` for idempotency
- [ ] No payment amounts are computed in the client (server is the source of truth)

## Secrets

- [ ] No secrets in the repo (gitleaks passes on full history)
- [ ] `.env.example` has placeholders, not real values
- [ ] All secrets are in Doppler / Vault / SSM
- [ ] Secrets are rotated quarterly (signed URL keys, JWT secrets, API keys)
- [ ] Each environment has its own secrets (dev, staging, prod are isolated)
- [ ] Secret access is logged (who accessed what, when)

## Infrastructure

- [ ] HTTPS only (HSTS enabled, no HTTP fallback) — `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- [ ] All subdomains are HTTPS (no mixed content)
- [ ] DNS has CAA records restricting certificate issuance
- [ ] CSP is configured (Content-Security-Policy header) — see `01-specs/pages/security-headers.md` + `00-foundations/security/headers.ts` + `pnpm check:security-headers`
- [ ] X-Frame-Options is configured (clickjacking protection) — verified via `pnpm check:security-headers` (every HTML page, image, XML, text, JSON response)
- [ ] X-Content-Type-Options is `nosniff` (universal — every response, enforced by `pnpm check:security-headers`)
- [ ] Referrer-Policy is set — `strict-origin-when-cross-origin` on every response
- [ ] Permissions-Policy restricts unused browser features — `camera=(), microphone=(), geolocation=(), interest-cohort=()`
- [ ] CORS is restrictive (no wildcard `*` in production)
- [ ] Rate limiting is in place at the edge (Cloudflare or similar)
- [ ] DDoS protection is in place (Cloudflare or similar)
- [ ] Database is not publicly accessible (private network only)
- [ ] Object storage is not publicly accessible (signed URLs only)
- [ ] Bunny account hardening checklist completed (`04-platform/storage/README.md` §"Bunny account hardening")

## Dependencies

- [ ] `pnpm audit --prod` shows no high or critical vulnerabilities
- [ ] All dependencies are pinned to exact versions (no `^` or `~` in package.json)
- [ ] Dependency licenses are acceptable (no GPL, no AGPL)
- [ ] Dependencies are reviewed for suspicious behavior (typosquatting check)
- [ ] Lockfile is committed and used in CI (`pnpm install --frozen-lockfile`)

## Monitoring / incident response

- [ ] Sentry is configured and capturing errors
- [ ] Prometheus is configured and scraping metrics
- [ ] Alerts are configured for: error rate spike, latency spike, auth failures, payment failures
- [ ] On-call rotation is documented in `05-ops/runbooks/incident-response.md`
- [ ] Incident postmortem template exists (`06-quality/templates/incident-postmortem.md`)
- [ ] Security incident runbook exists (`05-ops/runbooks/security-incident.md`)

## Compliance

- [ ] GDPR data subject access request (DSAR) flow is implemented
- [ ] GDPR right to erasure flow is implemented
- [ ] Cookie consent is in place (we use Plausible, cookieless, so this is minimal)
- [ ] Privacy policy is linked from the footer
- [ ] Terms of service are linked from the footer
- [ ] License terms are explicit (PLR license is documented and acknowledged at purchase)
- [ ] Data retention policy is documented
- [ ] DPA (Data Processing Agreement) is in place with Bunny, Stripe, PayPal, Resend

## When the audit finds something

1. **Document the finding** in the audit report. Severity: Critical / High / Medium / Low.
2. **Critical findings block release.** No exceptions.
3. **High findings** must have a remediation plan before release (with a date).
4. **Medium / Low findings** are tracked in `_followups.md` and addressed in subsequent sprints.

The audit is only as good as the action it produces. Findings that don't get fixed are worse than no audit at all.
