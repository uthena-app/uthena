# 04-platform/ci/

Continuous integration and deployment. GitHub Actions workflows, Coolify deploy scripts, security scanning, scheduled jobs, build configuration.

## Files

- **`workflows/ci.yml`** — runs on every PR: typecheck, lint, unit tests, integration tests, build
- **`workflows/deploy-staging.yml`** — runs on merge to `main`: deploy to staging, run smoke tests
- **`workflows/deploy-prod.yml`** — runs on tag: deploy to prod (manual approval required)
- **`workflows/security-scan.yml`** — weekly: dependency audit, secret scan, RLS verification
- **`workflows/nightly.yml`** — nightly: full e2e suite, performance benchmarks, backup verification
- **`scripts/deploy-coolify.sh`** — the actual deploy script that talks to Coolify's API
- **`scripts/send-email.ts`** — Resend wrapper used by server actions
- **`scripts/check-spec-coverage.sh`** — asserts every route in `03-app/` has a spec in `01-specs/pages/`. Makes "no code without a spec" mechanical instead of social. Runs in the CI security-scan job.
- **`scripts/cron/`** — scheduled jobs (payout batch, abandoned cart reminder, etc.)
- **`docker/Dockerfile`** — the production Dockerfile (multi-stage, slim)
- **`docker/docker-compose.yml`** — local dev environment (Supabase + Next.js + Bunny mock)

## The CI pipeline (every PR)

```yaml
# workflows/ci.yml (simplified)
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  unit-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: uthena_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    steps:
      - run: pnpm test:unit

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres: ...
    steps:
      - run: pnpm test:integration

  build:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm build

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm audit --prod
      - uses: github/codeql-action/analyze@v3
      - run: ./scripts/check-rls-coverage.sh
      - run: ./scripts/check-spec-coverage.sh
```

**Required to pass for merge:** typecheck, lint, all tests, build, security scan.

## The deploy pipeline

### Staging

- Triggered on merge to `main`
- Auto-deploys to staging via Coolify
- Runs smoke tests against the staging URL
- Posts a Slack message: "staging deploy complete"
- If smoke tests fail, rolls back automatically

### Production

- Triggered manually (via `gh workflow run deploy-prod.yml`)
- Requires the human's approval (GitHub Environment protection rule)
- Deploys via Coolify using blue-green (zero downtime)
- Runs smoke tests
- Posts a Slack message: "prod deploy complete"
- If smoke tests fail, automatic rollback to previous version

The full deploy procedure is in `05-ops/runbooks/deploy-procedure.md`.

## Scheduled jobs (cron)

`scripts/cron/` runs the things that need to happen on a schedule, not in response to user actions.

- **`daily-payout-batch.ts`** — runs at 02:00 UTC. Aggregates approved ledger entries older than 24h, submits a PayPal batch. (See `01-specs/pages/instructor-payouts.md`.)
- **`abandoned-cart-reminder.ts`** — runs hourly. Finds users with items in cart for > 24h, sends a reminder email (max 2 per cart).
- **`subscription-renewal-check.ts`** — (v2) checks for subscriptions up for renewal.
- **`expired-grant-cleanup.ts`** — runs weekly. Finds library grants that have expired (time-limited products, partner-terminated products), sends notification 7 days before expiry.
- **`email-deliverability-report.ts`** — runs weekly. Pulls Resend's deliverability stats, posts to Slack.
- **`cdn-log-ingest.ts`** — runs every 15 minutes. Pulls Bunny CDN access logs into `cdn_access_stats` for file-abuse detection. (See `04-platform/observability/README.md` §"CDN log ingestion". Alerts after 2 missed runs.)

Each cron job has a corresponding test (`scripts/cron/daily-payout-batch.test.ts`).

## Local dev environment

`docker/docker-compose.yml` spins up:
- Supabase (local Postgres, GoTrue, Storage, Studio)
- Next.js (the app)
- A mock Bunny server (returns canned signed URLs)
- MailHog (catches outbound emails for inspection)

```bash
# Start the dev environment
docker compose -f 04-platform/ci/docker/docker-compose.yml up

# Open the Supabase Studio
open http://localhost:54323

# Open MailHog (catches all outbound email)
open http://localhost:8025
```

This is what every agent uses for local development. It mirrors prod (Postgres 16, Node 20) but is hermetic (no internet calls).

## Security scanning

The security scan workflow (weekly + on every PR to `main`):

1. **`pnpm audit --prod`** — checks for known vulnerabilities in dependencies
2. **`gitleaks`** — scans the entire git history for accidentally committed secrets
3. **`@codeql/cli`** — static analysis for security issues (SQL injection, XSS, etc.)
4. **`scripts/check-rls-coverage.sh`** — runs every table in the DB, asserts that RLS is enabled and there's at least one policy. Fails the build if a table is found without RLS.
5. **Dependency license check** — fails if a dependency has a license we don't accept (GPL, AGPL)

If any of these fail, the PR is blocked. The on-call gets a Slack alert.

## The Dockerfile

Multi-stage build, ~150MB final image:

```dockerfile
# Stage 1: deps
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Stage 2: build
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Stage 3: runtime
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

The `output: 'standalone'` in `next.config.js` makes this possible. The image runs as a non-root user. No shell in the final image (uses `distroless` for the base).

## What does NOT go here

- Application code (that's in `02-features/`)
- Database migrations (that's in `04-platform/migrations/`)
- Secrets (those are in Doppler / Vault, never in this folder)
- Long-form documentation (that's in `docs/` or `05-ops/`)
- Marketing site content (the marketing site is a separate Next.js project)

If you're writing TypeScript that runs in the application, you're in the wrong folder. If you're writing TypeScript that runs as a scheduled job, a deploy script, or a one-off tool, you're in the right folder.
