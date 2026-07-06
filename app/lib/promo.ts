// Promo copy used by the global site header (announcement bar).
// Data-driven from a constant — Phase 17 wires the admin-editable
// version; for now this single string lives in source and matches the
// mockup (`mockups/home.html` line 17) exactly.
//
// Rendered structure (matches mockup markup):
//   <strong>{lead}</strong> — earn <span class="accent">{earn}</span>
//   on every sale  · <span class="dim">{suffix}</span>
//
// `lead` is teal (identity), `earn` is orange (action), `suffix` is
// default text dimmed. The SiteHeader owns the markup so the
// component stays the source of presentation; this file owns copy.

export const ANNOUNCEMENT_BAR = {
  /** Primary CTA phrase. Renders in teal (identity color). */
  lead: 'Become an affiliate',
  /** Highlight number. Renders in orange (action color). */
  earn: '20%',
  /** Trailing context line. Renders in default text color, dimmed. */
  suffix: 'Sign up and sell your own courses with PLR licenses',
} as const
