# `@features/newsletter` — Marketing newsletter email capture UI

The marketing newsletter form, used by:

- The home page (`app/page.tsx`) as one of the seven sections
- The dedicated `/newsletter` page (`app/newsletter/page.tsx`) as the
  page's main CTA

## Components

- `NewsletterBand.tsx` — `'use client'`. Self-contained email input +
  Subscribe button + inline success state + consent copy. Owns the
  `email` + `submitted` state via `useState`. The submit handler
  currently `preventDefault()`s + sets `submitted=true` (UI placeholder;
  the real action lands in Phase 17 — STUB-036).
- `NewsletterBand.module.css` — token-only styles. Single responsive
  shell that works as both a section on the home page and as the
  page body on `/newsletter`.

## What it ships (per P0.10 / P0.11 acceptance criteria)

- Real `<input type="email" required autoComplete="email">` — browser
  validates email format; no JS needed for the validation.
- Visible `<label>` (screen-reader-only via the global `.srOnly` class)
  so the input has an accessible name.
- Consent copy below the form is always visible, including in the
  success state — so the user sees the privacy commitment they agreed
  to even after submitting.
- `aria-label="Newsletter signup"` on the form so screen readers
  announce the input's purpose in context.
- `role="status"` on the success message so screen readers announce
  the post-submit state change.
- `id="newsletter"` on the `<section>` so the SiteFooter can deep-link
  from anywhere on the home page to the band.

## What it does NOT do (deferred)

- Real subscribe action — Phase 17 (STUB-036: "newsletter subscribe
  action").
- Double opt-in flow — Phase 17 (P17.4 unsubscribe management +
  P17.3 suppression list).
- Per-category preferences for signed-in users — Phase 9 (P9.7
  notification preferences) — the anonymous form on this page is
  always opted-in to the single "Uthena newsletter" list.

## Decisions worth remembering

- **Why `'use client'` for a tiny form.** The form has local state
  (`email`, `submitted`) + an `onSubmit` handler. Keeping it client-
  scoped is the smallest possible footprint (~1 KB) — and the rest
  of every page that uses it stays RSC.
- **Why the band has both `id="newsletter"` and `id="newsletter-h"`.**
  `id="newsletter"` is on the `<section>` so deep-links (`/#newsletter`)
  scroll to the band shell, not to the heading. `id="newsletter-h"`
  is on the `<h3>` because `aria-labelledby` needs an element id and
  the heading is the natural label target.
- **Why no `aria-invalid` on the input.** The browser-native email
  validation kicks in via `type="email"` + `required`. Adding
  `aria-invalid` would require JS state tracking; the browser's
  native validation message is already accessible.
- **Why no PII in logs.** The email value lives in client state only
  until Phase 17 wires the SES adapter. `check:pii` is green because
  nothing in this component logs the email value to console / logger
  / network. The `name="email"` attribute is a form-name, not a
  PII-leak risk (form names are metadata, not the value).
- **Why the home feature no longer re-exports this band.** Moving
  the band to its own module decouples the home page's "marketing
  surface" from the "subscribe action" surface. Future surfaces
  (campaign landing pages, the affiliate minishop, the partner
  onboarding wizard) can drop the band in without depending on
  `@features/home`.

## Files in this module

```
02-features/newsletter/
├── NewsletterBand.tsx        # 'use client' — the band itself
├── NewsletterBand.module.css # token-only styles
├── index.ts                  # barrel
└── README.md                 # this file
```

## Consumers

- `03-app/page.tsx` (home page)
- `03-app/newsletter/page.tsx` (dedicated URL)
- `03-app/SiteFooter.tsx` references `/newsletter` in the Company
  column (the deep-link target lives here, not in this file)