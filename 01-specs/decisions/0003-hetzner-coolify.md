# ADR-0003: Hetzner + Coolify, no Vercel

**Date:** 2026-06-12
**Status:** Accepted
**Deciders:** Human

## Context

We need to host the Next.js app, the database (via Supabase), and the file storage (via Bunny). The hosting decision affects:

- **Cost** (predictable monthly vs. per-request)
- **Performance** (latency to users globally)
- **Operations** (how much we manage ourselves)
- **Vendor lock-in** (how easy it is to migrate)
- **Compliance** (data residency, GDPR, etc.)

## Considered options

### Option A: Vercel

- **Pros:** Best-in-class DX for Next.js. Edge functions. ISR out of the box. The path of least resistance.
- **Cons:** **Cost at scale is unpredictable.** Vercel's pricing is per-invocation + per-bandwidth. At our projected volume, Vercel would be more expensive than running the app on a Hetzner VPS. We've heard too many stories of companies getting a $20k surprise bill from Vercel.

### Option B: AWS (ECS / Fargate)

- **Pros:** Mature, scalable, every service we need.
- **Cons:** Pricing complexity. Operational overhead (we'd need a DevOps engineer or a lot of agent automation). More than we need for our scale.

### Option C: Hetzner + Coolify

- **Pros:** Predictable monthly cost (€50-100/month for a beefy VPS). Full control. Coolify gives us a Heroku-like deployment experience without the per-request pricing. GDPR-friendly (Hetzner is in Germany). Good for our scale (5TB storage + 50TB egress/month fits comfortably on a Hetzner server with bandwidth included).
- **Cons:** More operational responsibility than Vercel. We manage the server, the deploys, the security patches. We're a small team.

### Option D: Self-hosted Kubernetes (k3s, etc.)

- **Pros:** Maximum control, scalable.
- **Cons:** Way too much operational overhead for our size. K8s is a full-time job.

## Decision

**Hetzner VPS + Coolify.**

The decision is primarily about cost predictability. We're a wholesale digital products platform with predictable traffic patterns. We don't have spiky load that needs auto-scaling. A €50-100/month Hetzner server handles our load easily, with room to grow. The savings vs. Vercel at our scale are substantial (estimated 70-80% lower monthly cost).

**Coolify** is a self-hosted PaaS that gives us a Heroku-like experience on top of Hetzner. It handles:
- Docker builds from our GitHub repo
- Zero-downtime deploys
- SSL certificate management (Let's Encrypt)
- Database hosting (we still use Supabase for the managed Postgres, but Coolify could host it too)
- Environment variable management
- Logs and basic metrics

We accept the operational responsibility because:
- Coolify reduces the day-to-day ops burden to near-zero
- We have a small, predictable workload that fits on one server
- The savings vs. Vercel are substantial

## The infrastructure layout

```
Hetzner VPS (Germany)
├── Coolify (self-hosted PaaS)
│   ├── Next.js app (Docker)
│   ├── Bunny mock (dev only)
│   └── MailHog (dev only)
└── (in prod) Nothing else — Supabase, Bunny, Stripe, PayPal, Resend are all external

Supabase (EU region, Frankfurt)
└── Postgres + GoTrue (auth) + PostgREST + Storage (not used for files)

Bunny.net
├── Stream (video)
└── Storage (origin tier for uploads, served via CDN)

Stripe, PayPal, Resend
└── All external SaaS
```

## Why not Vercel?

We considered it. The reasons we chose against it:

1. **Cost predictability.** Vercel's pricing is per-invocation + per-bandwidth. At our projected volume (5TB storage + 50TB egress/month), Vercel would be 5-10x the cost of Hetzner.
2. **No real auto-scaling need.** Our traffic is steady, not spiky. We don't need serverless functions to handle a Black Friday spike.
3. **Lock-in.** Vercel's edge functions, ISR, and middleware are tightly coupled to Vercel's runtime. Migrating off would be a major rewrite.
4. **Hetzner is GDPR-friendly.** Frankfurt, German data protection laws, EU-only. Vercel is US-based with EU regions, but the data flows through more US infrastructure.

## Consequences

### Positive

- **Predictable monthly cost.** We know exactly what the server costs. Bunny, Stripe, PayPal, Resend, Supabase are per-transaction but bounded.
- **Full control.** We can install any software, configure the server however we want, run custom cron jobs.
- **GDPR-friendly hosting.** Hetzner is in Germany, Supabase EU region. User data stays in the EU.
- **No surprise bills.** Vercel's billing surprises are a meme for a reason.

### Negative

- **We're responsible for the server.** OS updates, security patches, SSL certs (Coolify handles most of this, but we're on the hook if it breaks).
- **No edge runtime.** We can't deploy code to 200+ edge locations like Vercel. We have one server in one region. (For our user base, one EU region is fine.)
- **Manual scaling.** If we outgrow the server, we manually upgrade to a bigger one. Not a problem for our scale, but a constraint.
- **Disaster recovery is our problem.** Hetzner has good uptime, but if the server dies, we need a backup plan. We have automated daily backups to Hetzner Storage Box.

### Mitigations

- **Daily backups** to Hetzner Storage Box. Documented in `04-platform/storage/README.md`.
- **Off-site cold backup** weekly to a different provider (B2 or AWS S3 Deep Archive).
- **Monitoring** via Sentry + Prometheus + Grafana. We get paged if the server is down.
- **Runbook** for server failures in `05-ops/runbooks/incident-response.md`.
- **Coolify's auto-deploy** means we don't manually SSH to the server for deploys. The same GitHub-to-Coolify pipeline as Heroku.

## When we'd revisit

- If our traffic grows 10x and we need multi-region.
- If we add a real-time feature that needs edge compute (e.g. collaborative editing).
- If Coolify becomes unmaintained.

For v1, this is the right choice.

## References

- The deploy pipeline: `04-platform/ci/README.md`
- The incident response: `05-ops/runbooks/incident-response.md`
- The Coolify project: https://coolify.io/
- Hetzner: https://www.hetzner.com/
