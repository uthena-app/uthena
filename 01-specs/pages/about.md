# About — `/about`

> Company / mission / principles page. Public marketing surface.

## What this page does

Three sections + a closing get-in-touch block. Renders entirely from the page module (no data query) — copy is locked in v1.

- **Mission** — one paragraph about creators + resellers + affiliate channels.
- **By the numbers** — bullet list of platform stats (60% revenue share, $19/mo Personal Access, 100% digital, etc.).
- **How we operate** — bullet list of the four operating principles (plain language, flat fees, own your library, real support).
- **Get in touch** — links to sales@ + /partner + /press.

## Acceptance criteria

- [ ] Public route, no auth.
- [ ] Renders the four sections above.
- [ ] Sitemap includes `/about`.
- [ ] OpenGraph + Twitter Card meta render correctly.
- [ ] All 6 checks green.

## Out of scope

- Per-section CMS-driven content (locked copy in v1).
- A timeline / team grid / investor list (deferred to v2 + a `team.md` spec follow-up).
- Any marketing-tailored visuals (v1 keeps the page text-first so it ages well + reads fast).
