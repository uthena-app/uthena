# `02-features/mobile-nav/`

Global mobile nav drawer for the SiteHeader. P0.5.

The desktop SiteHeader's secondary nav row (Home / All Courses /
Bundles / Earn with Uthena / FAQs / Course Portal) becomes a
horizontally-scrolling strip at ≤ 640px. On the smallest
viewports it gets crowded, and a few links (FAQs, Course Portal)
get squeezed off-screen. The mobile nav drawer is the
keyboard-first, screen-reader-first way to reach the same links
on a phone.

## Files

| File | Purpose |
|---|---|
| `MobileNav.tsx` | Client component. Owns the drawer DOM, the open/close state, the Escape/backdrop/route-change close handlers, the focus trap, the body-scroll lock, and the focus restore. |
| `MobileNavTrigger.tsx` | Tiny client island. Delegates `click` on any `[data-mobile-nav-trigger]` element to a `uthena:mobile-nav:open` window event the drawer listens for. Mounted once alongside the drawer. |
| `MobileNav.module.css` | Drawer + backdrop + nav + bottom-CTA styles. Token-only. |
| `mobileNavEvents.ts` | Module-scoped `MOBILE_NAV_OPEN_EVENT` constant. The bridge between the hamburger (RSC) and the drawer (client). |
| `index.ts` | Barrel. |

## How it wires together

```
SiteHeader (RSC)
  └── <button data-mobile-nav-trigger="true">    ← hamburger
  └── <MobileNavTrigger />                        ← client island
        └─ listens for clicks on [data-mobile-nav-trigger]
        └─ dispatches uthena:mobile-nav:open

03-app/layout.tsx
  └── <MobileNav />                               ← client component
        ├─ listens for uthena:mobile-nav:open
        ├─ listens for Escape while open
        ├─ closes on route change (usePathname)
        ├─ traps Tab inside the drawer
        └─ renders slide-in drawer (≤ 360px) with:
              brand + close
              search shortcut (delegates to SearchOverlay)
              primary nav (same items as SiteHeader)
              account link (Log in or /account)
              cart CTA (orange, full-width)
```

The drawer is fed by props from the SiteHeader (RSC) so the
nav items, cart count, and account state stay in sync with the
desktop header — no duplicate fetches.

## Acceptance criteria (P0.5)

- Hamburger button in the SiteHeader opens the drawer (visible
  only at ≤ 640px, where the desktop horizontal nav is hidden).
- Drawer slides in from the left; backdrop dims the page
  behind it (`--bg-overlay` + 6 px blur).
- Drawer content: brand · close · search shortcut · primary
  nav · account link · cart CTA.
- Search shortcut: clicking the input opens the existing
  SearchOverlay; pressing Enter inside the input prefills the
  overlay's query.
- Closes on Escape, click on the backdrop, click on any link
  inside the drawer (via route-change listener), or the
  explicit close button.
- Body scroll locked while open.
- Tab is trapped inside the drawer; Shift+Tab and Tab wrap.
- Focus moves to the close button on open; previous focus is
  restored on close.
- Active nav link uses the same `--accent` border + bold
  treatment as the desktop secondary nav.
- Account link: anon → "Log in" (eyebrow "Welcome"); authed →
  the user's display name (eyebrow "Signed in as").
- Cart CTA: orange, full-width, includes the live cart count.
- All styles use design tokens (no inline hex / px).
- `prefers-reduced-motion` disables the slide/fade animation.
- Mounts in `app/layout.tsx` once, alongside `SearchOverlay`
  and `SiteFooter`.

## Deferred (not in this slice)

- Off-canvas sub-menus (e.g. categories accordion inside the
  drawer). The current primary nav is the full nav; categories
  are reachable from the search overlay's idle body and from
  `/browse?category=`. If/when the primary nav grows beyond 6
  items, add a collapsible "Categories" group to the drawer.
- Swipe-to-close gesture. Keyboard + button + backdrop are
  the primary close affordances; iOS Safari handles
  overscroll-to-dismiss via the body scroll lock gracefully.
- Drawer-side "scrim" tap to close (Android-style). Backdrop
  click already serves that role.

## Known pattern (cross-reference)

- `02-features/search/` — same architectural pattern (RSC header
  + client island trigger + client overlay + window-event
  bridge). The two features can share the same `data-*` click
  delegation.
