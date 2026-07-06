# GDPR compliance

**Owner:** Human (legal accountability), platform agent (technical implementation)
**Reviewed:** Quarterly
**Last updated:** 2026-06-15

This document covers our GDPR compliance posture. It describes what data we collect, how we use it, how long we keep it, and how we respond to data subject requests.

## The data we collect

The full schema is in `01-specs/pages/_data-model.md`. The PII fields are tagged `pii: true`. Summary by category:

| Category | Examples | Where stored | Retention |
|---|---|---|---|
| Account | email, display name, password hash | `profiles` | Until account deletion + 30 days |
| Payment | Stripe customer ID, last 4 of card | Stripe (we don't store) | Stripe's policy |
| Order history | what was bought, when, for how much | `orders` | 7 years (tax/audit) |
| Payout info | PayPal email, tax ID (encrypted) | `partners`, `affiliates` | Until account deletion + 7 years (tax) |
| Activity logs | IP address (hashed), user agent, page views | `file_downloads`, `audit_log` | 1 year |
| Email engagement | delivered, opened, clicked | Resend | 90 days |
| Support tickets | whatever the user sends | Front or HelpScout (separate) | 3 years |

We do NOT collect:
- Browsing history on other sites
- Location data beyond the billing country (no GPS, no IP geolocation in the UI)
- Biometric data
- Health, ethnicity, political opinions, etc. (the "special categories" in GDPR Art. 9)

## The legal basis

We process user data under **contract** (Art. 6(1)(b)) — the user has a contract with us (the purchase, the partner agreement, the affiliate agreement) and we process their data to fulfill it. For marketing emails, we use **consent** (Art. 6(1)(a)) — the user opts in.

We do NOT process data under "legitimate interest" (Art. 6(1)(f)) for any user-facing activity. If we add a feature that needs legitimate interest, we'll update this doc and notify the human.

## Data subject rights

GDPR grants users 8 rights. Here's how we honor each:

### 1. Right of access (Art. 15)

The user can request a copy of all their data. We provide a JSON export from `/account/export`.

**Response time:** Within 30 days. We aim for 7 days in practice.

**Implementation:** A server action (`02-features/account/actions/exportUserData.ts`) that:
1. Collects all rows from all tables where `user_id = auth.uid()`
2. Bundles into a JSON file
3. Uploads to a private Bunny Storage path with a signed download URL
4. Emails the user the link (valid for 7 days)
5. Logs the request in `admin_audit_log`

### 2. Right to rectification (Art. 16)

The user can update most fields from `/account/settings`. For fields that can't be self-updated (e.g. email), the user requests a change and we process it manually.

### 3. Right to erasure (Art. 17)

The user can request account deletion from `/account/settings/danger`. We:
1. Disable the account (status = `deactivated`)
2. After 30 days, run a hard delete job that:
   - Anonymizes the user record (email → `deleted-{uuid}@deleted.uthena.com`)
   - Anonymizes all PII in `orders`, `reviews`, `support_tickets`
   - Retains financial records (anonymized) for 7 years (tax/audit)
   - Deletes all `file_downloads` rows
   - Deletes all sessions
3. Logs the deletion in `admin_audit_log` (but not the deleted data itself)

**Why the 30-day grace period:** Gives the user a chance to undo (e.g. "wait, I changed my mind").

**Why we retain anonymized financial records for 7 years:** Tax law requires it. Anonymized data is not "personal data" under GDPR (it can't be linked back to the user), so this is allowed.

### 4. Right to restriction of processing (Art. 18)

The user can request that we stop processing their data while keeping it. We honor this by setting a `processing_restricted` flag on the profile. All server actions check this flag and skip the user.

In practice this is rare. Users usually want either full access or full deletion.

### 5. Right to data portability (Art. 20)

Same as the right of access. We provide a JSON export. We do NOT provide the data in a "structured, commonly used, machine-readable format" beyond JSON (no XML, no CSV) — JSON is sufficient under GDPR.

### 6. Right to object (Art. 21)

The user can object to processing under legitimate interest. We don't use legitimate interest for any user-facing activity, so this is a no-op for now.

The user CAN object to marketing emails at any time (unsubscribe link in every email). This is honored within 24 hours.

### 7. Right to not be subject to automated decision-making (Art. 22)

We do NOT use automated decision-making that produces legal effects (e.g. no AI-based fraud scoring that auto-blocks a user). All account actions are reviewed by a human if they cross a threshold.

The Trust Score (in v2) is informational, not blocking. It informs recommendations; it does not restrict access.

### 8. Right to withdraw consent (Art. 7(3))

If we have consent for something (e.g. marketing emails), the user can withdraw it. Honored within 24 hours.

## International transfers

We use:
- **Hetzner** (Germany) for hosting
- **Supabase** (US/EU; we use the EU region for the DB)
- **Bunny.net** (EU + global CDN)
- **Stripe** (US)
- **PayPal** (US)
- **Resend** (US)

For US-based vendors, we rely on:
- **Standard Contractual Clauses (SCCs)** — signed with each vendor
- **Data Processing Agreements (DPAs)** — in place with each vendor

For users in the EEA, we don't transfer PII to the US without these safeguards. The user is informed in the privacy policy.

## Breach notification

If we have a personal data breach (Art. 33):
- **Notify the supervisory authority within 72 hours** of becoming aware
- **Notify affected users** "without undue delay" if the breach is likely to result in a high risk to their rights
- **Document the breach** in `security_incidents` (not the user-facing data, just the metadata)

The notification is sent by the human (or whoever the human designates). The platform agent prepares the technical details.

## Cookie usage

We use **Plausible** (cookieless analytics). No cookies are set on the user's browser for analytics.

For authentication, we set a single session cookie (HttpOnly, Secure, SameSite=Lax). This is a "strictly necessary" cookie under GDPR and does not require consent.

For Stripe, the payment form is hosted on Stripe's domain; Stripe's cookies are governed by Stripe's privacy policy.

We do NOT use any other cookies. No third-party trackers. No advertising cookies. No Facebook pixel. No Google Analytics.

## Data Protection Impact Assessment (DPIA)

We have conducted a DPIA for the highest-risk processing activities:
- Library access (signed URLs, IP binding, watermarks planned for v2)
- Payout processing (PII, financial data)
- File storage (5TB+ of licensed content)

The DPIA is in `01-specs/decisions/`. It identified the key risks and the mitigations. Reviewed annually.

## Children's data

We do not knowingly collect data from children under 16. The signup form includes a date-of-birth field, and accounts where the user is under 16 are rejected at signup.

## The Data Protection Officer (DPO)

For our size, we are not required to appoint a DPO. The human acts as the data protection lead. If the human is unavailable, the platform agent escalates to the human's backup contact (listed in the incident response runbook).

## What to do when a user makes a request

1. **Verify the identity** of the requester. Match email or other account details.
2. **Acknowledge within 3 business days.** Even if the full response will take 30 days.
3. **Process the request.** Use the server actions in `02-features/account/`.
4. **Log the request** in `admin_audit_log` (type, user_id, what was done).
5. **Respond within 30 days.** With a JSON download link (for access) or a confirmation (for deletion).
6. **Notify the human** in Slack DM if the request is unusual (e.g. a government request, a large-scale data request, a request from a journalist).

If the request is a "right to be forgotten" and the user is a partner with active payouts, coordinate with the human before processing — we may need to settle outstanding balances first.
