# Global Error — root layout crash boundary

## What this page does

The **last-line** user-facing UI for any error that crashes even the root
`app/layout.tsx`. Renders when an unhandled exception fires from the root
layout, the root error boundary (`app/error.tsx`), or a server component so
deep in the tree that the entire request fails.

This is the **third** error boundary tier:

1. `app/not-found.tsx` — 404 (route or `notFound()` from RSC).
2. `app/error.tsx` — route-level 500 (any error a route throws, including
   from server actions). Renders inside the root layout (SiteHeader +
   SiteFooter + global scripts intact).
3. `app/global-error.tsx` — **this page.** Renders in place of the root
   layout. **SiteHeader, SiteFooter, and all global chrome are gone.**
   The user sees a minimal "Something went wrong" surface with only what
   can be salvaged without the root layout.

The page must:

- Include its own `<html>` and `<body>` tags (Next.js requirement — the
  root layout is gone, so the document structure must be rebuilt).
- Render even if every other page in the app fails to compile.
- Be a client component (`'use client'` at the top).
- Show an opaque error ID, a "Try again" button (calls `reset()`), and a
  "Go home" link.
- Leak nothing: no stack trace, no error message, no user_id, no email,
  no IP, no PII.
- Be **lightweight** — no JS framework surface beyond the "Try again"
  handler. CSS module bundled at build time is acceptable (Next.js ships
  the CSS file with the page even when the root layout is replaced).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Headline | "Something went wrong" | hard-coded | H1, mid-size |
| Subhead | "The page failed to load. Please try again or head back home." | hard-coded | muted paragraph |
| Reference card | "Reference: ERR-{id}" formatted as `ERR-` + 10-char base-32 random ID | generated client-side once per mount | mono card |
| Primary CTA | "Try again" → calls `reset()` | client handler | primary button |
| Secondary CTA | "Go home" → `/` | hard-coded link | secondary button |

**No structured data, no Organization schema, no BreadcrumbList.** The
root layout's `<JsonLd>` was lost when the layout crashed; this page
intentionally does not try to re-add it (the user's session might be in
an inconsistent state, and emitting a partial structured-data payload
would do more harm than good).

**Server load:** none. The page is fully self-contained — it loads no
data, calls no API, and renders the same UI regardless of what failed
upstream.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Root layout, root error boundary, or any unrecoverable error | Renders this minimal surface with HTTP status 500 | public |
| Try again | Click "Try again" | Calls Next.js `reset()` to re-attempt the render of the same route | public |
| Go home | Click "Go home" | Navigate to `/` (the only chrome still working) | public |

## What this page does NOT do

- No SiteHeader, SiteFooter, SearchOverlay, MobileNav, or any other
  global component. The root layout is gone.
- No structured data, no Organization schema. The user is in an
  unrecoverable error state.
- No "Copy reference ID" button (the `navigator.clipboard` API depends
  on a secure context that may not be present when the root layout
  crashes). Reference is text — users can select-and-copy.
- No "Contact support" mailto (the error ID is rendered for support
  correspondence, but the mailto link adds bytes for marginal value; the
  reference card is enough).
- No stack trace, no error message, no PII. Critical constraint — same
  as `error.tsx`.
- No Sentry client-side error reporting (the Sentry SDK is in the root
  layout; this page does not import it).
- No third-party scripts.
- No login prompt (a 500 should not feel like a paywall).
- No maintenance mode integration (the admin-settings flag is read in
  the root layout; this page is the fallback when the root layout fails).
- No styling from `globals.css` (the root layout's `<link>` is gone).
  Self-contained CSS module only.

## Acceptance criteria

- [ ] `app/global-error.tsx` exists and is registered with Next.js as
      the global error boundary
- [ ] The page is a `'use client'` component (required by Next.js for
      `global-error.tsx`)
- [ ] The page includes its own `<html lang="en">` and `<body>` tags
- [ ] An unrecoverable error in the root layout, root error boundary,
      or any deeply-nested server component renders this UI
- [ ] The HTTP response status is 500
- [ ] The page shows: "Something went wrong" headline, the subhead, an
      `ERR-{id}` reference, "Try again" button, "Go home" link
- [ ] The `ERR-{id}` is a cryptographically-random 10-char base-32 string
      generated once per mount (same alphabet + entropy as `error.tsx`)
- [ ] "Try again" calls the `reset()` function passed by Next.js
- [ ] "Go home" routes to `/`
- [ ] The page does NOT contain: stack trace, error message, failing
      component name, database query, user_id, email, request body, IP,
      user agent, or any PII
- [ ] The page does NOT import SiteHeader, SiteFooter, SearchOverlay,
      MobileNav, or any other global chrome
- [ ] The page is self-contained — works even when the root layout's
      CSS, JS, and fonts fail to load
- [ ] The page uses design tokens only (no inline colors, no magic
      pixel values) — but tokens resolve via CSS module bundled at
      build time, not via the root layout's `<link>` tag
- [ ] No `TODO` / `FIXME` / `HACK` in the diff
- [ ] Client JS bundle stays under 2 KB
- [ ] The page renders in dark mode by default (no theme switcher —
      chrome is gone)

## Design reference

- Mockup: not yet built — minimal surface, follows the existing
  `app/error.tsx` design language at half the visual weight.
- Components: `app/global-error.module.css` (token-only CSS module)
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (only — light theme support would require duplicating
  the entire design system in this page)

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** N/A — no DB access
- **PII displayed:** **NO** — same critical constraint as `error.tsx`
- **PII in URLs:** the URL is whatever the user was visiting when the
  error fired. The page does NOT echo it back.
- **Open redirect:** N/A
- **CSRF:** N/A — no state-changing actions
- **Rate limiting:** the standard edge rate limit applies (this page
  uses no resources; rate-limiting is purely a Cloudflare / Vercel
  config concern)
- **Audit logged:** the upstream error is logged to Sentry (when the
  SDK is available — root layout crash may prevent this). This page
  itself emits no logs. Acceptable trade-off — Sentry is the source of
  truth for unrecoverable errors.
- **Third-party scripts:** NONE. The root layout's analytics + Plausible
  tags are gone.

## Performance

- **Target p95:** < 200ms (the page is fully static; no DB, no auth)
- **Render strategy:** RSC + SSR. Every request that lands here is fresh.
- **Cache:** the page is **not cached** at the edge (each render is
  unique to the failed request)
- **DB load:** zero
- **Bundle size budget:** < 2 KB added to client bundle (the "Try
  again" handler). The CSS module is bundled separately and is ~1 KB
  gzipped.
- **Image loading:** N/A — no images
- **Font loading:** the page declares `system-ui, sans-serif` fallback
  in case the root layout's `<link>` to `next/font` is broken. Uses
  `var(--font-display)` etc. when available, falls back gracefully.

## Out of scope for v1

- "Copy reference ID" button (clipboard API may be unavailable in this
  context)
- "Contact support" mailto (reference card is enough)
- Sentry client-side capture (the SDK is gone with the root layout)
- Light theme support (root layout chrome is gone)
- Re-attempt with exponential backoff (the user clicks "Try again"
  explicitly)

## Open questions for human

1. **Should `global-error.tsx` attempt to render the error ID via the
   URL (`?ref=ERR-{id}`) so support can pull it from the user's email?
   **My recommendation:** **no** — same trade-off as `error.tsx` Q3.
   Leaking the ID into the address bar / browser history / referer
   headers outweighs the convenience. Confirm no URL exposure.

---

## Implementation notes

- **P0.23 tick — 2026-06-24.** New file `app/global-error.tsx` (same
  inode in `03-app/`) + `app/global-error.module.css` (token-only;
  self-contained — no external CSS dependency since the root layout
  may be gone). The page is a `'use client'` component, includes its
  own `<html lang="en">` + `<body>` tags, generates an `ERR-{id}`
  reference (same base-32 alphabet + entropy as `app/error.tsx`),
  and renders Try again + Go home buttons (defined locally — the
  `Button` primitive is in `00-foundations/ui/primitives/Button.tsx`
  which is bundled at build time, so it works without the root
  layout, but the page inlines two local button classes for safety
  in case the bundler chokes on the import chain).
- **No "Copy reference" button on this page** — the `navigator.clipboard`
  API depends on a secure context that may not be present when the
  root layout crashes. The reference is selectable text.
- **No "Contact support" mailto** — the reference card + Go home are
  enough at this level. The mailto is on the more detailed
  `app/error.tsx` boundary (where the root layout is intact and the
  page can render richer chrome).
- **Mini CSS reset in `.reset`.** Since the root layout's
  `globals.css` is gone, this page applies a minimal `box-sizing:
  border-box; margin: 0; padding: 0; border: 0` reset so the page
  is readable even when no other CSS loads.
- **System font fallback.** The font stack declares
  `'Inter Tight', 'Inter', system-ui, -apple-system, BlinkMacSystemFont,
  'Segoe UI', sans-serif` — the `next/font` injected face is gone with
  the root layout, but the system fallback keeps the page legible.
- **P2.11 tick — 2026-06-25.** Sentry capture seam wired. The same
  `captureError` from `app/error.tsx` is called here with
  `surface: 'app.global-error'` so support can distinguish root-layout
  crashes from route-level errors in the event stream. The shared
  `makeErrorReference` + `WarnGlyph` come from `00-foundations/ui/
  error/` (extracted from the P0.23 duplicates). The seam remains
  env-gated and PII-safe — no error.message / error.stack in the log,
  no user_id / email. Full Sentry SDK init lands in PH18 — the seam
  flips to `'sentry'` mode without any change here.
