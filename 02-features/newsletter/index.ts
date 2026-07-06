// Newsletter feature — the marketing email capture UI.
//
// The NewsletterBand is a 'use client' component (it owns its
// own form state + submit handler). Importing it from a server
// component is fine — the 'use client' boundary is crossed
// automatically and only the band's JS ships to the client.
//
// The component is used by:
//   - The home page (`@features/home` no longer re-exports it)
//   - The dedicated /newsletter page (P0.11)

export { NewsletterBand } from './NewsletterBand'