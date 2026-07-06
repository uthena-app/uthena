# Newsletter — `/newsletter`

## What this page does

Dedicated landing page for the marketing newsletter. The home page already
hosts a newsletter band (P0.10); this page exists so the SiteFooter can link
to a stable URL, deep-links from email campaigns + social posts land somewhere
real, and the band has a focused single-purpose surface outside the home
hero+reviews+FAQ rhythm.

The page is a single section: the same newsletter email capture band the
home page uses, framed by a short header (eyebrow + h1 + lede) that explains
what subscribers get. Submitting the form is a UI placeholder today — the
real subscribe action is wired in Phase 17 (SES adapter + suppression list
+ double opt-in).

## Data this page shows

| Field | Source | Format |
|---|---|---|
| Page eyebrow | hard-coded "Newsletter" | text |
| H1 headline | hard-coded | text |
| Sub-headline | hard-coded | text |
| Email input | `<input type="email">` — client state, never logged | form field |
| Submit button | "Subscribe →" | button |
| Inline success | "We'll let you know when the next drop ships." | paragraph |
| Consent copy | hard-coded "By subscribing you agree to receive marketing emails from Uthena. Unsubscribe anytime. We never share your email." | paragraph |

No data fetch on this page. The band is the same component the home page
uses, relocated to `@features/newsletter` so this route can render it
without coupling to `@features/home`.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Subscribe | Type email + click "Subscribe" | Form prevents default, validates email format via `type="email"` + `required`, shows inline success message. Real subscribe action is deferred to Phase 17. | public |
| Visit from footer | Click "Newsletter" link in the SiteFooter Company column | Navigate to `/newsletter` | public |
| Visit from email/social campaign | Click a campaign link to `uthena.com/newsletter` | Land on this page | public |
| Return to home | Click the Uthena wordmark in the SiteHeader | Navigate to `/` | public |

## What this page does NOT do

- Real subscribe action (Phase 17 SES adapter — deferred via STUB-036).
- Account-bound preferences (signed-in users get notification preferences
  in Phase 9 P9.7; this page is anonymous-friendly).
- A "preferences" or "what we send" listing beyond the lede paragraph.
- Multiple lists / segmentation (single "Uthena newsletter" list).
- Tracking pixels, third-party analytics, retargeting tags.
- Cookie-based remarketing (Plausible or PostHog only after explicit
  consent via the cookie banner in Phase 11).

## Acceptance criteria

- [ ] Page renders in < 100ms p95 (RSC, no data fetch, no client JS for
      layout — the band's state is the only client island)
- [ ] URL is `/newsletter` and is reachable directly + from the
      SiteFooter Company column
- [ ] The band shows the same email input + Subscribe button the home
      page band shows (single source of truth in
      `@features/newsletter/NewsletterBand`)
- [ ] Submitting with an empty / invalid email shows the browser's
      native validation message (no extra JS needed)
- [ ] Submitting with a valid email shows the inline success message
      and disables further submits (the form is replaced by the
      success state)
- [ ] Consent copy is visible at all times below the input — even on
      the success state (so the user sees the privacy commitment
      they agreed to)
- [ ] No third-party scripts (analytics, remarketing, A/B) — verified
      via the page's network tab being empty beyond first-party
- [ ] No PII in logs (the email value is in client state only;
      `check:pii` is green)
- [ ] Keyboard accessible: Tab order goes label → input → button; Enter
      on the input submits; the success state has `role="status"` for
      screen-reader announcement
- [ ] Mobile responsive at 360px / 768px / 1280px breakpoints (same
      responsive rules as the home band)
- [ ] SiteFooter Company column includes a "Newsletter" entry pointing
      to `/newsletter`
- [ ] No `TODO` / `FIXME` in the diff
- [ ] No layout shift (CLS = 0) — the band has fixed padding, the
      success state replaces the form in the same DOM slot

## Design reference

- Mockup: the home band's mockup section in `mockups/home.html` lines
  200–208 (same band, dedicated URL).
- Design tokens: `00-foundations/design/tokens.css`
- Component: `02-features/newsletter/NewsletterBand.tsx`
- Spec home: `01-specs/pages/home.md` § "Data this page shows" row
  "Newsletter opt-in" + § "Acceptance criteria" row "Newsletter
  signup is present in the footer or a homepage band, validates
  consent, and does not subscribe without explicit opt-in" — this
  page satisfies both the footer entry and the homepage band.

## Security

- **Auth required:** no — public marketing surface
- **Allowed roles:** anyone (anonymous or signed-in)
- **RLS policies that apply:** none — this page does not read from the
  database
- **PII collected:** email address (in client state only until Phase 17
  wires the SES adapter; never persisted, never logged)
- **PII in URLs:** no
- **Audit logged:** no — UI placeholder until Phase 17; the real
  subscribe action will log per P17.4 (unsubscribe management) +
  P17.3 (suppression list + bounce handling)
- **Third-party scripts:** none
- **Cookie consent interaction:** the cookie banner (Phase 11) is
  not required for this page because the page itself has no tracking
  scripts — submitting the form is a first-party action until Phase 17
  wires SES

## Performance

- **Target p95:** < 100ms (smaller than the home page target because
  this page has no data fetch)
- **Render strategy:** RSC + static. The only client JS is the band's
  submit handler (≈1 KB)
- **Cache:** static; revalidate on demand. No ISR needed.
- **Bundle size budget:** the band is the only client island, ~2 KB
  first-load JS (matches the home page's NewsletterBand footprint)

## Out of scope for v1

- Real subscribe action (Phase 17 — STUB-036)
- Double opt-in flow (Phase 17)
- Per-category subscription preferences (Phase 9 P9.7 account settings)
- A/B test variants of the headline (Phase 19 P19.14)
- Recent newsletter archive / past issues
- RSS / Atom feed of past issues
- Welcome email with a discount code (Phase 17 P17.5)

## Open questions for human

None. The page is the URL host for the home band's same component;
the real action lands in Phase 17.

---

## Implementation notes

- (filled by the building agent)