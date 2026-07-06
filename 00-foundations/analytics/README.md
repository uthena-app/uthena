# 00-foundations/analytics/

The PostHog seam. Fail-open: if `NEXT_PUBLIC_POSTHOG_KEY` is empty, the client init short-circuits and `trackEvent` is a no-op. Analytics is opt-in (consent gating lands in PH11/PH12).

## Files

- **`posthog.ts`** — client-side init + tracking. `'use client'` because PostHog's browser SDK requires `window`. Exports:
  - `initPostHog()` — idempotent client init; safe to call multiple times.
  - `trackEvent(event, props?)` — loose-typed; use when you don't need compile-time safety on the props shape.
  - `trackTypedEvent<E>(event, props)` — strictly typed; props are validated against the schema for the event and dropped with a `console.warn` if they don't match.
  - `setPostHogConsent(granted)` — flip `posthog.opt_in_capturing()` / `posthog.opt_out_capturing()` based on the user's consent state.
- **`posthog-server.ts`** — server-side capture. No Node SDK dependency; uses `fetch` to PostHog's public capture endpoint so cron jobs and server actions can fire events without a browser context. P4.6 is the first consumer (`cart_abandoned`). Fail-open: empty key → no-op + warn. Exports:
  - `isPosthogServerConfigured()` — env gate. Prefers `POSTHOG_PROJECT_API_KEY`; falls back to `NEXT_PUBLIC_POSTHOG_KEY` for dev parity.
  - `hashIdentifierForPosthog(value)` — salt-applied sha256, 32 hex chars. Matches `auth/rate-limit.ts`'s `hashIdentifier` so the audit salt is the single source of truth.
  - `trackPosthogServer<E>(event, props, distinctId)` — strictly typed; props are validated against `POSTHOG_EVENT_PROPS[event]` (the same catalog the client uses), and a non-2xx or fetch error returns a typed failure (never throws).
- **`events.ts`** — the typed event catalog. `POSTHOG_EVENTS` is the source-of-truth list (47 events across 12 surfaces). `POSTHOG_EVENT_PROPS[E]` maps each event to its expected props schema. `isPostHogConfigured()` returns true when the key is set. `DEFAULT_POSTHOG_HOST` is the EU PostHog host.
- **`events.test.ts`** — 22 unit tests covering the catalog, the per-event schemas, env-gated behavior, and the default host.
- **`posthog-server.test.ts`** — 16 unit tests covering env-gated behavior, schema validation, success-path POST body shape, the API-key fallback, host override + trailing-slash handling, and the typed failure paths (non-2xx + fetch throw).

## Adding an event

1. Add the event name to `POSTHOG_EVENTS` in `events.ts`.
2. Add a matching `POSTHOG_EVENT_PROPS[<event>]` entry with the props schema (Zod).
3. The `satisfies readonly string[]` and `[E in PostHogEvent]` patterns catch drift at compile time — typecheck fails if you add to one without the other.
4. Add a happy-path + rejection test in `events.test.ts`.

## Consent gating

The seam itself does NOT enforce consent — it defers to the caller. `setPostHogConsent(granted)` is the explicit opt-in / opt-out API; PH11's consent surface wires it to the UI. The server-side seam (`posthog-server.ts`) is consent-agnostic by design — cron-fired events are operational (e.g. `cart_abandoned` is a recovery signal, not a "user did X" event) and don't require per-user opt-in.

## Why both client + server modules?

PostHog's browser SDK uses `window` + `localStorage`; the server cannot import that file. The two modules share the same event catalog (`events.ts`) and the same default host, so client-fired and server-fired events are merged into a single PostHog project. The server module is a single `fetch` call to `/capture/` with the project API key — no `posthog-node` dependency. A future swap to `posthog-node` is a one-file change inside `posthog-server.ts`.

## The default EU host

`DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com'`. Uthena processes EU-resident user data (GDPR); EU PostHog hosting is the default. The env var overrides per environment.