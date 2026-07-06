# Uthena v2

Wholesale PLR video course marketplace. Built from scratch on Next.js 15
+ Supabase + Stripe + Bunny.net, with PostHog for analytics, Gorse for
recommendations, and Amazon SES for email.

> **Working local + container-first.** No git in the repo for now — the
> specs in `01-specs/` are the source of truth. The build runs on
> `localhost` and inside the container at `infra/Dockerfile`.

## Status

The build is sliced into 21 phases — see [`PHASES.md`](./PHASES.md) for
the full dependency-ordered plan and current status.

| Wave | Phases | What |
|---|---|---|
| 1 — Buyer foundation | PH01 → PH12 | Repo, foundations, DB, auth, buyer flow, payments, library, account, legal, GDPR |
| 2 — Marketplace | PH13 → PH15 | Partner portal, affiliate portal, admin console |
| 3 — Engagement + growth | PH16 → PH19 | LMS basics, Gorse recommendations, SES email, observability |
| 4 — Marketing + ship | PH20 → PH21 | Blog, SEO migration, ship hardening |

## Quick start (local)

```bash
# 1. Install pnpm if you don't have it.
npm i -g pnpm

# 2. Install deps.
pnpm install

# 3. Copy env.
cp .env.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, AUTH_SECRET (32+ chars).

# 4. Dev server.
pnpm dev

# 5. Open:
#    - http://localhost:3000
#    - http://localhost:3000/api/health
```

When you don't have Supabase running, the home page still loads — the
`/api/health` endpoint shows which features are wired (green = key
present, off = key missing, app still runs).

## Quick start (container)

```bash
docker compose -f infra/docker-compose.yml up --build
# open http://localhost:3000
```

## Scripts

| Script | What |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build (standalone output) |
| `pnpm start` | Run production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier write |
| `pnpm test` | Vitest |
| `pnpm test:e2e` | Playwright |
| `pnpm check:specs` | Every page has a spec in `01-specs/pages/` |
| `pnpm check:rls` | Every new table has RLS in the same migration |
| `pnpm check:no-todo` | No `TODO`/`FIXME`/`XXX`/`HACK` in shipped code |
| `pnpm check:pii` | No PII in logs |
| `pnpm check:all` | All of the above |

## Architecture

```
00-foundations/   shared primitives (design, auth, data, ui, files, money, test)
01-specs/         page specs + ADRs (the contract)
02-features/      one folder per feature; self-contained
03-app → app/     thin Next.js routes; composes features
04-platform/      migrations, webhooks, emails, observability, storage, CI
05-ops/           runbooks, decisions, compliance
06-quality/       checklists, test suites
07-archive/       deprecated
docs/             public-facing reference
mockups/          HTML design references
demo/             working static prototype
infra/            Dockerfile, docker-compose, scripts
PHASES.md         build order
STUBS.md          intentional gaps + owners
```

The full design contract is in [`docs/BRAND_AND_POSITIONING.md`](./docs/BRAND_AND_POSITIONING.md)
and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## How to work on it

Read [`AGENTS.md`](./AGENTS.md). It is the constitution.

In short:

- **No code without a spec.** If the spec doesn't exist in `01-specs/pages/`,
  write the spec first.
- **No `TODO` in code.** Follow-ups go in `STUBS.md`.
- **RLS on every table.** In the same migration.
- **Auth on every non-public route.**
- **No PII in logs.**
- **No secrets in the repo.** Doppler/Vault/SSM in production.
- **Money in cents. Time in seconds. CSS in tokens.**
- **WYSIWYG from the start.** Long-form content uses the TipTap field
  in `00-foundations/ui/forms/RichTextField.tsx` — no markdown.

## Current phase

**PH01 in progress.** Scaffold + design tokens + env validation + CI
scripts + container + working home page. Once the home page boots in
the container, PH01 ships and we start PH02.
