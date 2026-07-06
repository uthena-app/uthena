// geo.ts — IP-based geographic classification helpers for P11.2.
//
// The cookie-consent banner needs to know whether the visitor appears to
// be in the EU/EEA/UK (where GDPR + ePrivacy require explicit consent
// before non-essential cookies). We do NOT do a live geo lookup; we read
// the country code from the CDN's header (`x-vercel-ip-country` /
// `cf-ipcountry` / `x-country`) which is set by the edge proxy. If the
// header is absent, we fall back to "show the banner to all" (the
// PHASES.md P11.2 contract: "fall-back to show to all") — that's the
// safe default because the alternative ("no header = assume non-EU")
// would silently let GDPR visitors escape the consent flow.
//
// PII safety: the country code is two letters and never PII on its own.
// We never log the underlying IP, only the resolved country (and only
// inside audit-log metadata, never in plain logs).
//
// Why this is server-only:
//   - The user agent header is read via `next/headers`'s `headers()`.
//   - The pure country-list helpers (`isEuCountryCode`, `EU_COUNTRY_CODES`)
//     ARE exportable from here because they have no side effects and no
//     Node-only deps. They can be imported by client islands for the
//     "show all because we got GPC" branch if we ever ship a client-side
//     shortcut, but that isn't used today.

/** The set of ISO 3166-1 alpha-2 country codes covered by GDPR + ePrivacy.
 *  Includes all 27 current EU member states + the 3 EEA-only members
 *  (Iceland, Liechtenstein, Norway) + the United Kingdom (post-Brexit
 *  UK GDPR + PECR continue to require the same consent regime).
 *  Switzerland is also added as it follows the same nFADP regime that
 *  treats cookies as requiring consent. Source: cross-referenced against
 *  the EU's own member-state list + the ICO's UK GDPR guidance + the
 *  Swiss FDPIC nFADP guidance.
 *
 *  Sorted by code for testability / determinism. */
export const EU_COUNTRY_CODES: ReadonlySet<string> = new Set([
  // EU 27
  'AT', // Austria
  'BE', // Belgium
  'BG', // Bulgaria
  'HR', // Croatia
  'CY', // Cyprus
  'CZ', // Czechia
  'DK', // Denmark
  'EE', // Estonia
  'FI', // Finland
  'FR', // France
  'DE', // Germany
  'GR', // Greece
  'HU', // Hungary
  'IE', // Ireland
  'IT', // Italy
  'LV', // Latvia
  'LT', // Lithuania
  'LU', // Luxembourg
  'MT', // Malta
  'NL', // Netherlands
  'PL', // Poland
  'PT', // Portugal
  'RO', // Romania
  'SK', // Slovakia
  'SI', // Slovenia
  'ES', // Spain
  'SE', // Sweden
  // EEA-only (not EU but covered by GDPR via the EEA agreement)
  'IS', // Iceland
  'LI', // Liechtenstein
  'NO', // Norway
  // UK (post-Brexit UK GDPR + PECR are effectively equivalent)
  'GB', // United Kingdom
  // nFADP — same consent regime
  'CH', // Switzerland
])

/** Returns true when the given ISO 3166-1 alpha-2 country code is in the
 *  GDPR-relevant set. Empty / unknown / nullish input returns false
 *  (the safe-but-overshowing fallback lives outside this function). */
export function isEuCountryCode(code: string | null | undefined): boolean {
  if (!code) return false
  return EU_COUNTRY_CODES.has(code.toUpperCase())
}

/** The set of sentinels CDNs use to indicate "we can't determine a
 *  country". Cloudflare uses 'XX', MaxMind uses 'T1' (Tor). We treat
 *  these as "unknown" in the geo gate (the banner falls back to the
 *  safe-by-default "show all" path). The set lives in one place so
 *  adding a new provider's sentinel is a single-line change. */
const UNKNOWN_COUNTRY_SENTINELS: ReadonlySet<string> = new Set(['XX', 'T1'])

/** Header names the various CDN providers set for "visitor's country".
 *  Order matters: the first non-empty value wins. Centralized as a
 *  tuple constant so the `readCountryFromHeaders` function has exactly
 *  one source of truth for the list of probes. */
export const COUNTRY_HEADER_CANDIDATES: readonly string[] = [
  'cf-ipcountry', // Cloudflare
  'x-vercel-ip-country', // Vercel
  'x-country', // Generic CDN
  'x-appengine-country', // App Engine
  'fly-region', // Fly.io (region code; we coerce to country via prefix)
] as const

/** Read the country code from common CDN-set headers. Returns a clean
 *  2-letter code (uppercased + trimmed) when found, `null` otherwise.
 *  The first non-empty header wins. We DO NOT raise on missing headers
 *  — the absence case is what triggers "show banner to all".
 *
 *  Defensive: trims whitespace, upper-cases, validates against the
 *  ISO 3166-1 alpha-2 grammar `[A-Z]{2}` before returning. Garbage
 *  values (e.g. `xx-us` because of a debug proxy) get coerced to
 *  `null` so the caller can fall through. */
export function readCountryFromHeaders(
  headersList: Pick<Headers, 'get'> | undefined | null,
): string | null {
  if (!headersList) return null
  for (const name of COUNTRY_HEADER_CANDIDATES) {
    const raw = headersList.get(name)
    if (!raw) continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    // Fly.io sends a region code (`fly-region`); the visitor's actual
    // country is unknowable from a region. Skip — better to fall back
    // to "show all" than to misclassify via regional heuristic.
    if (name === 'fly-region') continue
    const upper = trimmed.toUpperCase()
    // "Unknown country" sentinels (Cloudflare XX, MaxMind T1) are
    // collapsed to null so the geo gate falls back to the
    // safe-by-default "show all" path (GDPR + ePrivacy require
    // consent before non-essential cookies — better to ask than to
    // silently skip the banner).
    if (UNKNOWN_COUNTRY_SENTINELS.has(upper)) continue
    // ISO 3166-1 alpha-2: two ASCII letters only. Garbage shapes
    // (e.g. `xx-us` from a debug proxy, `T1.5`) fall through to the
    // next candidate rather than poisoning the lookup.
    if (/^[A-Z]{2}$/.test(upper)) return upper
    continue
  }
  return null
}

/** The single canonical name for the GPC header. Per the Global Privacy
 *  Control spec the header is `Sec-GPC` (case-insensitive per HTTP/2,
 *  but always emitted lowercase by browsers). The value `1` signals
 *  "GPC is asserted for this browser/device". */
export const GPC_HEADER = 'sec-gpc'

/** Returns true when the incoming request carried `Sec-GPC: 1`. Per the
 *  GPC spec the value MUST be exactly `1` to opt out — any other value
 *  is "unspecified / not asserted" and we treat the request as a normal
 *  one. Case-insensitive header lookup (Next.js lowercases headers). */
export function isGpcEnabled(
  headersList: Pick<Headers, 'get'> | undefined | null,
): boolean {
  if (!headersList) return false
  const raw = headersList.get(GPC_HEADER)
  if (!raw) return false
  return raw.trim() === '1'
}
