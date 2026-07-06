# `00-foundations/log/` — structured logging

> Per AGENTS.md §2: **"No PII in logs. Ever. Mask emails, redact tokens, hash IDs."** This module is the load-bearing wall for that contract.

This module ships the single shared pino instance, the redact list that enforces the PII contract at write time, the request ID middleware seam, and the typed schema every log call should follow.

## Files

| File | Purpose |
|---|---|
| **`pino.ts`** | The shared `getLogger()` singleton + the `loggerFor(context)` helper. **Every server action, route handler, webhook, and lib calls `loggerFor(...)` (not `pino()` directly).** |
| **`redact-paths.ts`** | The canonical `REDACT_PATHS` list — imported by `pino.ts` and `pino.test.ts`. Single source of truth. Generates the depth-0 to depth-4 wildcard patterns for every PII field (pino's `**` is NOT a deep wildcard — see below). |
| **`request-id.ts`** | `REQUEST_ID_HEADER` constant + `getOrCreateRequestId(headers)` middleware helper + `isValidRequestId(value)` validator. Pure, no side effects. |
| **`schema.ts`** | The structured log schema: `LOG_EVENTS`, `LogActor`, `LogSubject`, `LogContext`, `LogEntry`, plus Zod schemas for each. The contract every log call should follow. |
| **`pino.test.ts`** | Redact-list regression guard. Pino's SonicBoom bypasses `stdout` spies — tests use an in-memory `Writable` stream. Imports the same `REDACT_PATHS` the production config uses, so the test catches any drift. |
| **`request-id.test.ts`** | UUID validation + middleware seam tests (incoming header, garbage rejection, fresh UUID mint). |
| **`schema.test.ts`** | Zod schema coverage for `LogActor`, `LogSubject`, `LogContext`, `LogEntry`. |
| **`README.md`** | This file. |

## The structured schema — `event` / `actor` / `subject` / `context`

Every `log.info | log.warn | log.error` call should pass an object matching:

```ts
{
  event: LogEventName,           // canonical verb, machine-readable (required for info/warn/error)
  actor?: LogActor,              // who did it (default to { kind: 'system' } when no human)
  subject?: LogSubject,          // what was acted upon (optional for events without a target)
  context: LogContext,           // request-scoped metadata (component is REQUIRED)
}
```

**Why typed events?** The 60+ event names in `LOG_EVENTS` are the contract Phase 17 (email send log), Phase 14.18 (admin audit-log search), and Phase 18.6 (PostHog dashboards) consume. Adding a new event name reserves it across the whole pipeline — `pnpm typecheck` fails if you call `log.info({ event: 'banana.smoothie' })` with a name not in the catalog.

**Adding a new event?** Add it to `LOG_EVENTS` in `schema.ts`, write the call site, ship the consumer in a follow-up phase. The catalog is the single source of truth.

## The request ID middleware

The root `middleware.ts` mints a fresh `x-uthena-request-id` (UUID v4) for every request that doesn't carry one (e.g. an upstream proxy or load balancer set one for cross-hop correlation). The ID is forwarded to downstream handlers AND echoed on the response.

Server actions + route handlers + RSCs pick it up via `loggerForRequest(await headers(), { component: 'cart.addToCart' })`. The helper reads `x-uthena-request-id` from the headers, validates it's a canonical UUID, and binds it as `req_id` on the pino child logger.

```ts
'use server'
import { headers } from 'next/headers'
import { loggerForRequest } from '@foundations/log/pino'
import { LogActorSchema, LogContextSchema } from '@foundations/log/schema'

const log = loggerForRequest(await headers(), { component: 'cart.addToCart' })

export async function addToCartAction(input: AddToCartInput) {
  log.info({
    event: 'cart.added',
    actor: { kind: 'user', user_id: input.userId },
    subject: { kind: 'cart_line', cart_id: input.cartId, product_id: input.productId, license: input.license },
    context: { component: 'cart.addToCart', duration_ms: 12 },
  }, 'cart line added')
  // ...
}
```

**Why a header (not AsyncLocalStorage)?** Middleware runs on the Edge runtime; server actions run on the Node runtime. Sharing `AsyncLocalStorage` across runtimes requires a runtime boundary contract that doesn't exist for free in Next.js 15. A header is the simplest transport. It's also useful for client-side correlation: an error toast can show the request ID so support can grep the logs.

## The redact list — PII enforcement at write time

The canonical redact list lives in `redact-paths.ts`. It is generated
programmatically by enumerating depths 0–4 for every PII field — see
the header comment there for the pino wildcard syntax + the depth
enumeration rationale. The list is imported by both `pino.ts` (the
production config) and `pino.test.ts` (the regression guard), so the
test catches any drift at the next typecheck run.

**Pino's actual wildcard syntax** (from `@pinojs/redact`):

| Pattern | Matches |
|---|---|
| `field` | top-level field only |
| `*.field` | depth 1 (any property name) |
| `*.*.field` | depth 2 |
| `*.*.*.field` | depth 3 |
| `*.*.*.*.field` | depth 4 |
| `[*].field` | top-level array element |
| `users[*].field` | nested array under the `users` key |
| `**.field` | **DOES NOT WORK** — pino's `**` is a silent no-op |

The list covers all PII fields at depths 0–4 + the top-level array
pattern `[*]`. Nested arrays under arbitrary property names are NOT
covered exhaustively (pino's wildcard `*` does not match array
indices when applied to an object containing an array). The
pragmatic defense: keep PII at known shallow depths in the
structured log contract (`schema.ts`).

**PII fields covered (all at depths 0–4 + top-level array):**

| Field | Purpose |
|---|---|
| `email` | emails |
| `password` | passwords |
| `token` | opaque tokens |
| `access_token` | OAuth access tokens |
| `refresh_token` | OAuth refresh tokens |
| `cookie` | session cookies |
| `secret` | API secrets |
| `apiKey` | API keys |
| `card` | payment card numbers |
| `ssn` | SSN-shaped numbers |
| `authorization` | HTTP authorization header (top-level) |
| `headers.authorization` | HTTP auth header (nested under `headers`) |
| `headers.cookie` | session cookie (nested under `headers`) |
| `stripe.signature` | Stripe webhook signatures (literal path) |

**User content fields covered (depths 0–2 + top-level array):**

| Field | Purpose |
|---|---|
| `message` | free-form user messages |
| `description` | free-form descriptions |
| `bio` | profile bios |

**Adding a new PII path?** Add the field name to the `PII_FIELDS`
constant in `redact-paths.ts` — the depth enumeration happens
automatically. Run `pnpm test pino` to confirm the regression guard
catches it (a new test case for the new field is worth adding to
`pino.test.ts`).

**What does NOT get redacted?** `user_id` (UUID), `email_hash`
(SHA-256 hex), `ip_hash` (SHA-256 hex), `req_id` (UUID),
`product_id`, `order_id`, `cart_id`, `partner_slug`,
`affiliate_slug`. These are the correlation keys the audit-log
search (P14.18) needs.

## Why pino, not winston / bunyan

- **Performance.** Pino's throughput is ~5× winston's at our log volume.
- **Structured-by-default.** JSON output, no string formatting tricks.
- **Redact at write time.** Other libraries need a wrapper or a transport.
- **Edge runtime compatibility.** Pino works in both Edge and Node runtimes.

## What does NOT go in this module

- **Per-feature loggers.** Cart's `cart.addToCart` logger is owned by the cart feature; it just calls `loggerFor({ component: 'cart.addToCart' })`. The shared instance is the only thing here.
- **Request-scoped state.** AsyncLocalStorage is intentionally avoided (see above). The header transport is the contract.
- **Audit-log writes.** The `audit_log` table writes happen in the admin / partner / affiliate action handlers — this module only owns the structured logging surface.

## Migration status (P2.10)

- New structured schema documented + Zod-validated.
- New `loggerForRequest()` helper shipping.
- Request ID middleware live in the root `middleware.ts`.
- Redact list now has a regression guard test.
- Existing call sites (`loggerFor({ component: 'cart.addToCart' })`) keep working unchanged — `loggerForRequest` is additive.

Future phases will adopt `loggerForRequest` + the structured `event/actor/subject/context` shape as they migrate their action handlers. The 134 existing `loggerFor` call sites are fine as-is for now (they have `component`, just no `event` yet).