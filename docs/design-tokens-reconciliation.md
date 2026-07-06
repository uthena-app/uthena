# Design tokens reconciliation — tokens.css vs mockups

> **Owner:** P0.1 (Phase 0 — Visual shell + design system + buyer-page rebuild)
> **Created:** 2026-06-24
> **Purpose:** record every gap between `00-foundations/design/tokens.css` (the
> canonical design system) and `mockups/styles/main.css` (the visual reference
> the user approved in 2026-06-15), what was done about it, and what is
> intentionally deferred to a follow-up.
>
> **Out of scope for P0.1:** changing values that the design system spec
> explicitly fixes (soft/line opacities, body font size, --r-lg). Those
> deviations are real but they would shift the look of every existing
> component; they belong in a dedicated visual-tune task with a human
> sign-off, not in a token-reconnaissance pass.

---

## 1. Summary

| Category | Count | Action taken |
|---|---|---|
| Tokens missing in `tokens.css` (mockup uses them) | 5 | **Added in P0.1** |
| Mockup-named aliases for existing tokens | 5 | **Added in P0.1** |
| Spacing scale (4px base) | 10 | **Added in P0.1** |
| Container max-widths | 3 | **Added in P0.1** |
| On-color text token | 1 | **Added in P0.1** |
| Display font fallback chain | 1 | **Tightened in P0.1** |
| Value deviations (mockup ≠ tokens) | 4 | **Documented only; deferred to P0.1b** |
| Files out of sync (mirror drift) | 1 | **Documented; mockup mirror update deferred to a follow-up** |

Net: 25 new tokens added (15 spacings + 3 max-widths + 1 on-color + 6 aliases
for mockup names). Four value deviations surfaced for a future visual-tune
task. Zero existing tokens renamed or removed — every existing component
keeps working.

---

## 2. Gaps closed in P0.1

### 2.1 On-color text — `--on-accent`

The mockup renders "PLR" pills, the `.lic-tag`, and the `.tag` overlay
directly on the teal accent fill with `#001A14` text. The design system
already shipped `--on-action: #1A0E00` for the orange case but the
matching teal counterpart didn't exist; components were hard-coding
`#001A14`.

| Token | Value | Notes |
|---|---|---|
| `--on-accent` | `#001A14` | Per-theme override unnecessary — same value reads on both teal hex (theme-invariant). |

### 2.2 Spacing scale — 4px base

The README §"Spacing" documents `--space-1` through `--space-9` (4 → 96px)
and the mockup uses `--s-1` through `--s-10` (4 → 128px). Neither family
was actually defined in `tokens.css`. Without them, every page that
imported the design system was hand-rolling `padding: 16px` and friends,
which defeats the point of a token system.

**Resolution:** define `--space-1` … `--space-9` (the canonical design
system names) and alias `--s-1` … `--s-10` to the same values (so the
mockup CSS drops in unchanged). `--s-10: 128px` is the only extra step
the mockup adds on top of the 9-step design system scale — kept as an
alias for compatibility.

| Token | Value | Source of truth |
|---|---|---|
| `--space-1` … `--space-9` | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 px | README §"Spacing" |
| `--s-1` … `--s-9` | `var(--space-1)` … `var(--space-9)` | Mockup alias |
| `--s-10` | 128px | Mockup-only (one step beyond the design system scale) |

### 2.3 Container max-widths

`primitives.css` hard-codes `max-width: 1280px` / `880px` / `1440px` on
`.container` / `.container-narrow` / `.container-wide` (lines 54-56).
The mockup uses `--max: 1280px` (and the same value happens to match).

**Resolution:** define `--max` / `--max-narrow` / `--max-wide` tokens so
the literals can be removed in a follow-up patch without re-touching
`.container` rules. Out of scope for P0.1 (the literals still work) but
the tokens are in place.

| Token | Value | Currently used in |
|---|---|---|
| `--max` | 1280px | `.container`, mockup `.container` |
| `--max-narrow` | 880px | `.container-narrow` |
| `--max-wide` | 1440px | `.container-wide` |

### 2.4 Text aliases — `--text-soft`, `--text-faint`

The mockup uses `--text-soft` (= --text-2) and `--text-faint` (= --text-3)
heavily. `tokens.css` ships the `--text-2` / `--text-3` names but not the
shorter aliases. Components that copied mockup classes would have to
translate one to the other.

**Resolution:** add both as direct aliases. Auto-resolves to the
per-theme `--text-2` / `--text-3` values, so no separate light-theme
override needed.

### 2.5 Badge aliases — `--badge-sale`, `--badge-new`

The mockup defines `--badge-sale: #F3924A` and `--badge-new: #1ABC9C` as
explicit brand scalars. The `.badge-sale` / `.badge-new` primitives
already use `--action-soft` / `--accent-soft` (the soft variants), but
a future component might want the literal brand color (not the soft
variant) for a sale / new chip.

**Resolution:** add both as direct aliases of `--action` / `--accent`.
Per-theme auto-apply (the brand hex is the same in both themes).

### 2.6 Display font — `--font-display` fallback chain

`tokens.css` declared `--font-display: 'Inter', ...` and the mockup
declared `--font-display: 'Inter Tight', 'Inter', ...`. Inter Tight is
the actual display face the mockups were designed in; the design system
was missing it from the fallback chain.

**Resolution:** update `--font-display` to `'Inter Tight', 'Inter', ...`
so when the project registers Inter Tight via `next/font` (a future
Phase 0 task), it picks up automatically. If Inter Tight is not
registered, the chain falls back to Inter (current behavior). No visual
change today; structural fix.

`--font-body` alias added (mockup name) → `var(--font-sans)`.

---

## 3. Gaps intentionally deferred

These are real divergences between the mockup and the design system.
They were left alone in P0.1 because changing them is a visual change
that affects every existing component and deserves a human review pass
on screenshots, not a token-recon patch.

### 3.1 Soft/line opacity values (mockup more saturated than design system)

| Token | Design system (tokens.css) | Mockup (main.css) | Δ |
|---|---|---|---|
| `--orange-soft` | 0.12 | 0.14 | +0.02 |
| `--orange-line` | 0.30 | 0.35 | +0.05 |
| `--teal-soft` | 0.10 | 0.14 | +0.04 |
| `--teal-line` | 0.25 | 0.35 | +0.10 |

The README §"The brand colors don't change between themes" was written
before the final mockup tuning. The mockup is the visual source of
truth the user approved. Bumping these values would shift every soft
badge, line, focus ring, and section border in the app.

**Follow-up:** `P0.1b — visual tune: align soft/line opacities to mockup
values`. One-line per token change, plus screenshot diffs in light +
dark for: home, product, browse, account dashboard. Human reviews the
diffs and either confirms the bump or overrides the mockup.

### 3.2 Border radius `--r-lg` (mockup 16px vs design system 14px)

| Token | Design system | Mockup | Δ |
|---|---|---|---|
| `--r-lg` | 14px | 16px | +2px |

The mockup uses `--r-lg` (16px) on `.hero-art`, `.news`, `.gallery .main`,
`.brief` — the "big rounded surface" role. Design system uses 14px. The
two extra pixels are barely visible at 1× but compound on hero cards.

**Follow-up:** `P0.1b` (same task as §3.1). Decision options: bump
`--r-lg` to 16px (impacts every place that uses `--r-lg` — about 6
components); keep 14px and add `--r-lg2: 16px` for the hero surfaces;
or just update the mockup to use `--r-lg: 14px` (most likely a designer's
slight rounding preference, not a hard requirement).

### 3.3 Body font size (mockup 15px vs design system 14px)

`mockups/styles/main.css` line 67 declares `body { font-size: 15px; }`.
`primitives.css` line 14 declares `body { font-size: 14px; }`. The
README §"Type" specifies "14px body" explicitly. Mockup is 1px off.

**Decision:** mockup is wrong; the README is the spec. Leave design
system at 14px; don't touch the mockup (it is a reference, not the
shipping surface).

### 3.4 Mirror file drift — `mockups/design-system-dark.css`

The mockups' bundled self-contained design system file at
`mockups/design-system-dark.css` is a frozen snapshot — it bundles
`primitives.css` into a single file for the mockup HTML to import
directly. The current snapshot pre-dates this reconciliation.

**Follow-up:** `P0.1c — sync mockups/design-system-dark.css to current
design system`. One-time copy, then add a comment in both files
pointing at each other so future drift is obvious. Until that's done,
opening a mockup HTML will render with the older scale; the live app
will render with the new one. This is a documentation problem, not a
functional one — the mockups are not loaded by the app.

---

## 4. File map — what lives where

```
00-foundations/design/
  README.md                   — the design system guide (read this first)
  tokens.css                  — canonical :root tokens (DARK theme, the
                                default).  Source of truth.
  design-system-dark.css      — mirror of tokens.css (used when a
                                consumer wants to import a theme-named
                                file rather than the generic tokens).
                                Keep in sync with tokens.css.
  design-system-light.css     — [data-theme="light"] overrides ONLY.
                                The base values come from tokens.css.
                                Per-theme overrides live here.
  primitives.css              — element styles + component classes
                                (.btn, .badge, .card, .nav, .footer,
                                .surface, .grid, etc.). Consumes
                                tokens, ships no values.
  icons.tsx                   — icon React components (separate concern,
                                see README §"Icons").

mockups/styles/
  main.css                    — the designer's reference CSS. Use it as
                                the visual ground truth, not as the
                                implementation.
  theme-light.css             — the mockup's light-theme override.
                                Out of sync with the design system
                                (see §3.4). Separate follow-up.

mockups/
  design-system-dark.css      — frozen self-contained bundle for the
                                HTML mockups. Pre-P0.1.
  design-system-light.css     — frozen self-contained light bundle.
                                Pre-P0.1.
  design-system.css           — legacy three-theme bundle. Pre-v4.
                                Use design-system-dark.css / -light.css
                                for new mockup work.
```

---

## 5. What to read before editing design tokens

1. `00-foundations/design/README.md` — the rules.
2. This file (the reconciliation log) — the current gap state.
3. `docs/BRAND_AND_POSITIONING.md` §"Two-signal color system" — the
   brand rules for action vs accent.
4. The mockup's `main.css` (the visual ground truth).
5. The 2026-06-15 brand-kit handoff spec at
   `/Users/klaas/.mavis/sessions/mvs_5a3f9d3d4a994cdea7e6bf3e2fd5922e/workspace/uthena-redesign-final/BRAND_KIT_HANDOFF_SPEC.md`
   if you are considering a brand change.

**The hard guardrails (still in force):**

- No third color. Orange and teal are the only brand signals.
- Orange = action (do this now). Teal = identity (you are here).
- Footer is light on dark page, dark on light page. No exceptions.
- No inline hex values in components. No `style={{ padding: '13px' }}`.
- Every new token is a CSS custom property in `tokens.css` with a
  one-line comment explaining when to use it.
- Mirror files (`design-system-dark.css`, `mockups/design-system-dark.css`)
  must be kept in sync with `tokens.css`. If you change one, change all.
