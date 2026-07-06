# Runbook: Incident response

**When to use this runbook:** When the site is down, a key feature is broken, or there's a security incident in progress. Severity P0 (down) or P1 (degraded).

**Severity:**
- **P0** — site is down, payments failing, data loss in progress, security breach in progress
- **P1** — key feature broken (checkout, library, partner upload), all users affected
- **P2** — single user affected, or non-critical feature broken
- **P3** — cosmetic, edge case, single partner or affiliate affected

**Who's involved:** On-call engineer, platform agent, human (for P0/P1), legal (for security incidents)

## The 5-step response

### 1. Acknowledge (within 5 minutes)

- The on-call engineer acknowledges the page in PagerDuty
- Open an incident channel: `#inc-YYYY-MM-DD-short-name` in Slack
- Post in the channel: "I am [name], I am the incident commander. Incident: [short description]. Severity: [P0/P1/P2/P3]."

### 2. Assess (within 15 minutes)

Answer these questions in the channel:
- What is the user-visible impact? (e.g. "checkout fails for all users, error 500")
- When did it start? (Check Sentry's first-occurrence timestamp, Prometheus alert time)
- What changed recently? (Check recent deploys in `#deploys`, recent migrations in git log)
- Is the data at risk? (e.g. payments in flight, PII being logged)

### 3. Mitigate (within 30 minutes for P0)

The goal is to stop the bleeding, not to find the root cause. Options:

- **Roll back** the most recent deploy if the incident started after a deploy
- **Disable a feature** if it's the source of the incident (feature flag)
- **Scale up** if it's a load issue (add Coolify workers)
- **Failover** to backup if it's an infrastructure issue (DB, storage, CDN)
- **Manual workaround** if none of the above apply (e.g. process orders by hand for an hour)

The mitigation is communicated in the incident channel and to the human in Slack DM.

### 4. Communicate

- **P0:** Notify the human within 5 minutes of acknowledging. Post in `#general` within 15 minutes. Update every 30 minutes.
- **P1:** Notify the human within 30 minutes. Post in `#general` within 1 hour. Update every 2 hours.
- **P2:** Post in `#incidents` (not `#general`). Update every 4 hours.
- **P3:** No comms needed beyond resolution.

User-facing status: update status.uthena.com (or whatever the status page is) within the timeframes above.

### 5. Resolve and postmortem

Once mitigated, work on the root cause fix. The fix is a follow-up PR, not a hot-patch to the deploy. Roll forward when the fix is verified.

Within 48 hours of resolution, write a postmortem using `06-quality/templates/incident-postmortem.md`. The postmortem is reviewed by the human and any other stakeholders.

## Common incidents and their fixes

### Site is down (P0)

1. Check Coolify dashboard — is the app running?
2. Check Sentry — is there an unhandled exception bringing down the server?
3. Check Prometheus — is the DB connection pool exhausted? Is memory maxed?
4. If recent deploy, roll back: `gh workflow run deploy-prod.yml --ref <previous-tag>`
5. If DB issue, check the slow query log, identify the long query, kill it
6. If everything is broken, failover to the backup environment (see `04-platform/storage/backup.md`)

### Checkout is failing (P0)

1. Check Stripe dashboard — is there an API incident?
2. Check our Stripe webhook handler — is the signature verification failing? Is the event ID being deduplicated?
3. Check the `processed_webhooks` table — is the unique constraint blocking legit events?
4. Manually process the failed orders once the root cause is fixed

### Library access is broken (P0)

1. Check the `library_grants` table — is the grant being created?
2. Check the signed URL generation — is the signing key valid? Has it expired?
3. Check Bunny's status page — is the CDN down?
4. As a workaround, regenerate the URL with the old key (if it's been recently rotated)

### Security incident (P0)

See `security-incident.md`. The first 3 steps are different: contain the breach FIRST.

## Escalation

- **P0:** Page the human immediately. If the human is unreachable for 15 minutes, page the legal contact.
- **P1:** Slack DM the human. They may or may not be involved.
- **P2/P3:** Include the human in the postmortem only.

## What NOT to do

- Do NOT debug in prod without a clear mitigation plan. The fix is a follow-up PR.
- Do NOT skip the postmortem. P0/P1 incidents always get a postmortem.
- Do NOT assign blame in the incident channel. Blame-free postmortems only.
- Do NOT make the incident worse by taking risky actions (e.g. running a destructive migration while users are active).

## After the incident

1. Write the postmortem (within 48h)
2. Add follow-up tasks to `01-specs/pages/_followups.md` for every "could be improved" item
3. Update this runbook if the procedure was wrong
4. Brief the team in the next sprint planning

The goal of incident response is not to prevent all incidents (impossible). It's to minimize the impact of incidents and learn from them.
