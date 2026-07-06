// curriculumOps — pure helpers for the wizard's Curriculum step
// (P12.7 Slice 2).
//
// The CurriculumStep client component owns UI state but the actual
// row transforms (add a module, add a lesson, move module up/down,
// remove a lesson) live here as PURE functions that take an array
// and return a new array. This keeps the component file thin and
// lets the operation semantics be unit-tested without rendering
// React.
//
// All helpers treat their input as immutable — they never mutate
// the input array or its elements. The component is responsible
// for setting the returned value back into React state, which
// drives the autosave.

import { CURRICULUM_MAX_LESSONS_PER_MODULE, CURRICULUM_MAX_MODULES } from './saveUploadDraftSchema'

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

/** Mint a stable id for a new module or lesson. Uses
 *  `crypto.randomUUID()` (browser-native; works in Node 18+ and all
 *  modern browsers). The id is opaque to the server — the
 *  `id` field on the DB tables is a synthetic column managed
 *  by Supabase; this id is a draft-only identifier that
 *  correlates draft-row edits with the eventual
 *  `product_modules` / `product_lessons` rows on submit.
 *
 *  Falls back to a timestamp-based id if the runtime doesn't
 *  expose `crypto.randomUUID()` (covers older Safari + Edge on
 *  legacy Windows in the rare case `crypto` is unavailable).
 */
export function makeCurriculumId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // RFC 4122 v4 — 36 chars, hex + dashes. Falls back to Math.random
  // for the two fixed-format nibbles; the spec only requires
  // uniqueness within the user's draft, not cryptographic strength.
  const s = (n: number) =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0')
  return `${s(1)}-${s(2)}-4${s(3).slice(1)}-${s(4)}-${s(5)}${s(6)}`
}

// ---------------------------------------------------------------------------
// Module reordering + add/remove
// ---------------------------------------------------------------------------

export type ModuleShape = {
  id: string
  title: string
  summary?: string | null | undefined
  display_order: number
  lessons: LessonShape[]
}

export type LessonShape = {
  id: string
  title: string
  summary?: string | null | undefined
  duration_seconds: number
  is_preview: boolean
  display_order: number
}

/** Append a new module to the end of the list. Caller supplies the
 *  module shape (id is expected to be pre-minted via
 *  `makeCurriculumId()`). The returned array has display_order
 *  re-derived 0..N-1 so persistence + future re-renders see a
 *  stable order. */
export function appendModule(modules: ModuleShape[], next: ModuleShape): ModuleShape[] {
  return withDeriveOrder([...modules, next])
}

/** Insert a new module at a specific zero-based index. Useful for
 *  the future "insert between" affordance; Slice 2's UI uses append
 *  only, but the helper exists for tests + future slices.
 *  Out-of-range `atIndex` falls back to appending at the end. */
export function insertModuleAt(modules: ModuleShape[], next: ModuleShape, atIndex: number): ModuleShape[] {
  const idx = clamp(atIndex, 0, modules.length)
  const out = [...modules.slice(0, idx), next, ...modules.slice(idx)]
  return withDeriveOrder(out)
}

/** Remove a module by id. Returns the original array unchanged when
 *  the id is unknown (caller's UI button shouldn't disappear
 *  without reason — fail-safe no-op is the right call here). */
export function removeModuleById(modules: ModuleShape[], id: string): ModuleShape[] {
  const idx = modules.findIndex((m) => m.id === id)
  if (idx === -1) return modules
  return withDeriveOrder([...modules.slice(0, idx), ...modules.slice(idx + 1)])
}

/** Move a module one position up (toward index 0) or down (toward
 *  the end). `direction = -1` = up, `direction = 1` = down. No-op
 *  at the boundaries (the UI disables the relevant button, but
 *  this is defensive). Unknown id → no-op. */
export function moveModuleById(modules: ModuleShape[], id: string, direction: -1 | 1): ModuleShape[] {
  const idx = modules.findIndex((m) => m.id === id)
  if (idx === -1) return modules
  const target = idx + direction
  if (target < 0 || target >= modules.length) return modules
  const out = [...modules]
  ;[out[idx], out[target]] = [out[target]!, out[idx]!]
  return withDeriveOrder(out)
}

/** Compute boundary booleans for the up/down buttons on a module. */
export function moduleMoveBounds(modules: ModuleShape[], id: string): { canMoveUp: boolean; canMoveDown: boolean } {
  const idx = modules.findIndex((m) => m.id === id)
  if (idx === -1) return { canMoveUp: false, canMoveDown: false }
  return { canMoveUp: idx > 0, canMoveDown: idx < modules.length - 1 }
}

// ---------------------------------------------------------------------------
// Lesson reordering + add/remove (per module)
// ---------------------------------------------------------------------------

/** Append a new lesson to the end of a module's lessons list. */
export function appendLesson(lessons: LessonShape[], next: LessonShape): LessonShape[] {
  return withDeriveOrder([...lessons, next])
}

/** Remove a lesson by id from a lessons list. Unknown id → no-op. */
export function removeLessonById(lessons: LessonShape[], id: string): LessonShape[] {
  const idx = lessons.findIndex((l) => l.id === id)
  if (idx === -1) return lessons
  return withDeriveOrder([...lessons.slice(0, idx), ...lessons.slice(idx + 1)])
}

/** Move a lesson by id within a module. Same -1/1 direction
 *  semantics as `moveModuleById`. */
export function moveLessonById(lessons: LessonShape[], id: string, direction: -1 | 1): LessonShape[] {
  const idx = lessons.findIndex((l) => l.id === id)
  if (idx === -1) return lessons
  const target = idx + direction
  if (target < 0 || target >= lessons.length) return lessons
  const out = [...lessons]
  ;[out[idx], out[target]] = [out[target]!, out[idx]!]
  return withDeriveOrder(out)
}

/** Boundary booleans for the up/down buttons on a lesson. */
export function lessonMoveBounds(lessons: LessonShape[], id: string): { canMoveUp: boolean; canMoveDown: boolean } {
  const idx = lessons.findIndex((l) => l.id === id)
  if (idx === -1) return { canMoveUp: false, canMoveDown: false }
  return { canMoveUp: idx > 0, canMoveDown: idx < lessons.length - 1 }
}

// ---------------------------------------------------------------------------
// Iteration counters (right-rail "X modules · Y lessons · Z min" —
// deferred to a future slice, but exposed here so the lesson-counting
// logic is testable now)
// ---------------------------------------------------------------------------

/** Total lessons across every module. */
export function countLessons(modules: ModuleShape[]): number {
  let n = 0
  for (const m of modules) n += m.lessons.length
  return n
}

/** Total seconds of lesson content across every module. */
export function totalLessonSeconds(modules: ModuleShape[]): number {
  let s = 0
  for (const m of modules) for (const l of m.lessons) s += l.duration_seconds
  return s
}

// ---------------------------------------------------------------------------
// Capacity caps (mirror the schema; explicit constants here so the
// component doesn't have to import the schema directly just to
// decide whether to gray out an "Add" button)
// ---------------------------------------------------------------------------

export const MAX_MODULES = CURRICULUM_MAX_MODULES
export const MAX_LESSONS_PER_MODULE = CURRICULUM_MAX_LESSONS_PER_MODULE

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Re-derive `display_order` 0..N-1 for a fresh list. Pure — the
 *  caller treats the returned list as the new ordering source of
 *  truth. Matches the spec implementation note: "the partner
 *  detail page replaces the full tree, so we never have stale
 *  gaps" (migration 0039, product_modules.display_order comment). */
function withDeriveOrder<T extends { display_order: number }>(list: T[]): T[] {
  return list.map((row, i) => ({ ...row, display_order: i }))
}

/** Defensive clamp for `insertModuleAt`. */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isInteger(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}
