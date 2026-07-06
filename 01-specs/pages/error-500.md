# 500 Server Error — `/500` (route-level error)

## What this page does

The route-level "server error" page. Renders when an RSC throws an unhandled exception, when a route handler returns 500, or when a server action throws. This is the **last-line** user-facing UI for any unhandled error in the app — the global error boundary.

The page shows: a "Something went wrong" headline, a one-sentence reassurance ("We've been notified and are looking into it"), an **opaque error reference ID** (cryptographically random, ~10–12 chars base-32) that the user can quote when contacting support, a "Try again" button (reloads the current URL), a "Go home" secondary link, and a "Contact support" mailto link. The page is public, RSC + SSR, and ships minimal client JS.

This page **MUST NOT leak** the stack trace, the failing query, the `user_id`, the request body, or any PII to the visitor. Sentry captures the details server-side; the page shows only the opaque error ID. Even the error ID is meaningless without our internal Sentry access — it is a correlation key for support staff, not a PII vector.

In **maintenance mode** (a flag set by admin via the admin-settings page), this page is replaced by the maintenance page — see Open Questions §1 for the spec decision (separate spec or in this spec).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Hero | warning icon + "Something went wrong" | hard-coded | H1, mid-size |
| Subhead | "We've been notified and are looking into it. Please try again in a moment." | hard-coded | muted paragraph |
| Reference card | "Reference: ERR-{id}" formatted as `ERR-` + 10–12-char base-32 random ID (e.g. `ERR-7F2K9P4QX3A`) | generated on error (see Security) | mono card, copyable |
| Primary CTA | "Try again" → reloads `window.location.href` | client-side handler | primary button |
| Secondary CTA | "Go home" → `/` | hard-coded link | secondary text link |
| Tertiary CTA | "Contact support" → `mailto:support@uthena.com?subject=Error%20ERR-{id}` | hard-coded + injected ID | mailto link |
| Footer | "Your data is safe. We never display account details on this page." | hard-coded | small muted text |

**Server load:** none. The page is fully static. The error ID is generated on the server when the error is caught (by the global error boundary), passed to the page as a prop, and the page renders the rest as hard-coded copy.

**Critical constraint: NO error details are reflected back to the user.** The error message, the failing component name, the database query, the user_id, the IP, the user agent — none of these are on the page. The reference ID is the **only** piece of error context the user sees, and it is opaque.

**Sentry capture:** every render of this page emits a Sentry event with the full error stack, the request context, the user (if authed — Sentry attaches the user context), and the reference ID. Support staff can look up the Sentry event by the reference ID and see the full diagnostic.

**Maintenance mode:** when the admin sets `admin_settings.maintenance_mode = true` (see Open Questions §1), this page is replaced by a maintenance page. The maintenance page is a separate concern — see the open question for whether to spec it in this doc or in a follow-up.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Trigger an unhandled error in any RSC / route handler / server action | Renders the 500 UI with HTTP status 500 | public |
| Try again | Click "Try again" | Reloads the current URL (the same request that just failed) — useful if the error was transient | public |
| Go home | Click "Go home" | Navigate to `/` | public |
| Copy reference ID | Click copy icon next to `ERR-{id}` | Code copied to clipboard, toast confirms | public |
| Email support | Click support mailto | Opens mail client pre-filled with `?subject=Error ERR-{id}` | public |

## What this page does NOT do

- No stack trace, no error message, no failing component name, no database query, no PII (this is the **critical** constraint — see Security)
- No "report this error" web form (mailto is the v1 channel; the error ID is the correlation key)
- No automatic retry (the user clicks "Try again" explicitly; we do not auto-reload)
- No "this is a known error" cache (every 500 is fresh; a transient DB blip produces a fresh 500 with a fresh ID)
- No login prompt (a 500 should not feel like a paywall)
- No live chat widget (the page is for humans to copy the error ID and email support)
- No third-party widgets
- No Sentry client-side error reporting (the error is already captured server-side)
- No Sentry event ID in the user-facing message (the `ERR-{id}` we show is a Uthena-generated correlation key, NOT the Sentry event ID — see Security for why)

## Acceptance criteria

- [ ] Page is publicly accessible; no auth required
- [ ] The route-level `error.tsx` file exists at the app root (`03-app/error.tsx`) and is registered with Next.js as the global error boundary
- [ ] An unhandled error in any RSC, route handler, or server action renders the 500 UI with HTTP status 500 (not 200, not 404)
- [ ] The page shows: "Something went wrong" headline, the reassurance subhead, the `ERR-{id}` reference, "Try again" button, "Go home" link, "Contact support" mailto link
- [ ] The `ERR-{id}` is a cryptographically-random 10–12-char base-32 string (e.g. `7F2K9P4QX3A`); generated once per error render; collision probability is negligible at the volume we expect
- [ ] The page does NOT contain: the stack trace, the error message, the failing component name, the database query, the `user_id`, the user's email, the request body, the IP, the user agent, or any other PII
- [ ] Every render of this page emits a Sentry event with the full error context (stack, request, user if authed) AND the `ERR-{id}` as a tag, so support can correlate the user's quote with the Sentry event
- [ ] "Try again" reloads the current URL via `window.location.reload()` (or `window.location.href = window.location.href`)
- [ ] "Go home" routes to `/`; "Contact support" mailto is pre-filled with `?subject=Error ERR-{id}` (URL-encoded)
- [ ] The page is RSC + SSR; no ISR; every 500 is fresh
- [ ] No `TODO` / `FIXME` in the diff
- [ ] No client-side JS is shipped for the page beyond the "Try again" handler (verify via the Next.js bundle analyzer — < 2 KB)
- [ ] Maintenance mode: when `admin_settings.maintenance_mode = true`, the 500 page is replaced by the maintenance page (route decides which to render — see Open Questions §1)

## Design reference

- Mockup: not yet built — to be created during the error-pages feature build
- Components: `00-foundations/ui/ErrorHero.tsx` (warning icon + headline + subhead), `00-foundations/ui/ReferenceCodeCard.tsx` (reused from `account-refund-sent.md`, with a copy-to-clipboard button), `00-foundations/ui/CTAStack.tsx` (reused from `error-404.md`)
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (default) + light

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** N/A — no DB access
- **PII displayed:** **NO.** This is the single most important constraint on this page. The page must never leak: the error message, the stack trace, the failing component name, the database query (including table names or column names), the `user_id`, the user's email, the request body, the request IP, the user agent, the auth token, or any other piece of request context.
- **PII in URLs:** the URL is whatever the user was visiting when the error fired. The page does NOT echo the URL back to the user. We do not include "you were trying to visit `/account/refund/foo`" because that would leak internal route shapes to an attacker. The user knows what URL they were on; the support team has it in Sentry.
- **Sentry event ID vs Uthena error ID.** Sentry assigns its own event ID to every captured exception. We **do not** show the Sentry event ID to the user — Sentry event IDs are 32-char hex strings that look like UUIDs and could be confused with `user_id` values. Instead, we generate our own `ERR-{id}` and tag the Sentry event with it. Support staff can search Sentry by the Uthena tag to find the matching event. This is a deliberate decision to keep the user-facing ID short and human-readable, and to avoid leaking any system-internal identifier.
- **Sentry PII handling.** Sentry is configured to scrub known PII fields (`email`, `password`, `authorization`, `cookie`, `token`) from the request context before the event is sent. The user's auth state (logged-in or anon) IS attached (Sentry's user context), but the user's email is **not** sent in the request body. This is the standard Sentry config; verify it in the CI security scan.
- **Open redirect:** N/A — no redirects
- **CSRF:** N/A — no state-changing actions
- **Rate limiting:** standard edge rate limit. If a specific IP triggers > 100 500s in 5 minutes, the edge layer returns a 429 (or a static "please slow down" page) instead of rendering the 500 page. The 500 page is for legitimate transient errors, not for amplifying abuse.
- **Audit logged:** **YES** — every 500 render emits a Sentry event AND a row in `admin_audit_log` with `action='server_error', target_id=<ERR-id>, after={url_path, error_class}`. The `error_class` is the exception class name (e.g. `DatabaseConnectionError`) — safe to log. The full error message and stack are in Sentry, not in `admin_audit_log`, to keep the audit log scannable.
- **Email injection / header injection:** N/A — no emails sent from this page. The mailto link is a static template; the `ERR-{id}` is a server-rendered base-32 string (alphanumeric, URL-safe).
- **Maintenance mode flag:** the maintenance flag is read from `admin_settings` (per the proposed schema in `dmca.md` Open Q §2). When `maintenance_mode = true`, the route renders the maintenance page instead. The flag is admin-only-write, public-read (a public read of a boolean is fine).
- **Third-party scripts:** Sentry SDK (server-side only — the Sentry client-side JS is NOT loaded on the 500 page because the page is meant to be minimal). No other third-party scripts.

## Performance

- **Target p95:** < 200ms (fully static page, no DB, no auth, no Sentry call before render — Sentry capture is async and non-blocking)
- **Render strategy:** RSC + SSR. The page is rendered on every error. **No ISR** — every 500 is fresh.
- **Cache:** the page is **not cached** at the edge. Each request is a fresh render.
- **Sentry capture timing:** Sentry capture is **synchronous** in the error boundary (we call `Sentry.captureException` before rendering), but Sentry's network call is async and non-blocking. The error boundary renders the page immediately; the Sentry event is sent in the background. If Sentry is down, the page still renders — the user does not see a different experience.
- **DB load:** zero on the page itself. The `admin_audit_log` insert is a single row; the error-classification index is a PK lookup; not on the hot path.
- **Bundle size budget:** < 2 KB added to client bundle (the "Try again" button handler). The rest of the page is HTML.
- **Image loading:** N/A — no images on this page

## Out of scope for v1

- "Report this error" web form (mailto is the channel)
- Automatic retry (user clicks "Try again" explicitly)
- "Known error" cache
- A Sentry-status widget ("our error tracker is having issues too — try again later")
- Themed 500 pages for major holidays
- A "what to do next" guide for the user (the page is intentionally minimal; the support team handles follow-up)

## Open questions for human

1. **Maintenance page — separate spec or in this spec?** The brief says "in maintenance mode, this page is replaced by the maintenance page — flag in Open Questions whether the maintenance page is the same as 500 or a separate spec." My recommendation: **separate spec** (`maintenance.md`, route `/maintenance` or a global render-conditional). Reasons: (a) the maintenance page is a different shape (it's a status message, not an error; there's no error ID, no "try again"), (b) the maintenance page is the **expected** response during a planned outage, not the failure response, and (c) the maintenance page is a marketing/communication surface that the human may want to update without re-shipping the 500 spec. The 500 spec is the **error** surface; the maintenance spec is the **status** surface. Confirm separate spec.
2. **`ERR-{id}` length and alphabet.** I propose 10–12 base-32 characters (alphabet `0-9A-Z` minus `0`, `1`, `I`, `O` for human-readability). At 10 chars, the entropy is ~49 bits — collisions are negligible at any plausible error volume. Alternative: shorter (6–8 chars) for easier phone-quoting, longer (16 chars) for paranoid entropy. Confirm 10–12.
3. **Should the `ERR-{id}` be logged to the URL (e.g. `/500?ref=ERR-7F2K9P4QX3A`)?** Pros: support can pull the URL from the user's email. Cons: leaks the error ID into the address bar, into browser history, into analytics, into referer headers. My recommendation: **do NOT include the ID in the URL**. The user copies the ID from the on-page card. The mailto subject includes the ID. Confirm.
4. **HTTP status code: 500 or 503?** A 500 says "the server failed" (the user's fault? no, our fault). A 503 says "the server is unavailable" (often used for maintenance). My recommendation: **500** for unhandled errors, **503** for maintenance mode (the maintenance spec will use 503). Confirm 500.
5. **Sentry user context for anon users.** When an anon user hits a 500, do we attach a Sentry user context (with a generated anonymous ID) or skip it? My recommendation: **attach a generated anonymous ID** (a session-scoped UUID, not persisted) so Sentry can group related errors from the same anon session. This is not PII (it's not tied to the user's auth state). Confirm attach.
6. **Rate limit on 500 renders.** If a misbehaving client triggers thousands of 500s (e.g. an attacker probing for stack traces), the edge layer should return a 429 instead of rendering the 500 page repeatedly. My recommendation: **yes, edge-level 429 after > 100 500s from one IP in 5 minutes**. This is a Cloudflare / Vercel config, not a code change. Confirm the threshold.

---

## Implementation notes

- **P0.23 tick — 2026-06-24.** The route-level error boundary was
  previously shipped (P0.21) with full inline styles. P0.23 refactored
  it to a token-only CSS module (`app/error.module.css` — same inode
  in `03-app/`). The page is a `'use client'` component (required for
  `reset()` + the copy-to-clipboard handler), uses the `Button`
  primitive for Try again / Go home / Contact support, and renders the
  `ERR-{id}` reference card with a working Copy button (with the
  "Copied" affordance for 1.6 s). Zero inline `style="` attributes on
  the rendered HTML (when the boundary fires).
- **`console.error` PII hygiene.** The `useEffect` log is now
  `[error-boundary] <errId> <error.name>` — the error **message**
  (which often contains URLs, user input, or PII-flavored fragments)
  is no longer logged. The `error.name` (e.g. `DatabaseConnectionError`)
  is safe to log and gives support enough to start triage.
- **Inherits the Organization JSON-LD** from the root layout (since
  the root layout is still intact when `app/error.tsx` renders).
- **P2.11 tick — 2026-06-25.** Sentry capture seam wired.
  `app/error.tsx` now calls `captureError(error, { surface: 'app.error',
  errId })` from a `useEffect`. The seam (`00-foundations/observability/
  sentry.ts`) is env-gated on `SENTRY_DSN`; in dev (or when the DSN is
  empty) it writes the PII-safe structured event to pino with
  `event: 'server.error'`. When the DSN is set, it ALSO logs a
  `sentry.configured_but_sdk_not_wired` warning so support can see
  when the env is set but the SDK hasn't shipped (catches a future
  regression where the SDK is wired but the warning is removed).
  Full Sentry SDK init lands in PH18 — the call-site contract stays the
  same, only the transport changes. The shared ERR-{id} generation +
  WarnGlyph + RouteError pattern lives in `00-foundations/ui/error/`
  (extracted from the P0.23 duplicates). Tick this criterion when
  PH18 ships; the seam is in place so the only remaining work is the
  SDK init in `04-platform/observability/sentry.ts`.
- **Per-route boundaries (P2.11).** Six per-route error.tsx files ship
  in P2.11 alongside this root-level one: `app/{account,admin,partner,
  affiliate,library,checkout}/error.tsx`. Each is a thin wrapper around
  the shared `RouteError` client component with a route-specific
  `surface` tag + headline + lede + helper text. They render INSIDE
  the route's layout (so the shell chrome stays visible) — better UX
  than being kicked to the root 500 page mid-task. Each calls the same
  `captureError` seam with its own `surface` so support can filter the
  event stream by surface.
