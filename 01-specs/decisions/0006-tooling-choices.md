# ADR-0006: Tooling choices

**Date:** 2026-06-12
**Status:** Accepted
**Deciders:** Human, platform agent

## Context

This ADR captures the tooling decisions for the v1 build. It covers the language, runtime, package manager, framework, test stack, linter, formatter, and CI system. The goal is to lock the choices so the team isn't re-litigating them on every PR.

## The stack

| Layer | Tool | Why |
|---|---|---|
| Language | TypeScript (strict mode) | Type safety. The codebase is large enough that dynamic typing would cause more bugs than the friction of TS. |
| Runtime | Node.js 20 LTS | Current LTS, supported by Next.js, mature ecosystem. |
| Framework | Next.js 15 (App Router) | Server-first, RSC, ISR, Server Actions. The right fit for our content-heavy app. |
| Package manager | pnpm | Faster installs, smaller disk footprint, strict dependency resolution. |
| Database client | Supabase JS | First-party support, RLS integration, real-time channels. |
| Auth | Supabase Auth (GoTrue) | Same vendor as the DB. Less glue code. |
| UI primitives | Custom (00-foundations/ui/) | The v3 design system is custom; we don't need a third-party component library. |
| Styling | CSS Modules + design tokens | No Tailwind (per the design system); no styled-components (no runtime cost). |
| Forms | React Hook Form + Zod | Type-safe forms, integrates with our Zod schemas in foundations. |
| Server state | TanStack Query (for client-side cache only) | For the few client-side data fetching needs (most data is RSC). |
| Client state | React useState + Context (for theme) | We don't need Redux. |
| Date | date-fns | Tree-shakeable, immutable, TS-native. |
| Linter | ESLint (flat config) | Industry standard. Custom rules for the cross-feature imports and RLS coverage. |
| Formatter | Prettier | Standard, no debate. |
| Type checker | TypeScript 5+ `tsc --noEmit` | Strict mode, no implicit any, exactOptionalPropertyTypes. |
| Unit tests | Vitest | Fast, ESM-native, Jest-compatible API. |
| Integration tests | Vitest + Supabase local | Same framework, hits the real test DB. |
| E2E tests | Playwright | Best-in-class browser automation. |
| Component visual tests | Playwright + screenshots | For UI regression. (Not in v1; deferred to v1.1.) |
| Email templates | React Email | Type-safe, JSX, renders to HTML + plain text. |
| Background jobs | Custom (cron + Node scripts) | We don't need a queue system in v1. BullMQ considered but overkill. |
| Observability | Sentry + Prometheus + Grafana | Standard. Sentry for errors, Prometheus for metrics, Grafana for dashboards. |
| Tracing | OpenTelemetry → Honeycomb | Distributed tracing across Next.js, Supabase, Bunny. |
| Logging | pino | Fast structured JSON logger. |
| Process manager | Coolify (Docker) | For deploys. |
| CI | GitHub Actions | Where the repo is. |
| Container | Docker (multi-stage, distroless) | Standard. |

## What we explicitly did NOT choose

### TypeScript with looser settings

We use `strict: true` and `exactOptionalPropertyTypes: true`. The cost of "let me use `any` real quick" is much higher than the friction of typing it properly.

### Tailwind CSS

We considered it. The decision: our design system is custom, and Tailwind would be a parallel system. We'd end up fighting between the two. CSS Modules + design tokens is more work upfront but gives us a single source of truth.

We may revisit if the design system stabilizes and Tailwind becomes a productivity boost. Not for v1.

### tRPC

We considered tRPC for the API layer. The decision: Next.js Server Actions are sufficient for our needs. tRPC adds another abstraction. We can add it later if we need a separate API for mobile or third parties.

### Prisma

We considered Prisma. The decision: Supabase's generated types + the Supabase JS client are enough. Prisma adds another query layer that doesn't really buy us much (RLS is enforced at the DB level, not the ORM level). The Supabase client is fine for our scale.

### NextAuth.js (Auth.js)

We considered it. The decision: Supabase Auth is the same vendor as the DB. Less glue. Less code. Less to break. NextAuth would mean a second auth system to keep in sync.

### Jest

We considered Jest. The decision: Vitest is faster, has better TS support, and is Jest-compatible (most plugins work). The team can move between projects without context-switching.

### Storybook

We considered Storybook for component development. The decision: the design system is locked (v3 approved) and components are owned by features, not foundations. Storybook would be overhead with no payoff. We use the design system mockups in `mockups/` as the source of truth.

### Husky / pre-commit hooks

We considered pre-commit hooks for linting. The decision: CI runs all the checks. Pre-commit hooks are for things CI can't catch (e.g. a real secret in a file). We use gitleaks in CI, which is the right place for secret detection. Lint happens in CI.

### Lerna / Nx / Turborepo

We considered a monorepo tool. The decision: our app is one Next.js app, not multiple packages. We don't need a monorepo. If we extract a shared library later, we can add pnpm workspaces or Turborepo then.

### Redux / Zustand / Jotai

We don't need them. Server state is in the DB (via RSC + Server Actions). Client state is React's built-in useState + Context. The state that needs to be global (theme) is in Context.

## When we'd revisit

- **If we add a mobile app** → we may need tRPC or a dedicated API layer.
- **If we add a separate API for partners to integrate** → we may need tRPC or REST + OpenAPI.
- **If the design system stabilizes** → we may add Tailwind for productivity.
- **If we add real-time features** → we may add Supabase Realtime or a separate WebSocket layer.
- **If the team grows past 5 agents** → we may add a monorepo tool.

For v1, the above stack is the right balance of productivity and simplicity.

## Consequences

### Positive

- **Single source of truth for tooling decisions.** No more "should we use Vitest or Jest" debates.
- **The team knows the stack.** Less context-switching, more productivity.
- **Mature, well-supported choices.** Every tool above has a large ecosystem and is unlikely to be abandoned.

### Negative

- **Lock-in.** Migrating off any of these is a project. We accept this; the tools are mature enough that we expect to use them for years.
- **Some friction.** TS strict mode, no Tailwind, etc. add upfront work. We accept this for the long-term quality.

### Mitigations

- **Document the choices** (this ADR).
- **Enforce in CI** (the right ESLint rules, the right test framework, the right linting setup).
- **Don't deviate without an ADR.** If a future PR wants to add a new tool, it needs its own ADR.

## References

- The repo conventions: `AGENTS.md`
- The TypeScript config: `tsconfig.json`
- The ESLint config: `eslint.config.mjs`
- The CI workflows: `04-platform/ci/workflows/`
- The data layer: `00-foundations/data/README.md`
