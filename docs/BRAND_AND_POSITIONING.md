# Uthena — Brand & Positioning

> Working doc. Drafted 2026-06-11, revised 2026-06-15 (v4 — two-signal color system). Iterate freely.

---

## 1. One-line positioning

**Uthena is the home for digital product entrepreneurs — courses, tools, and assets you can rebrand, resell, and run your business on.**

Alternative one-liners:
- *Run your digital product business on Uthena.*
- *Your digital business, ready to rebrand.*

---

## 2. Who we are NOT for

- **Not** a Udemy-style learning platform for end-consumers taking courses for self-improvement.
- **Not** a single-creator storefront (Kajabi, Teachable).
- **Not** a generic PLR dump with junk files.

The buyer persona is **the operator** — the person whose job is to *package and sell digital products*. They want inventory, infrastructure, and a path to revenue.

---

## 3. Target audience (ranked)

| # | Persona | What they want from Uthena |
|---|---------|----------------------------|
| 1 | **Digital entrepreneur / solopreneur** | PLR catalog, ready to rebrand and resell, with their own storefront |
| 2 | **Course creator / instructor** | Distribution + payouts for their PLR course |
| 3 | **Affiliate / niche site owner** | Affiliate links, custom storefront, recurring commissions |
| 4 | **Agency / consultant** | Whitelabel courses to package as client deliverables |
| 5 | **Marketplace owner** | Could later run their own Uthena-style marketplace (white-label) |

---

## 4. Three pillars

1. **Marketplace** — 600+ curated PLR video courses, plus digital assets (Canva, eBooks, templates, audio, prompts). All whitelabel / PLR / MRR.
2. **Platform** — your own storefront, course player, file vault, affiliate dashboard, payment tracking. We host it; you brand it.
3. **Toolbox** — beyond courses: every digital asset a course seller needs to launch and grow. *Uthena is the operating system for digital product businesses.*

---

## 5. Visual identity (v4 — 2026-06-15, current)

> v1 was too playful (full tri-color everywhere). v2 was too austere (perfect monochrome tool, but the dark felt cold and the brand DNA was invisible). v3 sat between them: still professional, still a tool, but the canvas had *temperature* and the brand color earned its place — with a single teal accent doing two jobs. v4 splits that single accent into two with **non-overlapping roles**: orange for action, teal for identity. Same dark canvas, same mood, sharper semantic split.

**Four versions live.**

### The principle

- **Logo is playful. Interface is professional.** The tri-color wordmark stays. The dark canvas stays. The two are no longer in conflict.
- **Two brand signals, non-overlapping roles.** Orange `#F3924A` = action (push the user forward: Buy, Subscribe, Add to cart, "SAVE %", MRR license, stars). Teal `#1ABC9C` = identity (show the user where they are: logo dot, links, focus, active nav, PLR license, selected state). The two never swap roles.
- **The canvas has temperature.** v3 introduced a 5-layer surface stack and section-level soft tints. v4 keeps that and adds a 6th surface (`--bg-elev-3` for input fills and popovers) and a section-tint utility class system (`.sec.tint-base` through `.sec.tint-orange`) for one-step shade variation.
- **One tri-color moment per page.** A small conic-gradient pip in the eyebrow tag is the only place the logo's full tri-color DNA peeks through. Reserved, not decorative.
- **Borders AND a touch of shadow.** Borders are the primary depth mechanism, with soft shadows on cards, popovers, and CTAs. Borders for structure, shadow for emphasis.
- **Type is dense and tool-like, slightly friendlier.** 14px body. Tighter line-height. Smaller type hierarchy. Inter for everything human, JetBrains Mono for everything numeric.
- **No emoji icons. No rotating cards. No pulse animations.** Tools don't wink at you.
- **Shape gets a touch more generous.** Cards and buttons move from 8/10px to 10/12/14/18px. Feels like a real product, not a terminal.

### Two themes (parallel)

**Dark** (default — `design-system-dark.css`): `#0E1012` page, layered surfaces, orange + teal brand signals. The mood is Linear / Resend / Coolify.

**Light** (`design-system-light.css`): warm off-white `#FAF9F5` page, layered surfaces, same orange + teal hex but with darker hover variants and bumped soft / line opacities for legibility on cream. The mood is Stripe Dashboard / Notion. **The light-theme footer is dark** (`#15181B`) — a light footer would vanish into the cream page.

Both themes are first-class. User can toggle. Both ship in v1.

### Color tokens

```css
/* Surfaces — 6 levels */
--bg:           #0E1012   /* page */
--bg-elev-1:    #15181B   /* card */
--bg-elev-2:    #1C2024   /* raised (hover, selected) */
--bg-elev-3:    #242A2F   /* popover, dropdown, input fill */
--bg-inset:     #0A0C0E   /* deeper than page — code, table stripes */
--bg-brand:     rgba(26, 188, 156, 0.04)  /* brand-tinted surface */

/* Borders */
--line:         #2A2F35
--line-strong:  #3A4148

/* Text */
--text-1: #ECECEE   /* primary */
--text-2: #A1A4AC   /* secondary */
--text-3: #6B6E76   /* tertiary, hints */
--text-4: #4A4D55   /* disabled */

/* ACTION — orange. Primary buttons, sale, MRR, stars. */
--action:        #F3924A;
--action-hover:  #FFA862;
--action-soft:   rgba(243, 146, 74, 0.12);
--action-line:   rgba(243, 146, 74, 0.30);

/* IDENTITY — teal. Logo dot, links, focus, active nav, PLR. */
--accent:        #1ABC9C;
--accent-hover:  #20D2AF;
--accent-soft:   rgba(26, 188, 156, 0.10);
--accent-line:   rgba(26, 188, 156, 0.25);

/* Sale / new — named aliases for spec pages */
--sale:          var(--action);
--sale-soft:     var(--action-soft);
--new:           var(--accent);
--new-soft:      var(--accent-soft);

/* Semantic only — never decorative */
--success / --warn / --danger / --info  (each with -soft and -line)
```

### v3 → v4 — what changed

v3 used a single teal accent (`#14A89A`) for everything: primary buttons, links, focus, active state, logo dot. v4 splits that into two:

- The teal shifts to a slightly brighter `#1ABC9C` (matches the spec mockups) and is renamed semantically to mean *identity* — where the user is, not what they should do next.
- A new orange (`#F3924A`) enters as the *action* signal — primary buttons, sale tags, MRR license, stars.
- Both colors come from the current uthena.com logo / palette DNA. No new third color.
- The footer is unchanged: still light (`#F4F4F4`) on the dark page for brand continuity.
- The light theme gets a dark footer (`#15181B`) for the same reason the dark page got a light footer.

The full per-element mapping (which token, where) is in `00-foundations/design/README.md` under "Two-signal color system." The section-tint utility class system and the light theme notes are also in that README.

### Logo treatment

- The tri-color wordmark (`u-th-e-n-a` in teal/yellow/orange) is the brand DNA. **It stays.**
- In the interface, the wordmark renders in **monochrome white** with a small teal dot as a separator. The full-color logo is reserved for places where it earns its keep: login, sign-up, marketing, public-facing mini-shops.
- We do NOT render the tri-color logo in the nav, sidebars, or dashboards. The dot + neutral wordmark is what people see 50 times a day.

### Typography

- **Display / headings:** Inter 600/700/800. Weights pulled in slightly from v1 (was 800, now 600) — denser, less shouty.
- **Body:** Inter 400/500.
- **Numbers / IDs / earnings / timestamps:** JetBrains Mono 500/600. *Every* price, *every* order ID, *every* percentage uses mono. Looks like a tool.

### Mood references (look-and-feel, not to copy)

- **Linear / Vercel** — calm dark, restrained type, hairline borders
- **Stripe Dashboard** — info density, mono numbers, sparse color
- **Coolify / Plausible / Resend** — operator tool feel, no marketing fluff
- **Notion** — restrained, neutral, the product speaks for itself

### Voice & tone

- **Confident, not corporate.** "Your business, ready to rebrand." not "Solutions for digital commerce enablement."
- **Direct, not salesy.** "600+ courses. Buy once, sell as your own." not "Discover our vast library of premium content solutions."
- **Operator-to-operator.** Speak like a peer who's already done this. No superlatives without numbers.
- **No exclamation marks. No emoji in product copy.** Ever.

---

## 6. Feature scope (same as before — v1, v2, v3, v4 split)

### v1 — must-have (do this right, ship it)
- Course catalog (15+ categories, search, filter, sort)
- High-quality product detail pages (PLR terms, course preview, instructor, reviews)
- User accounts (separate from Shopify)
- Course player (Bunny.net signed URLs, progress, full lesson list, captions)
- File vault (5TB, signed-URL downloads, expiring links, per-user access logs)
- Instructor portal — upload, see sales, request payout
- Affiliate dashboard — links, clicks, conversions, commissions, payouts
- Mini-shop per affiliate (`uthena.com/[handle]`) — branded storefront
- PayPal Mass Payout integration + immutable payout ledger
- **Migration from Shopify** — preserve customers, orders, digital access, and any active subscriptions; if subscriptions exist, cancellation must be self-service from the account area
- **Admin review queue** — approve / reject partner uploads (quality + rights)

### v2 — expand
- Bundles, memberships, custom-domain reseller storefronts, multi-language, quizzes/certificates, email automation, coupons, reviews & Q&A, instructor analytics

### v3 — new product types — the toolbox
- Canva templates, eBooks, Notion templates, prompt packs, audio, icon packs
- Unified product type system (video, file, bundle, link-out)

### v4+ — big swings (parking lot)
- **Uthena Studio** — in-browser course rebrand tool
- **Marketplace-in-a-box** — let someone run their own PLR marketplace
- **Partner API / MCP** — let Kajabi, GoHighLevel, Whop pull our catalog
