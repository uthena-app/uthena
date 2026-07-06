# Runbook: Secret rotation

**When to use this runbook:** When rotating any secret used by the app — signing keys, JWT secrets, API keys, database passwords. The full procedure is below for each type.

**When to rotate:** Every 90 days for active keys, immediately for any suspected compromise, immediately for any secret that appeared in a log or error report.

**Who's involved:** Platform agent (executes), human (approves), security contact (for compromised secrets)

## The general procedure

1. **Generate the new secret** in the source system (Doppler / Vault / Bunny dashboard)
2. **Add the new secret alongside the old one** (dual-secret window)
3. **Deploy the new secret** via the standard deploy pipeline
4. **Verify both old and new work** during the dual-secret window (typically 7 days)
5. **Remove the old secret** from the source system
6. **Update the secret inventory** (`04-platform/storage/keys.md` or equivalent)
7. **Record the rotation** in the audit log (date, who, why)

For compromised secrets, the procedure is more aggressive (no dual-secret window, immediate rotation, postmortem).

## The secret inventory

We track every secret in the system. The inventory lives in `04-platform/storage/keys.md` (signed URL keys) and a similar file in Doppler for everything else. Each secret has:

- **Name** — what it's called in the code
- **Purpose** — what it does
- **Source** — Doppler / Vault / Bunny / Stripe / PayPal / Resend
- **Created** — date
- **Last rotated** — date
- **Next rotation** — date (90 days from last)
- **Owner** — the agent or human responsible
- **Compromised?** — yes / no / suspected

## The secrets we manage

### 1. Signed URL keys (Bunny)

Used in `00-foundations/files/signed-url.ts` to sign stream and download URLs. Rotation: every 90 days.

```bash
# 1. Generate new key in Bunny Dashboard → Stream → Security → Token Authentication
#    Save the new key in Doppler as BUNNY_SIGNING_KEY_V2

# 2. Add the new key to Bunny's signing config (dual-sign for 7 days)
#    Bunny supports up to 2 active keys per zone

# 3. Update the code
#    In 00-foundations/files/signed-url.ts:
#      const ACTIVE_KEY = process.env.BUNNY_SIGNING_KEY_V2;
#      const LEGACY_KEY = process.env.BUNNY_SIGNING_KEY_V1;  // still verified
#    Verify in BOTH, sign with the new one

# 4. Deploy

# 5. After 7 days, remove BUNNY_SIGNING_KEY_V1 from Doppler
#    Remove the old key from Bunny's signing config

# 6. Update 04-platform/storage/keys.md
```

**Why dual-sign for 7 days:** A signed URL has a 4h TTL for streams and 24h TTL for downloads. Any URL signed in the last 4h must continue to work. 7 days gives us a comfortable margin.

### 2. JWT secret (Supabase)

Used by Supabase to sign session tokens. Rotation: every 90 days, OR immediately on suspected compromise.

```bash
# 1. Generate new secret in Supabase Dashboard → Settings → API → JWT Secret
#    Save in Doppler as SUPABASE_JWT_SECRET_V2

# 2. Add the new secret to Supabase (Supabase supports dual-secret natively)
#    Set "JWT Secret" to the new value
#    Set "Legacy JWT Secret" to the old value

# 3. Update the env var in Doppler

# 4. Deploy (Next.js will use the new secret for new sessions, still verify old)

# 5. After 7 days, all sessions will be using the new secret
#    Remove the legacy secret from Supabase

# 6. Update the inventory
```

**Note:** Supabase's "Legacy JWT Secret" is the supported way to do this. Do NOT just change the secret — that would invalidate all active sessions.

### 3. Stripe API key

Used in `00-foundations/money/stripe.ts` for server-side API calls. Rotation: every 90 days.

```bash
# 1. Create a new restricted key in Stripe Dashboard → Developers → API keys
#    Use the same permissions as the old key

# 2. Save in Doppler as STRIPE_SECRET_KEY_V2
#    (Keep STRIPE_SECRET_KEY_V1 in place)

# 3. Update the env var in Doppler

# 4. Deploy (we use the new key for all new API calls)

# 5. Verify a test transaction in staging

# 6. After 24h, revoke the old key in Stripe Dashboard
#    (We use the old key for nothing; revoking is safe)

# 7. Remove from Doppler
# 8. Update the inventory
```

### 4. PayPal client secret

Used in `00-foundations/money/paypal.ts` for the Payouts API. Rotation: every 90 days.

Same procedure as Stripe. PayPal supports up to 2 active client secrets per app.

### 5. Resend API key

Used in `04-platform/ci/scripts/send-email.ts`. Rotation: every 90 days.

Resend supports multiple API keys per account. Create a new one, deploy, revoke the old.

### 6. Database password

Used in the connection string for Supabase. Rotation: every 180 days (less frequent because rotation is more disruptive).

```bash
# 1. Change the password in Supabase Dashboard → Settings → Database
#    Save new password in Doppler as SUPABASE_DB_PASSWORD_V2

# 2. Update the env var in Doppler
#    The old password still works (Supabase supports dual-password)

# 3. Deploy

# 4. Verify connection from the app

# 5. After 7 days, remove the old password from Supabase

# 6. Remove from Doppler
# 7. Update the inventory
```

### 7. Sentry DSN

Used in `04-platform/observability/sentry.ts`. Rotation: when an agent leaves the team, or every 365 days (low-risk).

Sentry supports multiple DSNs per project. Create a new one, deploy, revoke the old.

## Compromised secret — accelerated procedure

If a secret is suspected to be compromised (appeared in a log, a public screenshot, a leak):

1. **Contain first.** Rotate the secret IMMEDIATELY. Skip the dual-secret window.
2. **Notify the human** in Slack DM. If P0, page.
3. **Investigate** the source of the leak:
   - Was it a log line? Find the code, fix the logger, open a PR.
   - Was it a screenshot? Check the screenshot capture flow.
   - Was it a public repo? Rotate the key NOW, check git history for further exposure, add to gitleaks.
4. **Assess the damage:**
   - For signed URL keys: check `file_downloads` for unusual patterns in the window
   - For JWT secrets: check session table for unusual IP changes
   - For API keys: check the provider's audit log
5. **Write a postmortem** using `06-quality/templates/incident-postmortem.md`. This is a P0 incident.
6. **Add preventive measures** as follow-ups. E.g. if the leak came from a log line, add a check to `check-no-pii.sh` in CI.

## What NOT to do

- Do NOT rotate a secret without a deploy in between. The new secret must be active before the old one is removed.
- Do NOT commit secrets to git, even temporarily. Use Doppler / Vault.
- Do NOT use the same secret in dev and prod.
- Do NOT skip the rotation schedule. If a rotation is overdue, the on-call is paged.

## The rotation calendar

| Secret | Rotation interval | Last rotation | Next rotation |
|---|---|---|---|
| Bunny signing key | 90d | [date] | [date+90d] |
| Supabase JWT secret | 90d | [date] | [date+90d] |
| Stripe API key | 90d | [date] | [date+90d] |
| PayPal client secret | 90d | [date] | [date+90d] |
| Resend API key | 90d | [date] | [date+90d] |
| Database password | 180d | [date] | [date+180d] |
| Sentry DSN | 365d | [date] | [date+365d] |

The calendar is checked weekly. A cron job posts a Slack message 7 days before any rotation is due.
