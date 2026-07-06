# 02-features/

Feature modules. The middle layer of the architecture — between shared foundations and thin pages. Each feature is a self-contained vertical slice: components, server actions, queries, tests, README.

## The feature module pattern

A feature module is a folder that owns everything related to one user-facing capability. The feature is **self-contained**: it can be deleted without breaking other features (assuming the foundations it depends on still exist).

### Standard structure

```
02-features/[name]/
├── README.md                    ← what this feature is, who owns it, how it works
├── index.ts                     ← public exports (the only file other features should import)
├── components/                  ← UI components specific to this feature
│   ├── ProductCard.tsx
│   ├── ProductGrid.tsx
│   └── ...
├── actions/                     ← server actions ('use server')
│   ├── createOrder.ts
│   ├── updateCart.ts
│   └── ...
├── queries/                     ← server-side data fetching functions
│   ├── getProducts.ts
│   ├── getProduct.ts
│   └── ...
├── schemas/                     ← Zod schemas (input validation, also useful for forms)
│   ├── product.ts
│   ├── order.ts
│   └── ...
├── types.ts                     ← feature-specific types (extends database types where needed)
├── tests/                       ← unit + integration tests
│   ├── actions/
│   ├── components/
│   └── ...
└── e2e/                         ← Playwright e2e tests (if user-facing)
    ├── happy-path.spec.ts
    └── ...
```

### The contract: index.ts is the public API

```ts
// 02-features/catalog/index.ts
export { ProductCard, ProductGrid, CatalogFilters } from './components';
export { getProducts, getProduct } from './queries';
export { createOrder } from './actions';
export type { Product, ProductFilters } from './types';
```

Other features and the `03-app/` pages can only import from `02-features/catalog/index.ts`. **Never** reach into `02-features/catalog/components/ProductCard.tsx` directly from another feature.

This rule has teeth:
- ESLint rule `@uthena/no-cross-feature-internals` enforces it
- If a feature needs to use another's internal, request the export (open a PR against the feature's `index.ts`)
- Code review rejects imports that bypass `index.ts`

Why? It lets us:
- Refactor internals freely (rename, restructure, split files)
- Mock a feature wholesale in tests (`vi.mock('02-features/checkout')`)
- See at a glance what a feature exposes

## The ownership rule

Each feature is owned by **one agent at a time**. The owner has exclusive write access to the feature folder.

- A new agent can request a feature by asking the human
- A reviewer can READ the feature but not write to it
- If two features need the same change, the change goes in `00-foundations/` (or a new shared file there) — not in one feature reaching into the other

### Concurrent work in the same feature

Impossible by design. If two PRs both touch `02-features/checkout/`, one is the owner, the other is the reviewer or the human. They serialize.

## How features depend on each other

`02-features/checkout/` depends on `02-features/catalog/` (to get the products being purchased). It imports via `02-features/catalog/index.ts` only. It does NOT modify `02-features/catalog/` — if the checkout flow needs a new field on `Product`, the change happens in the catalog feature in its own PR.

**Dependency graph** (current state; names match the folders in this directory):
- `auth` ← everyone
- `catalog` ← `product`, `checkout`, `library`, `affiliate-portal`
- `product` ← `checkout`, `library`
- `checkout` ← `library`
- `library` — includes the vault (`/library/vault` is a page within this feature, not a separate feature)
- `partner-portal` ← `admin`
- `affiliate-portal` ← `admin`
- `admin` ← (top of stack, depends on everything)

Keep the graph shallow. Avoid deep chains. If feature A → B → C → D, consider pulling the shared abstraction into foundations.

## How features use foundations

`02-features/catalog/queries/getProducts.ts` imports from `00-foundations/data` (Supabase client) and `00-foundations/auth` (session). It does NOT define its own DB client. It does NOT have its own session helpers. Foundations are the only place these exist.

If a feature finds itself wanting to import a Supabase client directly, it should add the import to its own module (not redefine the client) — but the import should come from `00-foundations/data`, not `@supabase/supabase-js`.

## File size and split rules

- A component file is too long if it has more than ~300 lines. Split into subcomponents.
- A server action file is too long if it does more than one thing. Split.
- A queries file is too long if it has more than ~5 related queries. Split.
- A test file is too long if it's more than ~500 lines. Split by behavior.

The rule of thumb: **if you can't describe what the file does in one sentence, split it.**

## Testing a feature

- Every server action has at least 3 tests: happy path, validation error, permission error
- Every component has at least 1 visual test (or screenshot test for non-trivial UI)
- Every user flow has at least 1 e2e test
- Tests are colocated next to the code they test (`ProductCard.test.tsx` next to `ProductCard.tsx`)

## Documentation: the feature's README

Every feature module has a `README.md` that explains:
1. What this feature does
2. Who owns it (which agent / which spec)
3. What it depends on (foundations + other features)
4. What depends on it (who imports from its `index.ts`)
5. How to test it locally
6. Open issues / follow-ups (links to `01-specs/pages/_followups.md`)

The README is the first thing a new agent reads when picking up the feature. Keep it current.

## Adding a new feature

1. Write the spec first (`01-specs/pages/[name].md`). No spec → no code.
2. The spec is reviewed and approved by the human.
3. The owner agent creates the feature folder structure.
4. The owner writes components, actions, queries, schemas, types, tests.
5. The owner opens a PR with all of the above.
6. A reviewer (different agent) checks the spec compliance, security, design system adherence, tests, no TODOs.
7. The human approves the PR after seeing the screenshot.
8. CI runs, PR merges, the feature is live.

The "owner" is the agent who first implemented the feature. If the team grows, ownership can transfer — but only with a recorded handover (update the README's "Owner" section).

## Feature retirement

When a feature is no longer needed:
1. Remove the feature folder (move to `07-archive/[date]_[name]/`)
2. Remove all imports of that feature from other features and from `03-app/`
3. Remove the data model if it was feature-specific (migration)
4. Document the retirement in `07-archive/[date]_[name]/RETIRED.md` (why, when, what replaced it)
