// Decode a Supabase access token (JWT) to extract the `session_id` claim.
// The session_id is what we match against `auth.sessions.id` to identify
// the current device on /account/settings.
//
// The Supabase JWT payload contains:
//   { sub: <user_id>, session_id: <session_uuid>, aal: 'aal1' | 'aal2', ... }
//
// We only need `session_id` for the "which row is the current one" UX on
// the settings page. The decoder is intentionally tiny: it doesn't verify
// the signature (the server already trusts the session via the
// getServerSupabase client's cookie reader) and it doesn't pull in a JWT
// library (the cost is one `Buffer.from(...).toString('utf8')`).
//
// Defensive: returns null on any malformed input. The caller treats null
// as "couldn't identify the current session" and falls back to the
// user-agent match heuristic in `getMySessions`.

export function decodeSessionIdFromJwt(jwt: string | null | undefined): string | null {
  if (!jwt) return null
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  const payload = parts[1]
  if (!payload) return null
  try {
    // The payload is base64url-encoded. Node's `Buffer.from(..., 'base64url')`
    // is available in Node.js 16+ and handles the URL-safe alphabet
    // (replacing `-` with `+` and `_` with `/` internally).
    const json = Buffer.from(payload, 'base64url').toString('utf8')
    const data = JSON.parse(json) as { session_id?: unknown }
    if (typeof data.session_id === 'string' && data.session_id.length > 0) {
      return data.session_id
    }
    return null
  } catch {
    return null
  }
}
