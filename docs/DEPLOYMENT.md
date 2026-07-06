# Deployment runbook — Coolify + Supabase

> Production runs on **Coolify** per ADR-0003; the container is
> `infra/Dockerfile` (multi-stage, Next.js standalone output, non-root,
> healthcheck on `/api/health`). This runbook takes the repo from
> GitHub to a running development URL, then to production.

```
GitHub (uthena-app/uthena)
        │  push → auto deploy
        ▼
Coolify on your server ── builds infra/Dockerfile ── serves :3000
        │                                              │
        │                                    https://dev.<domain>
        ▼
Supabase (DB + auth + storage)    Stripe · Bunny · SES · PostHog · Gorse · Sentry
                                  (all env-gated seams — app runs without keys)
```

## 1. Server

- **OS:** Ubuntu 22.04 / 24.04 LTS (or Debian 12), fresh install.
- **Size:** ≥2 vCPU / **4 GB RAM** recommended / 40 GB disk.
  (Add ~2 GB RAM if you later self-host Supabase on the same box.)
- Root SSH access; open ports `22`, `80`, `443`, `8000` (Coolify
  dashboard — lock down once it has its own domain).

## 2. Install Coolify

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

Open `http://<server-ip>:8000` **immediately** and create the admin
account (first visitor becomes admin). Then give the dashboard its own
subdomain + HTTPS in *Settings → Instance*.

## 3. Create the app

1. **Sources → Add → GitHub App**, install on the `uthena-app` org with
   access to `uthena` (private repos supported).
2. **Projects → New** ("Uthena") → environment `development` →
   **Add Resource → Private Repository (GitHub App)** → repo
   `uthena-app/uthena`, branch `main`.
3. **Build pack: Dockerfile**, Dockerfile location `infra/Dockerfile`,
   build context `/` (repo root — the Dockerfile COPYs from the root).
4. **Port:** `3000` (the runner stage sets `PORT=3000`; the
   `pnpm dev`/`start` port 3100 is local-only).
5. Healthcheck: the image ships one (`/api/health`, 30s interval) —
   Coolify picks it up; you can also point Coolify's own healthcheck at
   `/api/health`.
6. Enable **Auto Deploy** so pushes to `main` redeploy.

## 4. Environment variables

Set these in Coolify → app → **Environment Variables** (mark secrets as
such; `NEXT_PUBLIC_*` values are baked in at **build** time — mark them
"Build Variable" in Coolify so the Docker build sees them).

Required (app fails closed in production without them):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NEXT_PUBLIC_APP_URL` | `https://dev.<your-domain>` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | same page — **server-only secret** |
| `AUTH_SECRET` | 32+ char random string (`openssl rand -base64 32`) |
| `ALLOWED_ORIGINS` | `https://dev.<your-domain>` |

Optional seams — each is env-gated and no-ops/fails closed when empty.
The full annotated list lives in [`.env.example`](../.env.example):
`STRIPE_*` (checkout), `BUNNY_*` (files/video — note **two separate**
webhook secrets), `NEXT_PUBLIC_POSTHOG_*` (analytics), `GORSE_*`
(recommendations), `AWS_*` + `AWS_SES_FROM_EMAIL` (email), `SENTRY_DSN`
(errors), `OAUTH_GOOGLE_ENABLED` / `OAUTH_APPLE_ENABLED` (display
toggles only — the credentials live in Supabase Auth config), plus the
feature-flag numbers (`DEFAULT_ROYALTY_PCT_BPS`,
`PLR_SUBSCRIBER_DISCOUNT_PCT_BPS`, `PERSONAL_ACCESS_PRICE_CENTS`).

**Never** put real keys in the repo. `.env.example` is the contract;
values live only in Coolify (and locally in `.env.local`, which is
gitignored).

## 5. Supabase

Use hosted Supabase (supabase.com) to start:

1. Create the project (EU region if your users are EU — GDPR posture).
2. Run the schema against it from your machine:
   ```bash
   # Direct Postgres connection string from Supabase → Database → Connect
   DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
     pnpm db:bootstrap
   DATABASE_URL='…' pnpm db:verify
   ```
   Migrations live in `04-platform/migrations/` (numbered, append-only).
3. Auth config: set the Site URL to the dev URL, add it to redirect
   URLs. OAuth providers (Google/Apple) are configured here when ready —
   see `.env.example §OAuth` + STUB-042.
4. Copy the three keys into Coolify (§4).

Self-hosting Supabase on Coolify (one-click service) is possible later;
budget ~2 GB extra RAM.

## 6. Stripe (before live payments — see D13)

Code-side handling is done (atomic paid-flip RPC, failed/expired
payment handler, dispute handler, automatic tax — see
`FINALIZATION-PROGRESS.md §Workstream B`). The Dashboard side is manual:

1. **Enable Stripe Tax** + add a tax registration (Settings → Tax) —
   without it tax computes $0.
2. Webhook endpoint: `https://dev.<domain>/api/webhooks/stripe`,
   subscribed to at least: `checkout.session.completed`,
   `checkout.session.expired`, `checkout.session.async_payment_failed`,
   `payment_intent.payment_failed`, `charge.dispute.created`,
   `charge.dispute.closed`, and the subscription lifecycle events.
   Signing secret → `STRIPE_WEBHOOK_SECRET`.
3. Create the Personal Access monthly price; id →
   `STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY`.
4. Test-mode end-to-end purchase before flipping live keys.

## 7. Bunny.net

- Storage zone (course files) + Stream library (video).
- Webhook URL: `https://dev.<domain>/api/webhooks/bunny` with
  **separate secrets** per surface: `BUNNY_WEBHOOK_SECRET` (storage
  scan results) and `BUNNY_VIDEO_WEBHOOK_SECRET` (encoding events) —
  the handler rejects cross-surface signatures (SEC-5).

## 8. Cron jobs

Six scheduled scripts exist (see `package.json` + 
`04-platform/ci/scripts/cron/`):

| Script | Suggested schedule |
|---|---|
| `cron:expire-carts` | hourly |
| `cron:detect-abandoned-carts` | hourly |
| `cron:release-locked-balances` | daily |
| `cron:email-queue` | every 5 min |
| `cron:partition-rollforward` | monthly |
| `reencrypt-legacy-payout-methods` | daily `0 5 * * *` (required — STUB-052) |

⚠️ **Blocked on task W3.5 (`TODO-GO-LIVE.md`):** these run via `tsx`
(a devDependency), but the production image contains only the
standalone Next server. Until W3.5 ships a jobs image (or precompiled
scripts), scheduled tasks cannot run inside the prod container. Don't
schedule them in Coolify until W3.5 lands and documents the command here.

## 9. Development URL

1. DNS **A record**: `dev.<your-domain>` → server IP.
2. Coolify → app → **Domains** → `https://dev.<your-domain>` —
   Let's Encrypt cert is issued automatically.
3. Push to `main` → auto build + deploy → check
   `https://dev.<domain>/api/health` (returns `{ok, app, env, version,
   time}` — integration booleans deliberately stripped, SEC-7/D14).

## 10. First-deploy checklist

- [ ] `/api/health` returns `ok: true` over HTTPS
- [ ] Home page renders with real catalog data (after `pnpm db:seed`
      or real content)
- [ ] Signup → email verification → login round-trip works
      (Supabase Auth URLs configured)
- [ ] A test-mode purchase completes: order paid → library grant →
      partner ledger row
- [ ] Video playback via signed Bunny URL works in the library
- [ ] `main` is the default branch and is protected by CI

## CI

`.github/workflows/ci.yml` runs on every PR and push to `main`:
frozen-lockfile install, `check:all` (typecheck, lint, spec/RLS/enum/
no-todo/PII/security-header checks), the full vitest suite, a
fresh-database migration bootstrap + verify against Postgres 16, and a
production `next build`. `db-types.yml` additionally keeps the
generated Supabase types fresh. Keep both green — Coolify deploys
whatever lands on `main`.
