# 00-foundations/AGENTS.md

> **The exclusive-lock layer.** One agent (the "foundations" agent) owns this folder at a time. Other agents file PRs against it; the foundations agent reviews and merges.

## What goes here

Shared primitives. **Code used by 2+ features** belongs here. Code used by exactly 1 feature belongs in that feature's folder.

```
00-foundations/
├── design/      ← tokens.css, primitives.css, icons
├── auth/        ← session.ts, RLS templates, guards
├── data/        ← Supabase clients, types, Zod schemas
├── ui/          ← React component primitives
├── files/       ← Bunny integration, signed URLs, audit
├── money/       ← Stripe, PayPal
└── test/        ← helpers, mocks, fixtures
```

## What does NOT go here

- Feature-specific business logic (goes in `02-features/[name]/`)
- Page-specific data fetching (page composes feature components)
- App-level routing (goes in `03-app/`)
- Database migrations (goes in `04-platform/migrations/`)
- Anything one-off (if only one feature uses it, it belongs there)

## The "exclusive lock" rule

**One agent at a time owns each sub-folder.** If you're working on `00-foundations/data/` and someone else needs to change something in there, they file a PR — they don't edit directly. You review and merge.

This isn't bureaucracy. It's because:

1. **Foundations are the load-bearing wall.** If two agents edit the same file at the same time, you get merge conflicts in the most painful place possible.
2. **Foundations decisions need consistency.** A new Zod schema should follow the conventions of existing Zod schemas. A new component should use the same tokens as the rest. One owner keeps the style coherent.
3. **Changes ripple.** Editing the `session.ts` breaks every feature. Editing the `stripe.ts` breaks checkout and subscriptions. The lock prevents accidental cascades.

## How to add to foundations

1. **Check the relevant README first.** Each sub-folder has its own README that explains what's there and how to add to it.
2. **Check the existing patterns.** Open 2-3 existing files. Match the style.
3. **File a PR, don't push direct.** The PR description must include:
   - What you're adding
   - Why it belongs in foundations (used by ≥ 2 features)
   - Which features are affected
   - Migration plan for any breaking changes
4. **Tests are mandatory.** Foundations code is the most-tested code in the project. Unit tests for any new helper. Integration tests for any new client wrapper.
5. **Update the relevant README.** If you add a new file, document it.

## How to remove from foundations

Almost never. If a foundation is no longer used by any feature, it's "dead weight" but removing it is a breaking change to anyone who imports it. Mark it `@deprecated` instead and plan removal in v2.

The only acceptable immediate removal: a security vulnerability. In that case, ship the fix first, the deprecation notice in the PR.

## Versioning

Foundations are versioned semantically. When you make a breaking change, bump the major. Add a `CHANGELOG.md` entry in the affected sub-folder.

This is optional for v1 (single team, fast iteration). Becomes required the moment we have external contributors or a public API.

## Read the per-folder READMEs

Each sub-folder has a README that documents what's there and how to add to it:

- [`design/README.md`](./design/README.md) — tokens, primitives, icons
- [`auth/README.md`](./auth/README.md) — session, RLS, guards
- [`data/README.md`](./data/README.md) — Supabase clients, types, schemas
- [`ui/README.md`](./ui/README.md) — React component primitives
- [`files/README.md`](./files/README.md) — Bunny integration, signed URLs, audit
- [`money/README.md`](./money/README.md) — Stripe, PayPal
- [`test/README.md`](./test/README.md) — helpers, mocks, fixtures

Read the one you need before adding to it.
