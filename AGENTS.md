# AGENTS.md — How we work on Uthena

> **Read this first. Every time. No exceptions.**
> This is the constitution. The other docs in this repo are laws, regulations, and case law. This is the constitution — it overrides anything that conflicts with it.

---

## What this project is

We're building **Uthena v2** — a custom-coded platform to replace the existing Shopify store at uthena.com. Wholesale digital products (PLR video courses + digital assets) for resellers, instructors, and affiliates. Real money moves through this. Real files (5TB+) flow through this. Real people depend on it.

**Stack:** Next.js 15 (App Router) + Supabase (Postgres + Auth + RLS) + Bunny.net (Stream + Storage) + Hetzner/Coolify + Stripe (in) + PayPal Mass Payout (out) + Resend (email).

**Full design + architecture in:**
- [`docs/BRAND_AND_POSITIONING.md`](./docs/BRAND_AND_POSITIONING.md)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- [`mockups/`](./mockups/) — design references

---

## The five things that must be true for every change

If any of these is false, the change doesn't ship. No exceptions. No "we'll fix it in the next PR." No "it works on my machine."

### 1. End products, not half-baked work

Every PR is a **finished, working, tested, documented** change. The bar is: a person with no context can clone the repo, run the build, and use the feature exactly as the spec describes.

- No `TODO`, `FIXME`, or `XXX` in shipped code. (See rule 4 below.)
- No "I'll wire this up next" — wire it up in this PR.
- No mocked data left in production paths. If a feature is incomplete, **don't merge the PR** — file a follow-up spec instead.
- Every PR has a screenshot, screen recording, or test that proves the feature works.

### 2. Security is the first priority, not a final check

We are processing payments, storing PII, and serving 5TB of licensed content. Security is not a checklist at the end of the PR — it's the first thing you think about when you start.

- **Auth required by default.** If a route is public, the spec says so. Otherwise, it requires authentication.
- **RLS on every table.** No table goes to production without a Row Level Security policy. No exceptions, even for "internal" tables.
- **No secrets in code.** No API keys, no service-role keys, no database URLs in `.env.local` checked into git. Use Doppler / Vault / SSM. The repo has no secrets.
- **No PII in logs.** Ever. Mask emails, redact tokens, hash IDs. The agent that logs PII blocks the PR.
- **File access is signed + expiring + audit-logged.** Every video stream URL, every download URL. 4h TTL for streams, 24h for downloads. Every download is recorded in `file_downloads`.
- **No third-party trackers without consent.** No Google Analytics, no Facebook pixel, no Hotjar. We use Plausible (cookieless) or self-hosted PostHog.
- **Admin reads of PII are audit-logged.** No silent access to user data.

If you're not sure whether a change is secure, **ask before shipping**. Default to "no" and require a human to sign off on "yes."

### 3. Speed & usability, but never at security's expense

We have published performance targets in [`docs/ARCHITECTURE.md` §5](./docs/ARCHITECTURE.md):
- Catalog/product page p95 < 200ms
- Course player first frame < 1.5s
- Library page p95 < 400ms

**Usability rule:** every interactive element is keyboard-accessible. Every form has visible focus states. Every error message tells the user what to do next. Empty states are designed, not blank.

**Speed rules:**
- RSC by default. `'use client'` only when you need interactivity.
- No client-side data fetching for the catalog or product pages. ISR + RSC.
- Images via `next/image`. Fonts via `next/font`. No random CDN imports.
- Bundle size is checked in CI. If your PR adds > 50KB to the client bundle, justify it in the PR description.

**The tiebreaker:** if speed and security conflict, security wins. If speed and usability conflict, the slower one needs a comment explaining why.

### 4. No `TODO` left in code. Ever.

`TODO`, `FIXME`, `XXX`, `HACK`, `// for now`, `// later` — these are not allowed in merged code. Period.

**What to do instead:**

| Instead of | You must |
|---|---|
| `// TODO: add rate limiting` | Add the rate limiting in this PR, OR file a follow-up spec in `01-specs/pages/_followups.md` |
| `// FIXME: this breaks on iOS Safari 16` | Fix it, OR open a follow-up spec, OR escalate to a human |
| `// HACK: bypass auth for testing` | **Stop. Revert this immediately.** This is a security violation. |

The "file a follow-up spec" option is the legitimate escape valve. Use it for things that genuinely belong in a separate PR (large refactors, scope creep). Do not use it to dodge work in your current PR.

### 5. The spec is the contract

**No code is written without a spec.** If you are about to write code and the spec doesn't exist in `01-specs/pages/`, **stop and write the spec first**. Flag the spec for human review. Do not start coding until the spec is approved.

The spec is the source of truth. If the design changes mid-implementation, **update the spec first**, then update the code. If the implementation reveals the spec was wrong, **fix the spec, then fix the code**, in that order, in the same PR.

---

## How the work flows

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  1. HUMAN writes or approves a spec in 01-specs/pages/              │
│       (or: agent drafts, human approves)                            │
│                                                                     │
│  2. AGENT (builder) implements the feature in 02-features/[name]/   │
│       using the spec + design system + mockup                       │
│                                                                     │
│  3. AGENT (reviewer — different agent, different session) checks:   │
│       - spec compliance (every acceptance criterion met)            │
│       - security (RLS, auth, secrets, PII)                          │
│       - design system adherence (uses tokens, not inline values)    │
│       - test coverage (unit + e2e for the new code)                 │
│       - no TODO / FIXME / HACK in diff                             │
│       - bundle size impact                                          │
│                                                                     │
│  4. HUMAN gates the PR                                              │
│       - looks at the screenshot                                     │
│       - clicks through the feature                                   │
│       - approves or sends back                                      │
│                                                                     │
│  5. CI runs (typecheck, lint, tests, security scan, build)           │
│                                                                     │
│  6. Merge → auto-deploy                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Your time budget as the human:** ~30 min per page. You write/approve the spec, then skim the screenshot when the PR is up. The agents do the rest.

---

## Folder structure (the layers)

```
uthena/
├── AGENTS.md                      ← you are here
├── README.md                      ← project intro
│
├── 00-foundations/                ← shared primitives. No feature code here.
│   ├── design/                    ← tokens, primitives, icons
│   ├── auth/                      ← session, RLS, guards
│   ├── data/                      ← Supabase clients, types, Zod schemas
│   ├── ui/                        ← React component primitives
│   ├── files/                     ← Bunny integration, signed URLs, audit
│   ├── money/                     ← Stripe, PayPal
│   └── test/                      ← test helpers, mocks
│
├── 01-specs/                      ← THE HUMAN GATE. No code without a spec.
│   ├── README.md                  ← how to write a spec
│   ├── pages/
│   │   ├── _template.md           ← copy this for every new page
│   │   ├── _followups.md          ← issues filed from TODOs in code
│   │   ├── home.md
│   │   ├── catalog.md
│   │   ├── product.md
│   │   └── ... (one per page)
│   └── decisions/                 ← ADRs (architecture decision records)
│
├── 02-features/                   ← feature modules. Self-contained.
│   ├── catalog/
│   ├── product/
│   ├── checkout/
│   ├── library/
│   ├── partner-portal/
│   ├── affiliate-portal/
│   ├── admin/
│   └── auth/
│
├── 03-app/                        ← Next.js App Router. Pages are THIN.
│   ├── layout.tsx
│   ├── page.tsx                   ← home
│   ├── browse/
│   ├── collections/[handle]/
│   ├── products/[slug]/
│   ├── checkout/
│   ├── library/
│   ├── partner/
│   ├── affiliate/
│   ├── admin/
│   ├── login/
│   ├── signup/
│   └── [handle]/                  ← affiliate mini-shop
│
├── 04-platform/                   ← infrastructure. Deploy-time concerns.
│   ├── migrations/                ← numbered SQL files
│   ├── storage/                   ← Bunny bucket setup, CDN config
│   ├── emails/                    ← React Email templates
│   ├── webhooks/                  ← Stripe, PayPal, Bunny handlers
│   ├── observability/             ← Prometheus, Sentry, log schema
│   └── ci/                        ← GitHub Actions, Coolify deploy
│
├── 05-ops/                        ← running the business
│   ├── runbooks/                  ← incident response, payout procedures
│   ├── decisions/                 ← business-level decisions
│   └── compliance/                ← GDPR, tax, partner agreements
│
├── 06-quality/                    ← testing, review, definitions of done
│   ├── checklists/                ← pre-merge, pre-deploy, security audit
│   └── tests/                     ← e2e, unit, integration
│
├── 07-archive/                    ← finished work, retros, deprecated code
│
├── docs/                          ← external-facing reference
│   ├── BRAND_AND_POSITIONING.md
│   ├── ARCHITECTURE.md
│   └── assets/
│
└── mockups/                       ← design references (HTML)
```

### What lives where

| Layer | What goes here | What does NOT go here |
|---|---|---|
| **00-foundations** | Shared code used by 2+ features. Design tokens, primitives, RLS templates, schema types, Supabase clients, signed URL helpers, Stripe/PayPal wrappers, test helpers. | Feature-specific business logic, page-specific components, page-specific data fetching. |
| **01-specs** | Page specifications, ADRs, data model docs. The contract. | Implementation code, design assets. |
| **02-features** | One folder per feature. Each feature is self-contained: its own components, server actions, queries, tests, README. The feature is owned by one agent at a time. | Cross-feature code (goes in `00-foundations`), app-level routing (goes in `03-app`). |
| **03-app** | The Next.js App Router. Pages are thin: they import from features, compose components, and pass data. **No business logic here.** | Reusable components, server actions, queries. |
| **04-platform** | Database migrations, RLS policies, storage setup, email templates, webhook handlers, observability config, CI pipelines. | Feature-level queries, page-level logic. |
| **05-ops** | Runbooks (incident response, payout procedures), business decisions, compliance docs. **Documentation only**, not code. | Code of any kind. |
| **06-quality** | Test suites, review checklists, security audit scripts. | Application code or specs. |
| **07-archive** | Deprecated code, completed retros, things we tried and dropped. Kept for history, not for use. | New work. |

---

## File ownership rules (for parallel work)

These rules exist so multiple agents can work simultaneously without stepping on each other.

### Who owns what

| Folder | Owner | Lock model |
|---|---|---|
| `00-foundations/[sub]/` | "Foundations" agent (one agent at a time) | **Exclusive lock.** Other agents file a request PR. |
| `01-specs/` | The human + the spec-writer agent (the agent assigned to a spec) | Multiple agents can read. Only the spec owner writes. |
| `02-features/[name]/` | The agent assigned to that feature | **Exclusive lock during implementation.** Reviewer can read but not write. |
| `02-features/*/tests/` | Whoever owns the feature | Same as above. |
| `03-app/` | The agent assigned the page spec | One PR per route. Don't change a route someone else is working on. |
| `04-platform/migrations/` | "Platform" agent | **Strictly sequential.** PRs land in order. No parallel migrations. |
| `04-platform/webhooks/` | "Platform" agent | Exclusive lock per webhook. |
| `06-quality/tests/e2e/` | Whoever owns the feature being tested | Co-owned with the feature agent. |

### The "exclusive lock" rule in practice

If you need to change a file in a locked folder:
1. **Don't.** Find another way (extend the public API, add a new file in your own folder, file a follow-up).
2. If you absolutely must, open a PR against the locked folder. Tag the folder owner for review. They merge.
3. **Never commit directly to a locked branch.** Always via PR.

### When two agents both need the same file

This is a bug in the planning, not a feature. Stop, sync with the human, update the spec. Whoever ends up owning the change, the OTHER agent reviews.

---

## PR conventions

### Branch naming

```
feat/[feature-name]              ← new feature
fix/[issue]                      ← bug fix
refactor/[scope]                 ← no behavior change
docs/[doc-name]                  ← spec, ADR, README update
chore/[scope]                    ← tooling, deps, config
```

### PR description template

Copy this into every PR. Don't skip sections.

```markdown
## What
[One sentence. What does this PR do?]

## Why
[Link to the spec in 01-specs/pages/. Without a spec link, the PR is rejected at review.]

## Spec acceptance criteria
Copy-paste the acceptance criteria from the spec, then check each box:
- [x] [criterion 1] — [link to test or screenshot proving it]
- [x] [criterion 2] — [link]
- [ ] [criterion 3] — NOT MET. Reason: [explanation or follow-up link]

## Security checklist
- [x] Auth required (or: spec marks this route as public)
- [x] RLS policies in place for any new table access
- [x] No secrets in diff
- [x] No PII in logs
- [x] File access goes through signed URLs (if applicable)

## Tests
- [x] Unit tests added/updated
- [x] E2E test added (if user-facing)
- [x] Manual screenshot attached (for UI changes)

## Bundle / perf impact
[None, or: "added X KB to client bundle because Y"]

## Screenshots / recordings
[Required for any UI change. Attach to PR or paste image link.]

## Follow-ups
- [Any TODOs that were converted to follow-up specs, with links]
```

### What gets rejected at review

The reviewer (different agent, different session) has the authority to block the PR if any of these are true:

- No spec link in the PR description
- An acceptance criterion box is unchecked
- A `TODO`/`FIXME`/`HACK` is in the diff
- A new table is added without a RLS policy
- A new route is added without a security check
- A test was deleted without justification
- A screenshot is missing for a UI change
- The PR touches a file in a locked folder without the owner signing off

If the reviewer says "block," the PR is blocked. The builder fixes and re-submits. If the builder disagrees with the block, they escalate to the human.

---

## Working with specs

### The spec template

`01-specs/pages/_template.md` is the starting point. Every page spec has the same structure:

1. What this page does
2. Data this page shows
3. User actions (with RBAC)
4. What this page does NOT do
5. Acceptance criteria (checklist)
6. Design reference (which mockup)
7. Security (auth, RLS, PII, audit)
8. Performance (p95, ISR/SSR, cache)
9. Out of scope for v1
10. Open questions for human

The full template is in `01-specs/pages/_template.md`. Read it before writing any spec.

### When the spec is wrong mid-implementation

Update the spec first, then the code, in the same PR. Both in the same commit if possible. If the spec change is large, escalate to the human.

### When you discover a new requirement

Don't add it to the current PR. File a follow-up spec in `01-specs/pages/_followups.md` and finish your current PR. Scope creep is the #1 killer of "end products, not half-baked work."

### When the spec is ambiguous

Ask. Don't guess. The cost of asking is 5 minutes. The cost of guessing wrong is 3 hours of refactor.

### Batch spec production (`.mavis/plans/`)

Large batches of specs are produced by orchestrated agent runs defined in `.mavis/plans/plan.yaml`. Each plan task pairs a producer agent (writes the specs against `_template.md` and `_data-model.md`) with an adversarial verifier agent (per-criterion PASS/FAIL: template completeness, field names match the data model, testable acceptance criteria, named RLS policies, no placeholder text). Specs that come out of a `.mavis` run still go through the human gate — the verifier raises the floor, the human remains the approval. If you're writing a single spec by hand, you don't need `.mavis`; follow `01-specs/README.md`. If you're changing how batch runs work, edit the plan, not the produced specs.

### Spec coverage is enforced in CI

`04-platform/ci/scripts/check-spec-coverage.sh` runs in the security-scan job and fails the build if any route in `03-app/` lacks a spec in `01-specs/pages/`. "No code without a spec" is mechanical, not just reviewed.

---

## Working with the design system

**All UI must use design tokens.** No inline colors, no magic hex values, no `style={{ padding: '13px' }}` unless the value isn't a token.

- Colors: `var(--text-1)`, `var(--accent)`, `var(--bg-1)`, etc. — see `00-foundations/design/tokens.css`.
- Spacing: stick to 4/8/12/16/24/32/48/64px steps.
- Radii: 6/8/10/14/18px (v3 design system).
- Type: 14px body, 13px small, 12px tiny. Use `t-sm`, `t-xs`, `t-mute`, `t-num` classes.

**The "use the design system" rule is enforced at code review.** If a reviewer sees `color: #14A89A` in a component, they reject the PR. Use `var(--accent)`.

---

## Working with the database

- **Every migration is numbered and append-only.** `04-platform/migrations/0001_initial.sql`, `0002_add_payout_ledger.sql`, etc. Never edit a migration that's already been applied. If you need to change a migration, add a new one.
- **Every table has RLS.** If you create a table without RLS, the PR is blocked.
- **Types are generated from the schema.** `00-foundations/data/types.ts` is auto-generated by `supabase gen types`. Don't hand-write types for tables.
- **Zod schemas are the source of truth for input validation.** Every server action that takes input validates with Zod first, before touching the database.

---

## Working with secrets

**There are no secrets in this repo.** Period.

- API keys live in Doppler / Vault / SSM / Coolify environment variables.
- The repo has `.env.example` with placeholder values, not real keys.
- If you need a new secret, **request it from the human**. Don't try to work around it.
- If you accidentally commit a secret, the rotation procedure is in `05-ops/runbooks/secret-rotation.md`. Follow it. Don't try to fix it with a force-push.

---

## Communication with the human

The human is in the loop at three points:

1. **Spec approval** — before code starts. ~30 min per page.
2. **PR review** — at the end. Skim the screenshot, click through. ~5 min per PR.
3. **Architectural changes** — anytime the spec needs to deviate from the documented architecture, or you're about to make a decision that affects multiple features. Ask first.

The human is **not** in the loop for:
- Implementation details (variable names, file structure within a feature)
- Test coverage decisions (within reason)
- Library choices (within the constraints in `docs/ARCHITECTURE.md`)

If you're not sure which one your question is, **default to asking**. Asking is cheap. Assuming is expensive.

---

## What "done" means for different kinds of work

### Done for a page

- [ ] Spec exists in `01-specs/pages/[name].md` and is approved
- [ ] Page route exists in `03-app/`
- [ ] Page composes feature components from `02-features/[name]/`
- [ ] No business logic in the page itself
- [ ] All acceptance criteria checked off in the PR
- [ ] Unit tests for any logic the page owns
- [ ] E2E test for the happy path
- [ ] Screenshot attached
- [ ] PR reviewed by a different agent
- [ ] PR approved by the human
- [ ] CI green (typecheck, lint, tests, build, security scan)
- [ ] Merged

### Done for a feature module

- [ ] Module has a `README.md` that explains what it does, who owns it, and how to use it
- [ ] Components are exported from the module's `index.ts`
- [ ] Server actions have Zod validation on every input
- [ ] RLS policies in place for any data the feature accesses
- [ ] Unit tests cover the business logic
- [ ] Integration tests cover the data layer
- [ ] E2E test for the user-facing flow
- [ ] No `TODO` in the diff

### Done for a migration

- [ ] Migration is numbered and idempotent (`IF NOT EXISTS` where possible)
- [ ] Every new table has RLS in the same migration
- [ ] RLS policies are tested with both authorized and unauthorized users
- [ ] Types regenerated and committed
- [ ] Migration runs on a fresh database without errors
- [ ] Migration runs on the staging database without errors
- [ ] Rollback plan documented (separate migration that undoes it)

### Done for a release

- [ ] All PRs in the milestone merged
- [ ] `06-quality/checklists/pre-deploy.md` completed
- [ ] `06-quality/checklists/security-audit.md` completed
- [ ] Smoke test on staging passed
- [ ] Human approves the release
- [ ] Deploy to production
- [ ] Smoke test on production passed
- [ ] `05-ops/runbooks/incident-response.md` ready (always, but reviewed at release)

---

## When you get stuck

Order of escalation:

1. **Read the spec again.** 60% of "stuck" is missing a requirement in the spec.
2. **Read the relevant `00-foundations/[sub]/README.md`.** 25% of "stuck" is not knowing that a helper already exists.
3. **Read `docs/ARCHITECTURE.md`.** 10% of "stuck" is making an architectural decision that was already made.
4. **Ask the human.** 5% of "stuck" genuinely needs human input.
5. **Read source code in `02-features/`.** Last resort — usually the answer is in someone else's feature.

Do **not**:
- Guess
- Copy code from StackOverflow without understanding it
- Add a new dependency without checking if one already exists in the lockfile
- Create a new file in a locked folder

---

## Anti-patterns (don't do these)

These are things that have bitten us in past projects. Don't repeat them.

- ❌ **Big-bang migrations** — splitting a migration is fine. Don't merge 50 table changes in one PR.
- ❌ **Inline business logic in pages** — pages compose features, they don't contain logic.
- ❌ **Magic strings** — every product type, role, status, etc. is a TypeScript enum or const, defined in `00-foundations/data/`.
- ❌ **Silent fallbacks** — if a query returns nothing, the page should show an empty state, not a generic "error" or a mock.
- ❌ **Skipping the spec because "it's obvious"** — the spec is the contract. Even for "obvious" changes, write a 3-line spec.
- ❌ **Merging your own PR** — the reviewer merges. If you ARE the reviewer (because there's no one else), you wait 24h and re-review your own work with fresh eyes.
- ❌ **"I'll add tests later"** — tests are part of the PR. No exceptions.
- ❌ **"I'll document later"** — docs are part of the PR. No exceptions.
- ❌ **Force-pushing to main** — if you need to rewrite history, do it in a PR. Main is sacred.
- ❌ **Editing a migration that's been applied** — add a new one. Always.

---

## TL;DR for the impatient agent

1. Read this file. All of it.
2. Read the spec for what you're building. If it doesn't exist, write it.
3. Read `docs/ARCHITECTURE.md`. Don't make decisions it already made.
4. Use the design system tokens. No magic values.
5. RLS on every table. Auth on every non-public route. No PII in logs.
6. Tests in the same PR. No TODOs in the diff.
7. PR description links the spec, checks all acceptance criteria, attaches a screenshot.
8. Different agent reviews. Human approves. CI merges.
9. If you're stuck, ask. Don't guess.

Welcome to Uthena. Build something we're proud of.

## Imported Claude Cowork project instructions
