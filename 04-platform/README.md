# 04-platform/

Platform infrastructure. Database, storage, emails, webhooks, observability, CI/CD. The deploy-time and runtime concerns that the rest of the app relies on. **One agent at a time** owns this folder — it's the most sequential, most critical, and most dangerous to change without coordination.

## Sub-folders

- **`migrations/`** — append-only numbered SQL files. Strictly sequential. See `migrations/README.md`.
- **`storage/`** — Bunny bucket setup, CDN config, signed URL key rotation. See `storage/README.md`.
- **`emails/`** — React Email templates for transactional emails. See `emails/README.md`.
- **`webhooks/`** — Stripe, PayPal, Bunny webhook handlers. See `webhooks/README.md`.
- **`observability/`** — Prometheus metrics, Sentry config, structured log schema. See `observability/README.md`.
- **`ci/`** — GitHub Actions, Coolify deploy scripts, security scan configs. See `ci/README.md`.

## Why this folder is exclusive-locked

A migration that adds a column has a half-life. While it's in review, every other PR that reads or writes that table might break. The same for webhooks (race conditions), storage (cache invalidation), CI (build breakage).

The **strictly sequential** rule for migrations is the strongest version of this. A migration that runs 5 minutes after the previous one is a different PR than a migration that runs 5 days after.

If you're working on a platform change and someone else is in flight, you wait. You do NOT start a parallel change. The cost of coordination is small; the cost of a mid-flight collision is large.

## When to add a new file here

When the change is:
- **Schema-changing** (table, column, RLS policy, index) → migration
- **Data-flowing** (event handler, webhook, scheduled job) → webhooks or new sub-folder
- **Observed** (log line, metric, alert) → observability
- **Sent** (email, push notification, Slack message) → emails or new sub-folder
- **Deployed** (CI step, deploy script, secret rotation) → ci

**When NOT to add a file here:**
- Business logic → `02-features/[name]/`
- Shared utilities → `00-foundations/[sub]/`
- UI changes → `03-app/` or `02-features/[name]/`

The rule: if your change is a feature user-facing thing, it's not a platform thing. The platform folder is for the rails the features run on.

## The "no surprises" rule

Platform changes that have user-visible impact MUST be reviewed by the human:
- A migration that drops a column → human review
- A webhook handler that changes the response shape → human review
- An email template that changes the wording users see → human review
- A CI step that fails builds → human review

Platform changes that are internal:
- Renaming a function in a webhook handler → reviewer agent is enough
- Adding a new metric → reviewer agent is enough
- Refactoring a storage helper → reviewer agent is enough

When in doubt: ask the human. The cost of an extra review is 5 minutes. The cost of a sneaky platform bug is much more.

## Rollback

Every change in this folder has a rollback plan:
- Migrations: a corresponding `*_rollback.sql` or a follow-up migration that undoes it
- Webhooks: the previous version is in git; redeploy it
- Storage: Bunny bucket versions are on; can restore
- CI: GitHub Actions keeps history; rerun on previous commit

The rollback plan is documented in the PR description. Not in a side doc — in the PR, so it's reviewed along with the change.

## The 1 agent rule

One agent at a time owns this folder. The owner:
- Reviews all incoming PRs to this folder
- Has final say on migration ordering
- Maintains the deploy / rollback scripts
- Owns the production observability story

If you need a platform change and you're not the owner:
1. Open a PR with the change
2. Tag the owner for review
3. The owner merges (or sends back)

This is a hard rule, not a guideline. Two agents writing migrations in parallel will eventually corrupt a database.
