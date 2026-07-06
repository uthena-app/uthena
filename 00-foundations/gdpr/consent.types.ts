// Type + default state for the cookie-consent surface. LIVES IN A
// SEPARATE FILE FROM `consent.ts` because that file is marked
// `'use server'` (it owns the `recordConsent` async function) and
// Next.js requires `'use server'` files to only export async
// functions. Putting the type + DEFAULT_CONSENT here means the type
// + default are importable from client islands + RSCs + tests
// without dragging in the server-only file.

export type ConsentState = {
  /** Always on. The site can't run without the cookies this
   *  category covers (auth, cart, CSRF). Locked at the schema
   *  layer (the action's input shape omits it) and at the UI
   *  layer (no toggle). */
  essential: true
  analytics: boolean
  marketing: boolean
}

export const DEFAULT_CONSENT: ConsentState = {
  essential: true,
  analytics: false,
  marketing: false,
}