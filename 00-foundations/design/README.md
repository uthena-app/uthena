# 00-foundations/design/

The visual design system. Two themes (dark + light), one component vocabulary, all driven by CSS custom properties.

## Files

- **`tokens.css`** — design tokens (colors, spacing, radii, type, shadows). Dark theme by default. The light theme overrides these in `design-system-light.css`. Used in the HTML mockups at `mockups/`.
- **`primitives.css`** — base styles for unstyled HTML elements (`body`, `a`, `button`, `input`, etc.), plus shared component classes (`.btn`, `.badge`, `.card`, `.nav`, `.footer`). Imported once, globally, after `tokens.css`.
- **`design-system-dark.css`** — same as `tokens.css` + `primitives.css`, dark by default. Mirrored at `mockups/design-system-dark.css` for the existing mockup files.
- **`design-system-light.css`** — light theme overrides scoped to `[data-theme="light"]`. Mirrored at `mockups/design-system-light.css`.
- **Color & contrast guide** (this README) — which tokens to use where.

## Tokens — the rules

### Color

We have **6 surface levels** (5 neutrals + 1 brand-tinted), **4 text levels**, **2 brand signals**, and **4 semantic colors**.

**Surface** (dark → light, by depth):
- `--bg` — page background
- `--bg-elev-1` — base card
- `--bg-elev-2` — raised card (hover, selected)
- `--bg-elev-3` — popover, input fill
- `--bg-inset` — deeper than page (code, table stripes, announcement bar)
- `--bg-brand` — brand-tinted surface (active stepper, featured earn card, brand CTA zone)

**Text** (high → low contrast):
- `--text-1` — primary (headings, body)
- `--text-2` — secondary (descriptions, metadata)
- `--text-3` — tertiary (hints, disabled-ish)
- `--text-4` — disabled

**Borders**:
- `--line` — hairline
- `--line-strong` — emphasized border (input hover, secondary button)

**Brand — two signals, non-overlapping roles** (see "Two-signal color system" below):
- `--action` (orange `#F3924A`) — action: primary buttons, sale tags, MRR license, stars
- `--accent` (teal `#1ABC9C`) — identity: logo dot, links, focus, active nav, PLR license, selected state

**Semantic** — never decorative:
- `--success` / `--warn` / `--danger` / `--info` (each with `-soft` and `-line` variants)

**Sale / new** — named aliases for spec pages:
- `--sale` / `--sale-soft` (alias to action/orange)
- `--new` / `--new-soft` (alias to accent/teal)

**The rule:** if you want a color, use a token. Never use a hex value, never use rgb() inline, never define a new color in a component. If a token doesn't exist, add it to the tokens file with a comment explaining when to use it.

## Two-signal color system

We have two brand colors and they are not interchangeable. Each owns a non-overlapping semantic role. The rule is: if you want a color, first decide which signal it serves, then use the matching token. Never use orange for identity, never use teal for action.

**Orange (`--action`) means: do this now.** It pushes the user forward. Reserved for: primary buttons (Buy, Add to cart, Subscribe, Apply, Submit), the "SAVE %" sale tag, the "MRR" license pill, and review stars. Orange is the only color that fills a button background. Everywhere else, orange is reserved for the few places it earns its keep.

**Teal (`--accent`) means: you are here.** It shows the user their current state. Reserved for: the logo dot, body links, the active nav item, the keyboard focus ring, the selected license-radio in the PDP, and the "PLR" license pill. Teal is for *where the user is*, not what they should do next.

If a spec page needs a brand color for something other than action or identity, that's a sign the spec needs a new token. Don't reach for one of these two by default.

### Per-element rules

**Buttons.** Primary CTA (Buy, Add to cart, Subscribe, Apply, Submit, Save) uses `var(--action)` background with `#1A0E00` text. Hover is `var(--action-hover)`. Secondary buttons (Cancel, Back, Skip) are transparent with `var(--text-1)` text and `var(--line)` border. Ghost buttons (inline link-buttons) use teal — `color: var(--accent)`. Destructive buttons (Delete, Remove, Cancel subscription) are semantic red via `var(--danger)`. Disabled uses `var(--text-4)` text on `var(--bg-elev-1)`.

**Pricing.** Current price is `var(--text-1)`, mono, weight 600. Was-price is `var(--text-4)` with line-through. The "SAVE X%" pill next to the price is `var(--action-soft)` background, `var(--action)` text, `var(--action-line)` border. The "From $X" prefix is `var(--text-2)`. Free / $0 is `var(--accent)` to draw the eye.

**License markers.** The PLR license pill is `var(--accent)` background with `#001A14` text. The MRR license pill is `var(--action)` background with `#1A0E00` text. The selected license-radio in the PDP selector has a `var(--accent)` border and `var(--accent-soft)` background. Unselected has `var(--line)` border on `var(--bg-elev-1)`.

**Navigation and focus.** Active nav item is `var(--accent)` text with a bottom border. Hover is `var(--text-1)`. Inactive is `var(--text-2)`. The keyboard focus ring is 2px solid `var(--accent)` with 2px offset. The "on" tab underline is `var(--accent)` at 2px. The selected checkbox / radio fills with `var(--accent)`. Body links are `var(--accent)` with underline on hover.

**Status.** Success / Paid / Completed uses `var(--success)`. Warning / Pending / Expiring soon uses `var(--warn)`. Error / Failed / Refunded uses `var(--danger)`. Info / New version available uses `var(--info)`. The "NEW" badge on a new course is `var(--new)` (teal, named separately from `--accent` so it can be re-themed later without coupling).

**Reviews.** Star fill is `var(--action)` — orange, not yellow, to match the brand. Star empty is `var(--text-4)`. The count next to the stars is `var(--text-2)` mono.

**Headings and copy.** H1, H2, H3, body copy are all `var(--text-1)`. Secondary description is `var(--text-2)`. Eyebrow / label / metadata is `var(--text-3)`, uppercase, tracked. The hero h1 emphasized word (one per page) is either `var(--accent)` (teal, the "identity word") or `var(--action)` (orange, the "action word") — pick one, never both on the same line.

**Footer.** Footer background is `#F4F4F4` for brand continuity with the current site. Footer text is `#0B0C0D`. Footer link hover is `var(--accent)`. Payment chip border is `#DEDEDE`. The footer is its own zone — don't tint it.

### Spacing

- Base unit: 4px
- Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96
- Token names: `--space-1` through `--space-9` (4px through 96px)
- Use the scale. Don't use `padding: 13px` because it's "almost 12." Use 12 or 16.

### Radii

- 6, 8, 10, 14, 18, 999 (pill)
- Token names: `--r-xs` through `--r-pill`
- Default: cards and buttons are `--r-md` (10px). Pills are `--r-pill`. Inputs are `--r-sm` (8px).

### Type

- Font: Inter for everything human. JetBrains Mono for numbers, IDs, timestamps.
- Scale: 11.5, 12, 12.5, 13, 13.5, 14, 16, 18, 22, 24, 32, 36, 44
- Use semantic class names (`t-sm`, `t-xs`, `t-mute`, `t-faint`, `t-num`) not raw font-size values.

### Shadows

- Borders are the primary depth mechanism. Use shadows for: popovers, floating menus, and one-off emphasis (e.g. a hero CTA glow).
- Token names: `--shadow-sm`, `--shadow-md`, `--shadow-lg`
- Avoid `box-shadow: 0 0 5px rgba(...)` in components. Use a token.

## Themes

Two themes ship: `design-system-dark.css` and `design-system-light.css`. They define the same token names with different values. Components consume tokens, not theme files — so they work in both themes automatically.

**Theme switcher** lives in the bottom-right of the page (per the mockups). User choice persists in localStorage.

To add a new theme:
1. Copy `design-system-light.css` to `design-system-[name].css`
2. Override the same token names
3. Update the theme switcher component to include the new option
4. Update mockups to demonstrate

Don't add a new theme without discussion. Each theme is real work to maintain.

### Light theme notes

The light theme is a token remap, not a redesign. Same component code, same layout, same brand colors. Only the canvas / text / border tokens change. The light theme is a `<html data-theme="light">` switch — components consume tokens, themes override token values.

**The brand colors don't change between themes.** Orange stays `#F3924A`. Teal stays `#1ABC9C`. What changes is the hover variant and the soft / line opacities:
- Orange hover: `#FFA862` on dark (lighter, more glow), `#E57A2A` on light (darker, more legibility on cream).
- Teal hover: `#20D2AF` on dark, `#159A82` on light.
- Orange-soft: `0.12` on dark, `0.16` on light (bumped for legibility).
- Orange-line: `0.30` on dark, `0.40` on light.
- Teal-soft: `0.10` on dark, `0.14` on light.
- Teal-line: `0.25` on dark, `0.40` on light.

**The light-theme footer is dark.** Not a copy-paste mistake. The dark theme uses a light footer (`#F4F4F4`) because the page is dark — a dark footer would disappear. The light theme uses a dark footer (`#15181B`) for the same reason — the page is light, so a light footer would vanish. The footer's job is to anchor the end of the page; the color it picks depends on the page background.

## Section background tints

Six section-level background tints are available. Apply a class to a `<section>` element to give it a non-default background. All values are tokens, so they auto-adapt to the light theme.

| Class | Token | Use it for |
|---|---|---|
| `.sec.tint-base` | `--bg` | Default — page background. Don't apply unless this is your default. |
| `.sec.tint-card` | `--bg-elev-1` | The categories section on home. Cards-on-page composition. |
| `.sec.tint-raised` | `--bg-elev-2` | The newsletter band on home. One step up from the page. |
| `.sec.tint-inset` | `--bg-inset` | Code blocks, table stripes, announcement bar. Deeper than the page. |
| `.sec.tint-brand` | `--bg-brand` | A "brand moment" callout (active stepper, earn / CTA zone). Teal-tinted. |
| `.sec.tint-orange` | `--action-soft` | A "deal moment" callout (flash sale, founder's pricing). Orange-tinted. |

**Rules of use.** Default is `tint-base` (the page background). Don't apply a tint to every section — only where you want emphasis. **One `tint-brand` per page maximum.** It's the "this is a brand moment" signal. Overuse dilutes it. **One `tint-orange` per page maximum**, and only on a "this is a deal" callout (flash sale, founder's pricing). Never on evergreen content. Both `tint-brand` and `tint-orange` include their border lines so the section reads as a distinct zone, not a color wash. The footer is its own zone (uses `--footer-bg`) — don't tint it.

When in doubt, default to `tint-base`. The tint palette is permission to play, not a mandate to use.

## Icons

`icons.tsx` is a single file containing every icon as a React component. They all use `currentColor` for fill/stroke so they inherit text color.

Usage:
```tsx
import { Search, ChevronRight } from '00-foundations/design/icons';
<Search size={14} />  // size in px
<ChevronRight size={16} className="text-2" />  // color via class
```

When you need a new icon:
1. Check if it already exists in the file
2. If not, add it (follow the same pattern as the existing ones — `forwardRef`, accept `size` and `className` props, use `currentColor`)
3. If the icon is part of a brand or third-party trademark, document the source and the license

**No emoji icons in the UI. Ever.** This is a B2B tool. Emoji are for marketing emails.

## Type system

Inter and JetBrains Mono. Loaded via `next/font` (or the equivalent in your framework). No CDN imports. No `@import` from Google Fonts.

Type styles are pre-defined as utility classes in `primitives.css`:
- `.h-display`, `.h-1`, `.h-2`, `.h-3`, `.h-4` — headings
- `.t-eyebrow` — small caps label
- `.t-num` — mono numbers
- `.t-sm`, `.t-xs` — small text
- `.t-mute`, `.t-faint` — text color overrides

Use these, not raw `<h1>` or `<p>` styling.

## Adding a new component primitive

A "component primitive" is a UI element that appears in 2+ features (e.g. Button, Card, Modal). Component primitives go in `00-foundations/ui/`, not in `design/`. Design system is just the visual language; UI components are the React implementations.

If you're adding a component to `design/`, it's CSS-only (a new token, a new utility class, a new icon). If you're adding a component to `ui/`, it's a React component.
