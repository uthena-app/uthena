# Runbook: Deploy procedure

**When to use this runbook:** Deploying to staging or production. The CI mechanics live in `04-platform/ci/README.md` (workflows, Coolify scripts); this runbook is the human/agent procedure around them.

**Who's involved:** Platform agent (executes), human (approves prod deploys — GitHub Environment protection rule).

## Staging (automatic)

Every merge to `main` deploys to staging. No manual steps. The pipeline (`workflows/deploy-staging.yml`):

1. Build → deploy to staging via Coolify
2. Smoke tests run against the staging URL
3. Slack: "staging deploy complete" (or automatic rollback + alert if smoke tests fail)

If staging is broken, fix forward with a new PR or revert the merge. Don't deploy to prod while staging is red.

## Production (manual, gated)

### Before you deploy

1. `06-quality/checklists/pre-deploy.md` — completed, every box checked
2. For releases (v1.0, vX.0): `06-quality/checklists/security-audit.md` completed; Critical findings block the release
3. Staging is green: latest smoke tests passed, no open P0/P1
4. No pending migration that hasn't run on staging first (`04-platform/migrations/` — strictly sequential)
5. Check the calendar: no deploy during the payout batch window (02:00–03:00 UTC, see `payout-procedure.md`). Storage/CDN config changes go in the 02:00–04:00 UTC low-traffic window per `04-platform/storage/README.md` — these two constraints conflict; for combined changes use 03:00–04:00 UTC.

### Deploy

```bash
# 1. Tag the release
git tag v1.x.y && git push origin v1.x.y

# 2. Trigger the prod workflow
gh workflow run deploy-prod.yml --ref v1.x.y

# 3. Approve in GitHub (human) — Environment protection prompt
```

The pipeline deploys blue-green via Coolify (zero downtime), runs smoke tests, posts to Slack. Smoke-test failure = automatic rollback to the previous version.

### After the deploy

1. Watch Sentry + the Prometheus dashboards for 15 minutes (error rate, p95 latency, checkout completion)
2. Manual spot check: load the catalog, a product page, log in, open `/library`, generate one signed URL
3. If a migration shipped: verify with a read query against prod, confirm types were regenerated
4. Slack: confirm "prod deploy verified" in `#deploys`

## Rollback

- **App code:** `gh workflow run deploy-prod.yml --ref <previous-tag>` — blue-green makes this fast and safe.
- **Migrations:** never rolled back by re-running an old deploy. Apply the documented rollback migration (every migration ships with one — see `AGENTS.md` §"Done for a migration"). If the rollback migration doesn't exist, that's a process failure: write it, review it, apply it.
- **Storage/CDN config:** revert the config PR and re-apply via the platform agent (`04-platform/storage/README.md`).

If a deploy caused a P0, switch to `incident-response.md` — rollback is the first mitigation option there.

## What NOT to do

- Do NOT deploy to prod with a red or stale staging.
- Do NOT skip the pre-deploy checklist "because it's a small change." Small changes take small minutes to check.
- Do NOT deploy and walk away. The 15-minute watch window is part of the deploy.
- Do NOT batch an app deploy with a manual infra change. One change at a time; you want a clean rollback story.
- Do NOT force-push or hot-patch on the server. Every change goes through the pipeline.
