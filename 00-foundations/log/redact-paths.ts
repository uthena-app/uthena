// Pino redact paths — the single source of truth for what gets censored
// at write time. Imported by:
//
//   - `pino.ts`         → the production logger config
//   - `pino.test.ts`    → the regression guard (asserts behavior matches
//                         what the production config actually does)
//
// Why this file exists separately from `pino.ts`:
//   Pino's redact is a write-time safety net for AGENTS.md §2: "No PII
//   in logs. Ever. Mask emails, redact tokens, hash IDs." Keeping the
//   path list in one place (1) means there's one source of truth for the
//   test to mirror, (2) means future contributors can extend the list
//   without worrying about the pino initialization shape, and (3) lets
//   the test rebuild an identical pino instance to assert the production
//   behavior byte-for-byte (see the regression-guard comment in
//   `pino.test.ts`).
//
// Pino's actual redact syntax (from the @pinojs/redact internals +
// pino docs):
//
//   - `<field>`               → top-level field only
//   - `*.<field>`             → depth 1 (object property at any name)
//   - `*.*.<field>`           → depth 2
//   - `*.*.*.<field>`         → depth 3
//   - `*.*.*.*.<field>`       → depth 4
//   - `[*].<field>`           → top-level array element
//   - `<key>[*].<field>`      → nested array under a known property name
//                                (e.g. `users[*].email`)
//
//   **Pino does NOT support `**` deep wildcards** — that's a
//   JSON-path (RFC 9535) convention, not pino's syntax. Any `**.x`
//   path is silently a no-op: the redactor tokenizes it but never
//   matches anything past depth 1. We enumerate depths 0-4 explicitly
//   to approximate "any depth" without the false sense of security
//   that `**` provides.
//
//   Arrays are a special case. Pino's wildcard `*` does NOT match
//   array indices when applied to an object containing an array — the
//   redactor's `setValue` check (`hasOwnProperty(lastKey)`) returns
//   false for array keys. The reliable pattern for arrays is the
//   bracket syntax: `[*].<field>` for top-level arrays, and
//   `<knownKey>[*].<field>` for nested arrays (the array property
//   name must be known to pino up front).
//
//   We can't exhaustively enumerate every possible array property name
//   a future log call might use. The pragmatic approach: cover the
//   common cases (top-level arrays + object property patterns) and
//   require call sites to keep PII at known shallow depths in the
//   structured log contract (`schema.ts`). The redact list is the
//   safety net, not the primary defense.

/** The PII fields the redact list must catch. */
const PII_FIELDS = [
  'email',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'cookie',
  'secret',
  'apiKey',
  'card',
  'ssn',
] as const

/**
 * User-content fields that should never appear in logs (per the
 * structured-schema docs — these are free-form strings that could
 * contain anything). Top-level + depths 0-2; deep nesting is rare
 * for these.
 */
const USER_CONTENT_FIELDS = ['message', 'description', 'bio'] as const

/** Depth-N path with `*` wildcards. `depth = 0` returns the bare field. */
function depthPath(field: string, depth: number): string {
  if (depth === 0) return field
  return `${'*.'.repeat(depth)}${field}`
}

/**
 * Generate the full set of redact paths for a single field. Covers
 *   - depth 0 (top-level)
 *   - depth 1–4 (object property at that depth, via `*.x` wildcards)
 *   - top-level array (`[*].x`)
 *   - depth 1, 2, 3 arrays at known positions (e.g. `*.x[*].field`)
 *     for the case where the log shape is `{ wrapper: { items: [...] } }`.
 */
function pathsForField(field: string): string[] {
  const paths: string[] = []
  for (let depth = 0; depth <= 4; depth++) {
    paths.push(depthPath(field, depth))
  }
  // Top-level array elements
  paths.push(`[*].${field}`)
  // Nested array at known property positions. We use `*` for the
  // wrapper object's property name; the array property name is
  // covered by the explicit bracket. These are the most common
  // shapes that show up in practice:
  //   - { data: [...] }        → *.[*].field
  //   - { wrapper: { items: [...] } }  → *.*.[*].field
  //   - three-deep wrapper:   → *.*.*.[*].field
  paths.push(`*.[*].${field}`)
  paths.push(`*.*.[*].${field}`)
  paths.push(`*.*.*.[*].${field}`)
  return paths
}

/**
 * The canonical redact path list. Exported as `as const` so:
 *   - The test can import the same array (regression guard).
 *   - Future TS code that wants to enumerate paths can do so safely.
 */
export const REDACT_PATHS: readonly string[] = [
  // Literal paths — these are at known fixed locations and don't
  // need a wildcard. We list them first so pino's path compilation
  // (the `o[ns] = null` short-circuit) catches them before the
  // wildcard passes.
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'stripe.signature',

  // PII fields at depths 0-4 + array patterns
  ...PII_FIELDS.flatMap(pathsForField),

  // User-content fields at the same depths (capped at depth 2 to
  // keep the path list compact; deep nesting of free-form text is
  // extremely rare in practice).
  ...USER_CONTENT_FIELDS.map((field) => depthPath(field, 0)),
  ...USER_CONTENT_FIELDS.map((field) => depthPath(field, 1)),
  ...USER_CONTENT_FIELDS.map((field) => depthPath(field, 2)),
  ...USER_CONTENT_FIELDS.map((field) => `[*].${field}`),
]

/** The censor string written in place of redacted values. */
export const REDACT_CENSOR = '[REDACTED]'
