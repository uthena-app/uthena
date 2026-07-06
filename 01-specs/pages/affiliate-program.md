# Affiliate Program — `/affiliate-program`

> Public marketing page for the affiliate program. Drives traffic to `/signup?next=/affiliate/onboarding`.

## What this page does

A single-page pitch for prospective affiliates:

1. **Hero** — the commission rate (30% × 12 months, 15% lifetime for subscriptions, lifetime on one-time purchases) + two CTAs (Apply / How it works).
2. **Benefits grid** — 6 cards: recurring commissions, dashboard, mini-shop, payouts, free to join, creative.
3. **FAQ** — 4 entries: earning potential, audience size required, banned methods, payment cadence.
4. **Closing CTA** — Apply now.

## Acceptance criteria

- [ ] Public route, no auth.
- [ ] Sitemap includes `/affiliate-program`.
- [ ] All CTAs link to `/signup?next=/affiliate/onboarding`.
- [ ] FAQ expanded by default (native `<details>` block — TBD; v1 uses a `<dl>` for accessibility).
- [ ] All 6 checks green.

## Out of scope

- Per-tier commission eligibility (the actual rate is fixed in DB; v1 ships the marketing page only).
- Live "today's top affiliates" leaderboard (deferred — needs privacy review).
