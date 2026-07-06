# Uthena — Changelog

## v4 — 2026-06-15 — Two-signal color system

Split the single teal accent into two non-overlapping brand signals: **orange for action** (`#F3924A`, primary buttons / sale / MRR / stars) and **teal for identity** (`#1ABC9C`, links / focus / active nav / PLR / logo dot). Both colors come from the current uthena.com logo / palette DNA.

### Token changes
- Added `--action` family (`#F3924A`, hover `#FFA862`, soft/line/glow) for the orange action signal.
- Shifted `--accent` to `#1ABC9C` (from `#14A89A`) for the teal identity signal.
- Added `--sale` / `--sale-soft` / `--new` / `--new-soft` named aliases for spec pages.
- Added `--bg-brand` (very low-opacity teal tint) for brand-moment surfaces.
- Added `--bg-elev-3` (input fill, popover) as a 4th raised surface.
- Added 6 section-tint utility classes: `.sec.tint-base` / `.tint-card` / `.tint-raised` / `.tint-inset` / `.tint-brand` / `.tint-orange`.

### Component changes
- `Button` primary variant now uses `var(--action)` (orange) instead of `var(--accent)` (teal).
- `Badge` adds `sale` / `plr` / `mrr` / `new` variants with the new token mapping.
- `Tab` active indicator stays `var(--accent)` (teal — identity).
- `Checkbox` / `Radio` checked state stays `var(--accent)`.
- `Input` focus border stays `var(--accent)`.
- `Rating` star fill is now `var(--action)` (orange, brand-coherent).

### Light theme
- Light theme is a first-class ship. Both dark and light land in v1.
- Light theme uses a **dark footer** (`#15181B`) for the same reason the dark theme uses a light footer.
- Orange / teal soft/line opacities are bumped on light theme for legibility on cream.

### Files
- Created `00-foundations/design/tokens.css` + `primitives.css` + `design-system-dark.css` + `design-system-light.css`.
- Updated `mockups/design-system.css` + `design-system-dark.css` + `design-system-light.css` to mirror v4 tokens (legacy v3 names aliased for backwards-compat with existing HTML).
- New mockups: `mockups/home.html` + `home-light.html` + `browse.html` + `browse-light.html` + `product.html` + `product-light.html` + `admin-light.html` (the canonical Editorial Marketplace design).
- Updated `00-foundations/design/README.md` with the two-signal color guide + section-tint rules + light theme notes.
- Updated `docs/BRAND_AND_POSITIONING.md`: v3 → v4.

### Not in this PR
- The 68 spec pages in `01-specs/pages/` — untouched. Per-page color instructions will be added in a separate pass.
- `mockups/variants/` and `mockups/directions/` (old direction explorations) — untouched. Out of scope.
- Per-page mockup HTML that uses the old v3 design-system files — left as-is. They pick up the new v4 colors automatically via the alias layer.
