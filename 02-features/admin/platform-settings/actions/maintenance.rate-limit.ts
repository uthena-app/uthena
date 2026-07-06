// maintenance.rate-limit.ts — in-process sliding-window rate limit for
// the maintenance-mode toggle action.
//
// Per spec line 126: "10 maintenance-mode toggles per admin per day".
// The state lives in a Map<adminId, timestamp[]> on the Node process;
// the action calls `rateLimitVerdict` (pure) from `lib/maintenance.ts`
// to decide allow/deny, then records the attempt via `recordAttempt`.
//
// Next.js `'use server'` files can only export async functions, so the
// state mutations live in this separate pure module. The action imports
// the helpers; the helpers are not async (Map mutations).
//
// Not safe across serverless function restarts (the Map is per-process).
// A production deployment that runs multiple Node processes would
// need a Supabase-backed store (filed as STUB-012 follow-up; the same
// pattern as the partner-portal toggle rate limits from P14.5).

import { rateLimitVerdict } from '../lib/maintenance'

/** adminId → array of recent attempt timestamps (ms since epoch). */
const attempts = new Map<string, number[]>()

/** Test-only reset hook. Clears all in-memory state. */
export function _resetMaintenanceRateLimitForTests(): void {
  attempts.clear()
}

/**
 * Sliding-window verifier. Returns `{ allowed: true }` when the
 * caller can proceed, or `{ allowed: false, retryAfterSeconds }` when
 * the 10/day cap is exceeded.
 *
 * `now` is injected for testability (the action passes `Date.now()`).
 */
export function maintenanceRateLimitVerdict(
  adminId: string,
  now: number = Date.now(),
):
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number } {
  return rateLimitVerdict(attempts.get(adminId), now)
}

/**
 * Record a successful attempt. Called by the action after the DB
 * write commits (so failed attempts don't consume the budget).
 */
export function recordMaintenanceAttempt(adminId: string, now: number = Date.now()): void {
  const existing = attempts.get(adminId) ?? []
  attempts.set(adminId, [...existing, now])
}