# Telemetry seams — cross-cutting spec

> **Source contract.** This is the cross-cutting surface for `P2.9` in
> `PHASES.md`. It defines the three external-system seams (PostHog,
> Gorse, SES) that every feature consumes indirectly through
> `00-foundations/`. Each seam is **env-gated**: with no credentials
> configured, every helper is a no-op and the app continues to ship.
>
> **Status.** P2.9 — production-grade. The seams ship typed event
> catalogs, env-gating, fail-open behavior, and test coverage. The
> actual call-site adoption lands in later phases (P16.1 for Gorse
> feedback, P11 for consent + analytics opt-in, P17 for SES
> transactional templates, etc.).

---

## What this spec covers

Three external-system integrations sit in `00-foundations/` and are
consumed by feature code:

| Seam | Folder | Direction | Failure mode |
|---|---|---|---|
| **PostHog** | `00-foundations/analytics/` | Client → PostHog | No-op if `NEXT_PUBLIC_POSTHOG_KEY` empty |
| **Gorse** | `00-foundations/recommendations/` | Server → Gorse API | Returns `[]` / no-op on any error |
| **Amazon SES** | `00-foundations/email/` | Server → SES API | Dev console log + no throw on misconfig |

Each seam is fail-open by design: a missing key, a network blip, or
a 5xx response never breaks the user-facing flow. Analytics,
recommendations, and email are *nice-to-have* — the buyer can always
browse, add to cart, and check out even if all three seams are
unconfigured.

## Why this exists

A 2026 baseline for a wholesale digital-products marketplace:

- **PostHog** is the product analytics layer. We use it to answer
  "where do users drop off in the checkout funnel?" and "which
  product cards get the most clicks?" Cookieless-by-default (opt-in
  mode), GDPR-consent-gated, EU-host (`eu.i.posthog.com`).
- **Gorse** is the open-source recommendation engine. Cold-start-
  aware (popularity fallback when no history exists), bandit-tested,
  fail-open (an empty list is a valid recommendation). We push
  feedback events (view, click, add_to_cart, purchase, signup) so
  Gorse can learn.
- **Amazon SES** is the transactional email transport. Order
  confirmations, refund notices, password resets, email verification,
  payout alerts — all run through SES in production. Dev fallback
  writes to the structured log so the developer sees every send.

The seam modules each live in their own folder so the env-gating +
fail-open contract is enforced in *one place*. Feature code never
imports `posthog-js`, `gorse-sdk`, or `@aws-sdk/client-sesv2`
directly — they go through the seam helpers.

## Env contract

Each seam reads its config from `00-foundations/env.ts`. Missing or
empty values degrade the seam to a no-op (the helper is still
callable, it just does nothing):

| Env var | Seam | Default | Behavior when empty |
|---|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog | `''` | `initPostHog()` short-circuits; `trackEvent()` no-ops |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog | `https://eu.i.posthog.com` | Only read when key is set |
| `GORSE_API_URL` | Gorse | `''` | `recommend()` returns `[]`; `trackEvent()` no-ops |
| `GORSE_API_KEY` | Gorse | `''` | Optional auth header for Gorse (omitted if empty) |
| `AWS_REGION` | SES | `''` | Falls back to dev console transport |
| `AWS_SES_FROM_EMAIL` | SES | `noreply@uthena.com` | Only read when SES is configured |
| `AWS_ACCESS_KEY_ID` | SES | `''` | Falls back to dev console transport |

The PostHog key is the only `NEXT_PUBLIC_*` (the SDK runs in the
browser). Gorse and SES are server-side; their config never ships
to the client.

## Event catalogs

Every event name + property shape lives in a typed catalog so
callers can't drift the names or types. A new event is one entry
addition; the catalog's `as const satisfies readonly string[]` +
`[E in PostHogEvent]` mapping fail typecheck when name and schema
drift apart.

### PostHog events (client-side analytics)

Defined in `00-foundations/analytics/events.ts`. `POSTHOG_EVENTS` is
the source-of-truth list (47 events across 12 surfaces: page,
auth, catalog, cart, checkout, library, partner, affiliate, admin,
lms, search, rec, gdpr). `POSTHOG_EVENT_PROPS[E]` maps each event
to its expected props schema (Zod).

Grouped by surface:

| Surface | Examples |
|---|---|
| Pages + CTAs | `page_viewed`, `cta_clicked` |
| Auth | `auth_signup_started`, `auth_signin_succeeded`, `auth_oauth_started`, `auth_email_verified`, … |
| Catalog | `catalog_product_viewed`, `catalog_product_added_to_cart`, `catalog_filter_changed`, … |
| Cart | `cart_viewed`, `cart_line_edited`, `cart_coupon_applied`, … |
| Checkout | `checkout_started`, `checkout_completed`, `checkout_payment_method_selected`, … |
| Library | `library_product_opened`, `library_download_started`, `library_stream_started` |
| Partner | `partner_dashboard_viewed`, `partner_course_published`, `partner_payout_requested` |
| Affiliate | `affiliate_dashboard_viewed`, `affiliate_link_created`, `affiliate_click_tracked` |
| Admin | `admin_customer_viewed`, `admin_refund_approved`, `admin_payout_processed` |
| LMS | `lms_lesson_started`, `lms_lesson_completed`, `lms_certificate_issued` |
| Search | `search_query_submitted`, `search_result_clicked`, `search_zero_results` |
| Recommendations | `rec_rail_viewed`, `rec_item_clicked` |
| GDPR / consent | `gdpr_consent_granted`, `gdpr_consent_withdrawn`, `gdpr_data_export_requested`, `gdpr_account_deletion_requested` |

The PostHog helper sets `opt_out_capturing_by_default: true` at init;
consent-gating (Phase 11) flips this to `opt_in` after the user
grants analytics permission.

**Two tracking helpers** ship:
- `trackEvent(event, props?)` — loose-typed; use when the event
  isn't in the catalog or the props shape is intentionally free-form.
- `trackTypedEvent<E>(event, props)` — strictly typed; props are
  validated against the schema for the event and dropped with a
  `console.warn` if they don't match. The generic `<E>` is constrained
  to `PostHogEvent` so the props shape is inferred from the schema.

### Gorse events (server-side feedback)

Defined in `00-foundations/recommendations/gorse.ts`.
`GORSE_FEEDBACK_KINDS` is the typed union: `view | click |
add_to_cart | purchase | signup`. P16.1 fires these from server
actions on the buyer's behalf (user identifier is the Supabase
auth.uid() UUID — never the email).

| FeedbackKind | When fired | Optional `value` |
|---|---|---|
| `view` | Product detail page render | `null` |
| `click` | User clicks a recommendation card | `null` |
| `add_to_cart` | Successful addToCartAction | `null` |
| `purchase` | Successful checkout completion | `line_total_cents` (weighted) |
| `signup` | Account created | `null` |

The `recommend()` helper supports three surfaces: `home`,
`product`, `library`. Returns `string[]` of product IDs (empty on
any failure). The 800 ms internal timeout is short enough to not
stall RSC streaming.

### SES events (transactional + marketing + consent + operational)

Defined in `00-foundations/email/ses.ts`. `EMAIL_CATEGORIES` is the
typed union: `transactional | marketing | consent | operational`.
Each category drives suppression list (P17.4), consent gate (P11),
and per-kind rate limits.

| Category | Examples | Opt-in required | Suppression-list exempt |
|---|---|---|---|
| `transactional` | order confirmation, password reset, email verification, payout sent | No (required by service) | Yes |
| `consent` | consent confirmation | No (required by service) | Yes |
| `operational` | security alerts, maintenance notice | No (required by service) | Yes |
| `marketing` | newsletter, promo, drip campaigns | Yes (global unsubscribe) | No |

The dev fallback (no SES configured) writes every send to the
structured log with `to`, `subject`, `id`, and `category`. The log
includes a `category` field so a dev can grep by category.

The result shape is `{ ok: boolean, id: string | null, mode: 'ses' | 'log' }`
where `mode: 'log'` means the message was emitted to the structured
log only (PH17.1 wires the real SES SDK and flips `mode` to `'ses'`).

## Per-call behavior

### PostHog

```ts
// Client component, after consent granted (P11 wires this)
import { initPostHog, trackTypedEvent } from '@foundations/analytics'

initPostHog()
// loose-typed:
trackEvent('custom_event_name', { foo: 'bar' })
// typed (props validated against the catalog schema):
trackTypedEvent('catalog_product_viewed', { product_id: '42', slug: 'x' })
```

Before `initPostHog()` runs (or after `setPostHogConsent(false)`),
both helpers silently no-op. After consent, the SDK captures +
queues.

### Gorse

```ts
// 02-features/catalog/queries.ts (RSC)
import { recommend } from '@foundations/recommendations'

const ids = await recommend({ userId: user?.id ?? null, kind: 'home', limit: 8 })
if (ids.length === 0) {
  // Fall back to the popular-products query (P16.3)
}
```

`recommend()` always returns within 800 ms (internal
`AbortSignal.timeout`). Errors are swallowed → `[]`.

```ts
// 02-features/checkout/actions/createCheckoutSession.ts (after success)
import { trackEvent as trackGorse } from '@foundations/recommendations'

await trackGorse({
  userId: user.id,
  productId: String(product.id),
  event: 'purchase',
  value: lineTotalCents,
})
```

Server-side feedback is fire-and-forget — the helper resolves once
the fetch settles (or rejects, which the helper catches). Callers
can `await` for safety but shouldn't block the user on it.

### SES

```ts
// 02-features/auth/actions.ts (after signup)
import { sendEmail } from '@foundations/email'

const result = await sendEmail({
  to: user.email,
  category: 'transactional',
  subject: 'Verify your Uthena email',
  html: renderedHtml,
  text: renderedText,
})
// result: { ok: true, id, mode: 'log' } | { ok: false, id: null, mode: 'log' }
```

The dev fallback returns `{ ok: true, id, mode: 'log' }` and logs
the message. The SES path (PH17.1) returns `{ ok: true, id, mode: 'ses' }`
on success and `{ ok: false, id: null, mode: 'ses' }` on permanent
failure (bounce, suppression list hit). The helper never throws —
callers branch on `ok`.

## Where it lives

- **`00-foundations/analytics/`** — PostHog client (`posthog.ts`,
  `'use client'`) + typed event catalog (`events.ts`) + README +
  `events.test.ts`. Server code never imports from here (Phase 18
  may add server-side tracking).
- **`00-foundations/recommendations/`** — Gorse client (`gorse.ts`)
  + `GORSE_FEEDBACK_KINDS` typed union + README + `gorse.test.ts`.
  Server-only.
- **`00-foundations/email/`** — SES client (`ses.ts`,
  `'use server'`) + `EMAIL_CATEGORIES` typed union + README +
  `ses.test.ts`. Server-only.
- **`00-foundations/env.ts`** — env schema additions for the new
  vars (already in place from Phase 0).
- **README per folder** — documents the public surface, the event
  catalog, and how to add a new event.

## Acceptance criteria

### Env gating

- [ ] When `NEXT_PUBLIC_POSTHOG_KEY` is empty, `initPostHog()` does
      not call `posthog.init` and `trackEvent()` is a no-op.
- [ ] When `GORSE_API_URL` is empty, `recommend()` returns `[]` and
      `trackEvent()` does not call `fetch` (verified via unit test
      that stubs `global.fetch` and asserts no call).
- [ ] When `AWS_REGION` or `AWS_ACCESS_KEY_ID` is empty, `sendEmail()`
      returns `{ ok: true, id, mode: 'log' }` and writes to the
      structured log instead of calling SES.

### Fail-open on network error

- [ ] Gorse `recommend()` returns `[]` when the fetch throws (network
      error, abort, 5xx, non-OK, malformed JSON). URL encoding uses
      `encodeURIComponent` (percent encoding), not
      `URLSearchParams.toString()` (form encoding) — Gorse expects
      `%20` for spaces, not `+`. Verified by
      `gorse.test.ts:142`.
- [ ] Gorse `trackEvent()` swallows all errors and never throws.
- [ ] SES `sendEmail()` returns `{ ok: false, id: null, mode: 'log' }`
      on validation failure (never a thrown exception).

### Event catalog

- [ ] `events.ts` exports `POSTHOG_EVENTS` (47 events across 12
      surfaces) + `POSTHOG_EVENT_PROPS[E]` (per-event Zod schema) +
      `PostHogEvent` union + `PostHogEventProps<E>` mapped type. The
      `as const satisfies readonly string[]` + `[E in PostHogEvent]`
      patterns catch drift between name and schema at compile time.
- [ ] Gorse `gorse.ts` exports `GORSE_FEEDBACK_KINDS` as a readonly
      array (`view, click, add_to_cart, purchase, signup`) +
      `GorseFeedbackKind` mapped type.
- [ ] SES `ses.ts` exports `EMAIL_CATEGORIES` as a readonly array
      (`transactional, marketing, consent, operational`) +
      `EmailCategory` mapped type.

### No PII in event props

- [ ] No PostHog event helper accepts `email`, `password`, `token`,
      or `secret` as a prop (the catalog schemas use `user_id_hash`,
      `coupon_id_hash`, etc. — never raw identifiers). Pino's global
      redact list (`'email', '*.email', 'password', …`) covers the
      log path.
- [ ] Gorse `trackEvent({ userId, … })` accepts only a string (the
      UUID), not an email. The userId is the Supabase auth UUID.
- [ ] SES `sendEmail()` writes `to` (the recipient address) to the
      structured log on the dev fallback. Pino's global redact list
      (`'email', '*.email'`) replaces it with `[REDACTED]` in
      production logs. In production, the SES path never logs `to`
      directly — only the `id` and `category` are logged.

### Test coverage

- [ ] `events.test.ts` covers the catalog (47 events present + no
      duplicates + snake_case shape) + the per-event schemas
      (happy paths + discriminators reject malformed input) +
      env-gated behavior + the default EU host. At least 20 tests.
- [ ] `gorse.test.ts` covers: no-url no-op, recommend happy path
      (both items[] and bare-array response shapes), recommend non-OK
      response (returns `[]`), recommend fetch error (returns `[]`),
      recommend invalid JSON (returns `[]`), URL encoding with
      `encodeURIComponent` (`%20` for spaces), X-API-Key + X-User-ID
      headers, limit default 12, trackEvent happy + error paths,
      Value field pass-through, GORSE_FEEDBACK_KINDS coverage. At
      least 23 tests.
- [ ] `ses.test.ts` covers: env-gated (region + from + access key),
      dev fallback returns `{ ok: true, id, mode: 'log' }`, fresh UUID
      per call, configured-but-SDK-pending still returns
      `mode: 'log'`, EMAIL_CATEGORIES coverage (4 values + no
      duplicates + lowercase), per-category acceptance, from /
      replyTo / tags pass-through. At least 18 tests.

### Spec + doc

- [ ] `01-specs/pages/telemetry-seams.md` (this file) is checked in.
- [ ] `00-foundations/analytics/README.md` documents the PostHog
      public surface, the event catalog structure, and how to add
      a new event.
- [ ] `00-foundations/recommendations/README.md` documents the Gorse
      public surface, the feedback catalog, and the recommend
      timeout.
- [ ] `00-foundations/email/README.md` documents the SES public
      surface, the category taxonomy (with suppression-list +
      consent rationale), and the dev fallback.

### Cross-cutting

- [ ] All 6 checks green: `pnpm typecheck && pnpm lint &&
      pnpm check:no-todo && pnpm check:pii && pnpm check:specs &&
      pnpm check:rls`.
- [ ] `pnpm test` green: existing tests + 18 SES + 20 events +
      23 Gorse = at least 61 new tests passing on the three seam
      modules.
- [ ] `pnpm build` clean (43 routes; the new modules are server-only
      + tree-shaken; no client JS regression).

## Out of scope (deferred to follow-ups)

- **Phase 11 P11.1 consent-gating** — the PostHog helper currently
  short-circuits when uninitialized (pre-consent). The actual consent
  banner UI + the `setPostHogConsent(true)` call lands in P11.1
  (granular consent UI). Until then, PostHog is effectively disabled
  by default.
- **Phase 16 P16.1 Gorse feedback call sites** — the seam exports
  `trackEvent` but the actual `addToCartAction`, `createCheckoutSession`,
  `signUpAction`, etc. don't fire it yet. P16.1 wires the call sites
  with the typed helpers from `recommendations/gorse.ts`.
- **Phase 16 P16.2 recommendation rails** — `recommend()` returns
  `string[]` of product IDs. The home / product / library rails that
  consume the IDs ship in P16.2. P2.9 ships the helper; P16.2 ships
  the consumers.
- **Phase 17 SES templates + queue + bounce handling** — the SES
  helper currently writes to the structured log in dev and warns
  in prod (no real SDK call). P17.1 wires `@aws-sdk/client-sesv2`;
  P17.2 wires the durable retry queue; P17.3 wires bounce/complaint
  handling. The `EmailMessage` shape + the category enum are stable
  from P2.9; the wire-level send is P17's job.
- **Pino redact-list deep paths** — **DONE in P2.10** (tick 2026-06-25
  11:32+07). The previous redact list used `**.email` / `**.password`
  as if pino supported a deep wildcard — pino's `**` is a silent
  no-op past depth 1 (it's a JSON-path / RFC 9535 convention, not
  pino's syntax). The previous code was leaking PII at depth 2+ in
  production logs. Fixed by `00-foundations/log/redact-paths.ts`
  (extracted single source of truth, imported by both `pino.ts` and
  the regression-guard test): enumerates depths 0–4 explicitly for
  every PII field using pino's actual syntax (`field` / `*.field` /
  `*.*.field` / `*.*.*.field` / `*.*.*.*.field`) + bracket syntax
  for top-level arrays (`[*].field`) + a few common nested-array
  patterns. 21 pino tests cover the actual behavior (was 17, +4
  new cases). See `00-foundations/log/README.md` §"The redact
  list" for the full documentation + the **DOES NOT WORK**
  callout for `**`.
- **CSP violation reporting endpoint** — the CSP can be extended
  with `report-uri` / `report-to` pointing at a PostHog (or Sentry)
  sink once the analytics event shape lands. P2.9 ships the seam;
  the CSP-violation hookup is a follow-up.
- **Sentry seam** — a 4th seam (Sentry error capture) lands in
  P18.1. The pattern is the same as P2.9: env-gated, fail-open,
  typed event helpers, test coverage.

## Open questions

None at P2.9 ship time. The consent wiring (P11.1), the call-site
adoption (P16.1, P17), and the real SES SDK (P17.1) are all
deferred to their respective phases; the seams are testable + stable
from this tick forward.