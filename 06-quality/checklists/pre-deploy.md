# Pre-deploy checklist

Run through this before every production deploy. The deploy cannot proceed if any item is unchecked.

## Pre-deploy (T-24h)

- [ ] All PRs in the milestone are merged
- [ ] No open PRs with `release-blocker` label
- [ ] Staging has been running the release branch for 24h+ with no incidents
- [ ] Database migrations have been applied to staging and verified
- [ ] All new env vars are set in prod (Doppler / Vault)
- [ ] All new secrets are rotated and in prod (signed URL keys, etc.)
- [ ] The on-call engineer is aware of the deploy window
- [ ] The human has approved the release

## Pre-deploy (T-1h)

- [ ] Smoke test on staging passes (see `06-quality/tests/e2e/smoke.spec.ts`)
- [ ] No active Sentry alerts in the last 1h
- [ ] No active Prometheus alerts in the last 1h
- [ ] Database backup completed successfully in the last 24h
- [ ] CDN cache is in a clean state (no stale configs from previous deploys)
- [ ] Email deliverability is green (Resend dashboard shows no spikes in bounce/complaint rate)
- [ ] PayPal sandbox is connected and working (test payout round-trip)
- [ ] Stripe is in live mode (not test) for the prod environment

## Deploy window

- [ ] Deploy starts in a low-traffic window (02:00–04:00 UTC by default)
- [ ] Deploy script is reviewed by a second engineer
- [ ] Rollback script is verified and ready
- [ ] Slack #deploys channel is open for real-time updates
- [ ] On-call engineer is at their desk (or paged immediately on any alert)

## Post-deploy (T+0h)

- [ ] All containers are healthy (Coolify dashboard)
- [ ] All health checks pass (`/api/health` returns 200)
- [ ] Smoke test on prod passes
- [ ] No new errors in Sentry in the 15m following deploy
- [ ] No latency regression in Prometheus (p95 within 10% of pre-deploy)
- [ ] First real checkout completes successfully (test with a $1 product)
- [ ] First real file download works (signed URL generates, download completes, audit log records)
- [ ] First real video stream works (4h TTL URL, IP-bound)
- [ ] Email sends work (test with a real signup)
- [ ] Webhook handlers respond (test with a Stripe test event via dashboard)

## Post-deploy (T+24h)

- [ ] No Sentry errors that didn't exist in the previous release
- [ ] No latency regression at p50, p95, p99
- [ ] No increase in support tickets
- [ ] No increase in refund requests
- [ ] No increase in webhook processing failures
- [ ] No PII in any log line (verify with log search)
- [ ] No secrets exposed (verify with gitleaks post-deploy scan)

## If anything goes wrong

1. **Rollback immediately.** Don't debug in prod. The rollback script is verified and ready.
2. **Notify the human.** Slack DM + email. The human decides if a rollback is the right move (usually yes).
3. **Open an incident.** Use the `05-ops/runbooks/incident-response.md` playbook.
4. **Write a postmortem.** Within 48h, using `06-quality/templates/incident-postmortem.md`.
5. **Add a follow-up.** The fix is a follow-up PR, not a hot-patch to the deploy.

## The "no surprises" rule

If you're about to deploy and you find yourself saying "I think it should work" — STOP. Verify on staging first. The cost of a 30-minute delay is small. The cost of a 30-minute prod outage is large.
