# 00-foundations/data/

The data layer. Supabase clients (server, browser, service role), generated types, and Zod schemas. This is the boundary between "the database" and "your code."

## Files

- **`schemas.ts`** — Zod schemas. The source of truth for input validation on every server action. Mirror the DB types but stricter (e.g. `price_cents: z.number().int().positive()` instead of just `number`). Also contains the canonical entity read shapes (`<Entity>EntitySchema`) for service-role reads + webhooks.
- **`enums.ts`** — TypeScript string-literal unions that mirror the Postgres enums + text CHECK constraints. **Single source of truth for status / kind / role / tier values.** Import these for any code that branches on a role / status / kind.
- **`schemas.test.ts`** — Unit tests for every schema in `schemas.ts`. Pure-function tests; runs in ~10ms with no fixtures.
- **`types.ts`** — **AUTO-GENERATED** placeholder from the database schema (via `supabase gen types typescript`). Don't hand-write. Regenerate after every migration via `pnpm db:types` (P3.7 Slice 1); CI runs this on every push to main + on every PR that touches `04-platform/migrations/**`. See the "REGENERATION CONTRACT" block at the top of `types.ts` for the bridge state until the first generated file lands.
- `mappers.ts` — DB row → domain object converters. (Planned; v1 currently has DB shapes passing through directly.)
- The Supabase client modules (`client.ts`, `server.ts`, `service.ts`) live in `supabase.ts`.

## enums.ts — the canonical enum source

Every string-literal union that mirrors a Postgres enum or a CHECK constraint lives here. Examples:

```ts
import { OrderStatus, LicenseTier, ProductKind } from '@foundations/data/enums'

if (order.status === 'paid') { /* status is `OrderStatus`, narrowed */ }

function getLicenseLabel(tier: LicenseTier) { /* … */ }
```

When a Postgres enum changes (new migration), update the enum in the migration, regenerate `types.ts`, and update the matching type here. Both the Zod schemas and the TS code import from this file, so they pick up the change automatically.

The `as const satisfies readonly T[]` pattern is used throughout the Zod schemas to keep the enum values in lockstep with the TS types:

```ts
license: z.enum(['plr', 'mrr', 'rr', 'personal'] as const satisfies readonly LicenseTier[])
```

If you add a value to `LicenseTier` but forget to add it to the `z.enum(...)` array, the `satisfies` check fails at typecheck. If you add it to the array but not to `LicenseTier`, same thing in reverse. The compile error is the source of truth.

## schemas.ts — Zod is the source of truth for input

Every server action validates its input with Zod before touching the DB. The Zod schema is the contract; the DB type is the storage.

Layout of `schemas.ts`:
1. **Primitives** — `Cents`, `Bps`, `Slug`, `Uuid`, `PhoneE164`, `CountryCode`, `SafeUrl`. The building blocks.
2. **Action input schemas** — `<Entity>Input` (e.g. `AddToCartInput`, `UpdateProfileInput`, `RefundRequestInput`). These are what every server action imports.
3. **Entity read schemas** — `<Entity>EntitySchema` (e.g. `OrderEntitySchema`, `RefundEntitySchema`). Mirror the DB row shape so a service-role read or webhook payload can be parsed + validated.
4. **WYSIWYG** — `TipTapDocSchema` for the TipTap JSON shape.

```ts
// In a server action
import { AddToCartInput } from '@foundations/data/schemas'

export async function addToCartAction(raw: FormData | Record<string, unknown>) {
  const parsed = AddToCartInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Invalid input.' }
  // parsed.data is fully typed — no more `as` casts needed
  const { product_id, license, quantity } = parsed.data
  // …
}
```

**Action-input schemas use snake_case field names** (matches the DB columns). When a caller passes camelCase (e.g. a form with `productId`), the action maps at the call site before passing to the schema. This keeps the schema layer and the DB layer in lockstep without forcing every consumer to use snake_case.

**Zod errors should be helpful.** If a field is invalid, the error message tells the user what's wrong and what to do. Generic "Invalid input" is not OK. The schema's `.min(50, 'At least 50 characters')` is the contract for the user-facing copy.

## SafeUrl — defense against javascript:/data:/vbscript: URLs

`SafeUrl` is tighter than `z.string().url()`: it accepts only `http:` and `https:` schemes. The default `.url()` validator accepts RFC 3986 URLs including `javascript:alert(1)`, `data:text/html,...`, `vbscript:msgbox(1)`, `file:///etc/passwd` — none of which we want as a stored URL that may end up in an `<a href=...>` or `<img src=...>`. Use `SafeUrl` for every URL field the user can supply.

## Running the tests

```bash
pnpm test schemas
```

Currently 173 tests covering all primitives, action inputs, and entity read schemas. The tests are pure functions (no fixtures, no DB) and run in ~10ms.

## mappers.ts — DB rows to domain objects

The DB stores things in a normalized form that's not always what the rest of the app wants to work with. Example:

```ts
// DB row: { price_cents: 49700, currency: 'USD' }
// Domain: { amount: 497, currency: 'USD' } (because we want dollars, not cents, in the UI layer)
```

Or:

```ts
// DB row: { created_at: '2026-06-12T10:30:00.000Z', duration_seconds: 3840 }
// Domain: { createdAt: Date, durationFormatted: '1h 04m' }
```

Mappers live in this file. The convention: a function `toProduct(row)` for each table, plus `toProductList(rows)` for batch operations.

When in doubt: keep the DB format. Don't transform if you don't need to. Less code = less bugs.

## enums.ts — string literal unions

Postgres enums are surfaced to TypeScript as string unions. Centralize them:

```ts
export type Role = 'customer' | 'partner' | 'affiliate' | 'admin';
export type ProductStatus = 'draft' | 'in_review' | 'published' | 'unpublished' | 'archived';
export type LicenseTier = 'whitelabel' | 'plr' | 'plr_mrr';
// ...
```

When you `if (status === 'published')`, the type system knows what `status` is. No magic strings. No typos.

If a Postgres enum changes, you update the enum in the migration, regenerate `types.ts`, and update this file to match. They're kept in sync via CI.
