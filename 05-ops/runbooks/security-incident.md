# Runbook: Security incident

**When to use this runbook:** A breach is suspected or confirmed — leaked secret, leaked signed URL(s), unauthorized data access, account takeover, malicious upload distributed to customers. Severity is P0 by default (see `incident-response.md` for severities and the comms cadence).

**Who's involved:** On-call engineer (incident commander), platform agent, human (always — security incidents are never agent-only), legal contact (if PII or licensed content is involved).

**The one rule that differs from normal incidents: contain FIRST, assess second.** For an outage, you assess before acting. For a breach, every minute of assessment is a minute of continued exposure. Cut the access, then investigate.

## The 4-step response

### 1. Contain (immediately)

Pick the play that matches the incident (plays below). All of them follow the same logic: revoke the credential or access path that's leaking. Do NOT wait for root cause.

### 2. Notify (within 5 minutes)

- Slack DM + page the human. Security incidents always involve the human.
- Open `#inc-YYYY-MM-DD-security-[short-name]`. Mark it private if the incident involves PII or an active attacker.
- If PII is confirmed exposed: loop in the legal contact (GDPR breach-notification clock — 72 hours to authority notification — starts at confirmation; see `05-ops/compliance/gdpr.md`).

### 3. Assess (after containment)

- **Scope:** which users, which files, which data, what time window?
- **Evidence:** `file_downloads` (URL generation), `cdn_access_stats` (URL access — see `04-platform/observability/README.md`), `admin_audit_log`, Supabase auth logs, provider audit logs (Stripe, Bunny, PayPal).
- **Preserve evidence before it rotates:** export the relevant log windows to the incident channel. CDN aggregates and IP hashes age out (90-day null policy).

### 4. Resolve and postmortem

- Root-cause fix as a follow-up PR (not a hot patch).
- Postmortem within 48h using `06-quality/templates/incident-postmortem.md`. Mandatory for every security incident, even false alarms.
- File preventive follow-ups in `01-specs/pages/_followups.md`.

## The plays

### Play A: Signed URL(s) leaked publicly (forum post, scraper, mass sharing)

Symptoms: abuse flag fires (URL accessed from >10 distinct IPs / >10 times per hour), or a leak is reported.

1. **One user's URLs:** revoke the user's `library_grant`(s) (blocks all NEW URL generation immediately) and suspend the account pending review. Existing URLs die at TTL (≤ 24h) — for a single user this residual window is the documented accepted risk (`00-foundations/files/README.md`).
2. **Mass leak, or residual access is unacceptable** (many URLs circulating, legal demand, pre-release content): **rotate the Bunny signing key with NO dual-sign window.** This instantly invalidates every live signed URL platform-wide. Procedure: `secret-rotation.md` §1, but skip step 2 (no dual-key overlap) — remove the old key from the Bunny zone config at the same time the new one is added.
   - **Side effect (accept it):** every legitimate in-flight stream and download breaks. Users regenerate URLs by reloading `/library` — no data is lost. Post a banner ("we refreshed download security, please regenerate your links") if the volume warrants.
3. Purge the Bunny CDN edge cache for the affected files (`04-platform/storage/lifecycle.ts` → `purgeCdnCacheForProduct`).
4. Assess from `file_downloads` + `cdn_access_stats`: which files, how many distinct IPs, which generation events map to which user.

### Play B: Secret compromised (API key, signing key, JWT secret, DB password)

Follow the accelerated procedure in `secret-rotation.md` §"Compromised secret" — immediate rotation, no dual-secret window, then damage assessment per secret type.

### Play C: Account takeover / suspicious admin access

1. Invalidate the account's sessions (Supabase Auth admin: sign out all sessions) and force a password reset.
2. If an ADMIN account: also rotate the Supabase JWT secret (kills all sessions platform-wide — disruptive but correct) and review `admin_audit_log` for every action taken by that account in the window.
3. Check for persistence: new API keys created, payout email changed, webhook endpoints added.

### Play D: Malicious file distributed to customers

A file cleared review but is later found malicious (missed by scan, or scan was bypassed).

1. Take the product down (`lifecycle.ts` → `takedownProduct`: stream deleted, CDN purged; origin retained as evidence).
2. Quarantine the file: set `scan_status='infected'` so it can never be re-attached or served.
3. Identify every customer who downloaded it (`file_downloads` by file_id) and email them: what happened, what to do. This email obviously links to no files.
4. Review the partner's other uploads; suspend the partner pending investigation.
5. Postmortem must answer: why did the scan miss it? (`00-foundations/files/scan.ts` definitions update, nesting depth, timeout?)

## What NOT to do

- Do NOT assess before containing. Cut access first.
- Do NOT handle a security incident without the human. Ever.
- Do NOT delete evidence (logs, the infected file in origin, the leaked URL post). Preserve, then act.
- Do NOT communicate externally (users, public) without the human's sign-off — wording has legal consequences.
- Do NOT use the dual-sign rotation window for a compromised signing key. Dual-sign is for routine rotation; compromise means the old key dies NOW.

## Rehearsal

Once per quarter (with the routine key rotation), rehearse Play A step 2 in **staging**: rotate the staging signing key with no overlap, confirm old URLs 403 and new URLs work. The quarterly security audit (`06-quality/checklists/security-audit.md`) has a checkbox for this.
