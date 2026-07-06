// featureFlags.ts — pure helpers + Zod schemas for the Feature flags
// surface on `/admin/settings` (P14.14).
//
// The shape is a jsonb array of feature flags. Each flag has:
//   - key:           non-empty string, lowercase + digits + underscore, max 60 chars
//   - enabled:       boolean
//   - description:   string, max 500 chars
//   - rollout_pct:   optional integer 0..100; null means 100% (full rollout)
//
// The DB CHECK constraint in migration 0063 enforces the same invariants;
// these Zod schemas are the canonical wire-shape contract.

import { z } from 'zod'

/** Canonical feature-flag shape. */
export const FeatureFlagSchema = z
  .object({
    key: z
      .string()
      .min(1, 'Key cannot be empty.')
      .max(60, 'Key is too long.')
      .regex(/^[a-z0-9_]+$/, 'Key must be lowercase letters, digits, and underscores only.'),
    enabled: z.boolean(),
    description: z.string().max(500, 'Description is too long.').default(''),
    rollout_pct: z
      .number()
      .int('Rollout percentage must be a whole number.')
      .min(0, 'Rollout cannot be below 0%.')
      .max(100, 'Rollout cannot exceed 100%.')
      .nullable()
      .default(null),
  })
  .strict()

/** Array of feature flags. */
export const FeatureFlagsSchema = z.array(FeatureFlagSchema).max(100, 'Too many flags.')

export type FeatureFlag = z.infer<typeof FeatureFlagSchema>
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>

/**
 * Wire shape for the `addFlag` server action. The new flag is created
 * with the admin's defaults; missing fields are coerced to the schema
 * defaults (description='', rollout_pct=null).
 */
export const AddFeatureFlagInputSchema = z
  .object({
    key: FeatureFlagSchema.shape.key,
    enabled: z.boolean().default(false),
    description: FeatureFlagSchema.shape.description.default(''),
    rollout_pct: FeatureFlagSchema.shape.rollout_pct.default(null),
  })
  .strict()

export type AddFeatureFlagInput = z.infer<typeof AddFeatureFlagInputSchema>

/**
 * Wire shape for the `updateFlag` server action. Only the fields the
 * admin edited are sent; the action merges them into the existing row
 * (PATCH semantics). `key` is the identity, never editable.
 */
export const UpdateFeatureFlagInputSchema = z
  .object({
    key: FeatureFlagSchema.shape.key,
    enabled: z.boolean().optional(),
    description: FeatureFlagSchema.shape.description.optional(),
    rollout_pct: FeatureFlagSchema.shape.rollout_pct.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.enabled !== undefined ||
      v.description !== undefined ||
      v.rollout_pct !== undefined ||
      v.rollout_pct === null,
    { message: 'At least one field must be provided.' },
  )

export type UpdateFeatureFlagInput = z.infer<typeof UpdateFeatureFlagInputSchema>

/**
 * Wire shape for the `removeFlag` server action. Just the key.
 */
export const RemoveFeatureFlagInputSchema = z
  .object({
    key: FeatureFlagSchema.shape.key,
  })
  .strict()

export type RemoveFeatureFlagInput = z.infer<typeof RemoveFeatureFlagInputSchema>

// ---------------------------------------------------------------------------
// Coercion helpers (defensive parsing of arbitrary JSON values from the DB).
// ---------------------------------------------------------------------------

/**
 * Coerce a single JSON value to a `FeatureFlag`. Returns null when the
 * input doesn't have the right shape. Used by the read path + the action
 * to defend against malformed rows (e.g. someone hand-edited the DB).
 */
export function coerceFeatureFlag(input: unknown): FeatureFlag | null {
  if (!input || typeof input !== 'object') return null
  const v = input as Record<string, unknown>
  if (typeof v['key'] !== 'string' || v['key'].length === 0) return null
  if (typeof v['enabled'] !== 'boolean') return null
  const description = typeof v['description'] === 'string' ? v['description'] : ''
  if (description.length > 500) return null
  let rollout_pct: number | null = null
  if (v['rollout_pct'] != null) {
    if (typeof v['rollout_pct'] !== 'number') return null
    if (!Number.isInteger(v['rollout_pct'])) return null
    if (v['rollout_pct'] < 0 || v['rollout_pct'] > 100) return null
    rollout_pct = v['rollout_pct']
  }
  if (v['key'].length > 60) return null
  if (!/^[a-z0-9_]+$/.test(v['key'])) return null
  return {
    key: v['key'],
    enabled: v['enabled'],
    description,
    rollout_pct,
  }
}

/**
 * Coerce an arbitrary JSON value to a `FeatureFlags` array. Drops
 * malformed entries silently (defensive against partial corruption).
 * Returns an empty array when the input is not an array.
 */
export function coerceFeatureFlags(input: unknown): FeatureFlags {
  if (!Array.isArray(input)) return []
  const out: FeatureFlags = []
  for (const item of input) {
    const coerced = coerceFeatureFlag(item)
    if (coerced) out.push(coerced)
  }
  return out
}

/**
 * Sort flags alphabetically by key for stable rendering + deterministic
 * diff in the audit log. Pure; returns a new array.
 */
export function sortFlags(flags: FeatureFlags): FeatureFlags {
  return [...flags].sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Find a flag by key. Returns undefined when not found.
 */
export function findFlag(flags: FeatureFlags, key: string): FeatureFlag | undefined {
  return flags.find((f) => f.key === key)
}

/**
 * Check whether a key already exists. Used by the add action's
 * idempotency gate.
 */
export function hasFlag(flags: FeatureFlags, key: string): boolean {
  return flags.some((f) => f.key === key)
}

/**
 * Compute a focused diff between two flag sets for the audit row's
 * metadata. Returns:
 *   - added:   keys present in `next` but not `current`
 *   - removed: keys present in `current` but not `next`
 *   - changed: keys present in both with at least one differing field,
 *              mapped to { key, before: <old fields>, after: <new fields> }
 */
export type FeatureFlagDiff = {
  added: string[]
  removed: string[]
  changed: Array<{
    key: string
    before: Partial<Pick<FeatureFlag, 'enabled' | 'description' | 'rollout_pct'>>
    after: Partial<Pick<FeatureFlag, 'enabled' | 'description' | 'rollout_pct'>>
  }>
}

export function diffFlags(current: FeatureFlags, next: FeatureFlags): FeatureFlagDiff {
  const currentMap = new Map(current.map((f) => [f.key, f]))
  const nextMap = new Map(next.map((f) => [f.key, f]))
  const added: string[] = []
  const removed: string[] = []
  const changed: FeatureFlagDiff['changed'] = []

  for (const [key, f] of nextMap.entries()) {
    if (!currentMap.has(key)) {
      added.push(key)
    }
  }
  for (const key of currentMap.keys()) {
    if (!nextMap.has(key)) {
      removed.push(key)
    }
  }
  for (const [key, nextFlag] of nextMap.entries()) {
    const cur = currentMap.get(key)
    if (!cur) continue
    const before: FeatureFlagDiff['changed'][number]['before'] = {}
    const after: FeatureFlagDiff['changed'][number]['after'] = {}
    if (cur.enabled !== nextFlag.enabled) {
      before.enabled = cur.enabled
      after.enabled = nextFlag.enabled
    }
    if (cur.description !== nextFlag.description) {
      before.description = cur.description
      after.description = nextFlag.description
    }
    if (cur.rollout_pct !== nextFlag.rollout_pct) {
      before.rollout_pct = cur.rollout_pct
      after.rollout_pct = nextFlag.rollout_pct
    }
    if (Object.keys(before).length > 0) {
      changed.push({ key, before, after })
    }
  }
  // Sort for deterministic audit-row output
  added.sort()
  removed.sort()
  changed.sort((a, b) => a.key.localeCompare(b.key))
  return { added, removed, changed }
}

/**
 * Apply an `add` operation to a flag set. Throws if the key already
 * exists (the caller should check first). Returns a NEW sorted array.
 */
export function applyAddFlag(flags: FeatureFlags, add: FeatureFlag): FeatureFlags {
  if (hasFlag(flags, add.key)) {
    throw new Error(`Flag with key "${add.key}" already exists.`)
  }
  return sortFlags([...flags, add])
}

/**
 * Apply a `remove` operation. No-op if the key doesn't exist.
 * Returns a NEW sorted array.
 */
export function applyRemoveFlag(flags: FeatureFlags, key: string): FeatureFlags {
  return sortFlags(flags.filter((f) => f.key !== key))
}

/**
 * Apply a `update` (PATCH) operation to an existing flag. Throws if the
 * key doesn't exist (the caller should check first). Returns a NEW
 * sorted array.
 */
export function applyUpdateFlag(
  flags: FeatureFlags,
  patch: UpdateFeatureFlagInput,
): FeatureFlags {
  if (!hasFlag(flags, patch.key)) {
    throw new Error(`Flag with key "${patch.key}" does not exist.`)
  }
  const next = flags.map((f) => {
    if (f.key !== patch.key) return f
    return {
      ...f,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.rollout_pct !== undefined ? { rollout_pct: patch.rollout_pct } : {}),
    }
  })
  return sortFlags(next)
}

// ---------------------------------------------------------------------------
// Display helpers (used by the client island + the read query).
// ---------------------------------------------------------------------------

/**
 * Format a rollout percentage for display. Returns "100%" when null
 * (the convention: null rollout = full rollout).
 */
export function formatRolloutPct(rollout_pct: number | null): string {
  return rollout_pct == null ? '100%' : `${rollout_pct}%`
}