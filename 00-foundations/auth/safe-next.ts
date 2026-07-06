// Open-redirect guard for auth redirects (signin / signup / reset /
// verify / guards / OAuth callback). Pure, sync, exported as a regular
// function — no Next.js, no Supabase, no React. Safe to import from
// server actions, RSC, route handlers, server components, and client
// components (a tiny utility).
//
// History: lived in `02-features/auth/redirect.ts` until P2.1 (auth
// guards audit). Moved here because (a) it's pure, (b) it's used by
// 6+ callers across `02-features/auth/*` + `03-app/*`, (c) the
// guards layer shouldn't depend on the auth feature layer (a layer
// violation per AGENTS.md).
//
// Rules (per spec §Security — "open redirect protection"):
//   - must be a string starting with `/`
//   - must NOT start with `//` (protocol-relative URL)
//   - must NOT contain `\` (some browsers treat as `/`)
//   - must NOT be `/:something://` (absolute URL with a fake scheme)
//   - must NOT start with `/<scheme>:` — bare-scheme paths like
//     `/javascript:alert(1)`, `/data:text/html,...`, `/mailto:foo@bar`
//     are not legitimate navigation targets. Defense in depth: most
//     browsers won't navigate to these via `Location:`, but a strict
//     parse-then-route path can be tricked into one. The `<scheme>`
//     shape is `[a-z][a-z0-9+.-]*` per RFC 3986 §3.1.
//   - must NOT contain `%2f%2f` (encoded slash bypass)
//
// Returning null tells callers to fall back to their default route.

export function safeNext(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  if (s.includes('\\')) return null
  if (/^\/[^/]*:\/\//.test(s)) return null
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(s)) return null
  if (s.toLowerCase().includes('%2f%2f')) return null
  return s
}
