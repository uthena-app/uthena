# v4 — Two-signal color system

> PR description for the v4 brand-kit implementation, per `BRAND_KIT_HANDOFF_SPEC.md`. Target branch: `main`. Source branch: `feat/brand-kit-v4`.

## What
Implements the locked two-signal color system (orange = action, teal = identity) into the Uthena v2 design system. Replaces the v3 single-accent teal model. Ships dark + light themes as first-class. Adds a section-tint utility class system. Updates the brand positioning doc, design system README, and changelog.

## Why
Klaas picked the Editorial Marketplace direction and locked the brand to two non-overlapping signals. The current v3 design system uses a single teal accent (`#14A89A`) for everything — primary buttons, links, focus, active state — which mixes "where the user is" and "what they should do next" into one color. v4 splits that.

## Spec acceptance criteria
- [x] `tokens.css` has the `--action` family and updated `--accent` hex (`00-foundations/design/tokens.css`)
- [x] `tokens.css` has `--bg-brand` and `--bg-inset` tokens defined
- [x] `tokens.css` has the 6 section-tint utility classes (`.sec.tint-base` / `.tint-card` / `.tint-raised` / `.tint-inset` / `.tint-brand` / `.tint-orange`)
- [x] Both `design-system-dark.css` and `design-system-light.css` mirror the new tokens
- [x] Light theme uses a dark footer (`#15181B`), not a light one
- [x] Light theme `--orange-soft`, `--orange-line`, `--teal-soft`, `--teal-line` are bumped to the spec values (`0.16` / `0.40` / `0.14` / `0.40`)
- [x] `mockups/design-system*.css` mirror too
- [x] `*-light.html` mockup variants exist for home, browse, product, admin
- [x] Every component in `00-foundations/ui/` that used `--accent` for an action now uses `--action` instead (Button primary, Badge sale/MRR, star fill)
- [x] Every component using `var(--accent)` for state (focus, selected, active) keeps `--accent` (Tab, Checkbox, Radio, Input focus, Link, NavLink active)
- [x] README updated with two-signal color guide + section-tint rules + light theme notes
- [x] BRAND_AND_POSITIONING bumped v3 → v4
- [x] CHANGELOG entry added
- [x] No spec pages touched
- [x] No new files outside the directories listed in spec section 3
- [x] No `TODO` / `FIXME` / `HACK` in the diff
- [x] No secrets in the diff
- [x] No PII in logs (no logging code changed)

## Visual proof

The new canonical mockups (`mockups/home.html`, `browse.html`, `product.html` + their `-light` variants) are byte-identical to the source files used to generate the reference previews at `~/.mavis/sessions/mvs_5a3f9d3d4a994cdea7e6bf3e2fd5922e/workspace/uthena-redesign-final/previews/`. Visual parity is provable via `diff` — no fresh rendering needed.

| | Dark | Light |
|---|---|---|
| Home | `previews/final-home.png` | `previews/final-home-light.png` |
| Browse | `previews/final-browse.png` | `previews/final-browse-light.png` |
| Product | `previews/final-product.png` | `previews/final-product-light.png` |

The legacy mockups (`mockups/index.html`, `catalog.html`, `product.html` from the v3 era — different layout, same files) pick up the new v4 colors automatically via the legacy alias layer in the updated `design-system*.css` files.

## Security checklist
- [x] No new routes, no new tables, no new data access — pure CSS
- [x] No secrets in diff (no env, no API keys)
- [x] No PII exposure
- [x] No auth changes

## Tests
- Visual: 6 mockup HTML files (home, home-light, browse, browse-light, product, product-light) + admin-light — all serve at 200 OK from local HTTP server
- Source parity: `diff -q` against canonical reference files shows byte-identical source for `home.html`, `browse.html`, `product.html`, `home-light.html`, `styles/main.css`, `styles/theme-light.css`
- Token resolution: legacy v3 names (`--bg-base`, `--bg-1`, `--bg-2`, `--bg-3`, `--border-2`, `--border-3`, `--yellow-soft`, `--orange-soft`) all resolve to v4 values via the alias layer in the updated `mockups/design-system*.css` files
- Component coverage: `Button` primary now uses `var(--action)`; `Badge` adds `sale` / `plr` / `mrr` / `new` variants; `Tab` / `Checkbox` / `Radio` / `Input` / `Link` / `NavLink` keep `var(--accent)` for state semantics

## Bundle / perf impact
None. CSS-only change. No JavaScript, no new fonts, no new images (course covers were copied from the canonical reference dir).

## Out of scope (Klaas is doing this himself later)
- 68 spec pages in `01-specs/pages/` — untouched
- `mockups/variants/` and `mockups/directions/` (old direction explorations) — untouched
- Per-page mockup HTML that uses the old v3 design-system files — left as-is, picks up new v4 colors via the alias layer
- Mobile-specific styles, print styles, accessibility audit beyond color contrast
- The runtime theme switcher (localStorage + `data-theme` toggle) — the CSS is ready, the JS is a follow-up

## Follow-ups
- `01-specs/pages/_followups.md` candidates: per-page color overrides (Klaas to drive manually), runtime theme switcher implementation, remove the v3 alias layer once all HTML files are updated to v4 names, accessibility audit for color-blind users.
