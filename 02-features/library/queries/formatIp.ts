// formatIp.ts — small pure helpers for the /library/downloads surface.
// Server-safe (no DB, no I/O). The page renders the user's OWN audit
// log (they're looking at their own data), so showing their own IP /
// user-agent / edge location is allowed. We still mask the last octet
// of the IPv4 address and shorten the user-agent to a short family
// label — the page is a defensible UX, not a raw admin dump.
//
// Why mask the last octet?
//   - The mask is a defensive habit. The user is looking at their own
//     IP, but if a future surface reuses these helpers for admin /
//     shared views, the masking is already in place.
//   - It matches the spec's "no PII in logs" rule. Logging the raw IP
//     is the same data class as logging an email; showing the raw IP
//     to the wrong audience has the same blast radius.
//
// Why shorten the user-agent?
//   - User-agent strings are 80-200+ chars and rarely readable.
//     "Chrome 124 on macOS" tells the user everything they need.
//   - The helper is the single source of truth — every UA-family
//     detection elsewhere (admin surfaces, dashboards) should reuse
//     this rather than reinventing it.

/**
 * Mask the last octet of an IPv4 address. Returns the input unchanged
 * if it's not a valid IPv4 (IPv6, null, garbage). The function does
 * NOT try to parse IPv6 — Bun / Bunny logs are IPv4 in v1.
 *
 * Examples:
 *   maskIp('192.168.1.42')   → '192.168.1.***'
 *   maskIp('10.0.0.1')       → '10.0.0.***'
 *   maskIp(null)             → '—'
 *   maskIp('::1')            → '::1'           (passthrough)
 *   maskIp('not-an-ip')      → 'not-an-ip'     (passthrough)
 */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return '—'
  // IPv4: 4 dot-separated decimals. We only mask when the shape matches.
  const parts = ip.split('.')
  if (parts.length !== 4) return ip
  const numeric = parts.every((p) => /^\d{1,3}$/.test(p))
  if (!numeric) return ip
  return `${parts[0]}.${parts[1]}.${parts[2]}.***`
}

/**
 * Shorten a user-agent string to a 1-line family label.
 *
 * Examples:
 *   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
 *     → 'Chrome 124 · macOS'
 *   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
 *     → 'Mobile Safari 17 · iOS'
 *   'curl/8.4.0'
 *     → 'curl 8.4'
 *   null
 *     → '—'
 *
 * The matching is order-dependent (Edge before Chrome, Chrome before Safari,
 * etc.) because the UA strings overlap. The function returns '—' for falsy
 * input so callers can use it as a one-liner.
 */
export function shortUserAgent(ua: string | null | undefined): string {
  if (!ua) return '—'
  // Order matters: Edge before Chrome (Edge UA contains "Chrome"), Chrome
  // before Safari (Chrome UA contains "Safari"), etc.
  let browser = ''
  let version = ''
  if (/Edg\//.test(ua)) {
    browser = 'Edge'
    version = extractVersion(ua, /Edg\/([\d.]+)/)
  } else if (/OPR\//.test(ua)) {
    browser = 'Opera'
    version = extractVersion(ua, /OPR\/([\d.]+)/)
  } else if (/Firefox\//.test(ua)) {
    browser = 'Firefox'
    version = extractVersion(ua, /Firefox\/([\d.]+)/)
  } else if (/Chrome\//.test(ua)) {
    browser = 'Chrome'
    version = extractVersion(ua, /Chrome\/([\d.]+)/)
  } else if (/Version\/.*Safari\//.test(ua) || /Mobile\/.*Safari/.test(ua)) {
    browser = /Mobile.*Safari/.test(ua) ? 'Mobile Safari' : 'Safari'
    version = extractVersion(ua, /Version\/([\d.]+)/)
  } else if (/curl\//.test(ua)) {
    browser = 'curl'
    version = extractVersion(ua, /curl\/([\d.]+)/)
  } else if (/PostmanRuntime\//.test(ua)) {
    browser = 'Postman'
    version = extractVersion(ua, /PostmanRuntime\/([\d.]+)/)
  } else {
    // Unknown — return the first 60 chars so the user can see something.
    return ua.length > 60 ? ua.slice(0, 57) + '...' : ua
  }
  const os = detectOs(ua)
  return os ? `${browser} ${version} · ${os}` : `${browser} ${version}`
}

/**
 * Extract the major version. Examples:
 *   extractVersion('Chrome/124.0.0.0', /Chrome\/([\d.]+)/) → '124'
 *   extractVersion('curl/8.4.0', /curl\/([\d.]+)/)         → '8'
 *   extractVersion('Firefox/125.0', /Firefox\/([\d.]+)/)   → '125'
 *
 * We always emit just the major — the surface label. "Chrome 124" is
 * what users recognize; "Chrome 124.0" reads as noise. Tools (curl,
 * Postman) live on the same line; a power user who needs the patch
 * version can paste the raw UA into a tool to read it. Keeping the
 * format consistent across browsers + tools means a single regex
 * captures the surface data and we don't have to teach the function
 * which kind of caller it's serving.
 */
function extractVersion(ua: string, re: RegExp): string {
  const m = ua.match(re)
  if (!m || !m[1]) return ''
  return m[1].split('.')[0] ?? ''
}

function detectOs(ua: string): string {
  if (/Windows NT/.test(ua)) return 'Windows'
  if (/Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) return 'macOS'
  if (/iPhone|iPad|iOS/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Linux/.test(ua)) return 'Linux'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  return ''
}
