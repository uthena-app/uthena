// curriculumOps.test.ts — unit tests for the pure helpers that
// drive the CurriculumStep state (P12.7 Slice 2).
//
// Covers:
//   - makeCurriculumId: returns a non-empty string; double-call
//     values differ; honors crypto.randomUUID when present
//   - appendModule: appends + re-derives display_order 0..N-1
//   - insertModuleAt: inserts at the requested index; clamps out-of-
//     range indexes to the closest valid boundary; re-derives
//     display_order
//   - removeModuleById: removes by id; re-derives display_order;
//     unknown id → no-op (returns the same array reference)
//   - moveModuleById: moves up/down; no-op at boundaries; unknown
//     id → no-op; re-derives display_order
//   - moduleMoveBounds: returns the correct canMoveUp / canMoveDown
//     pair at every position + for an unknown id
//   - appendLesson / removeLessonById / moveLessonById /
//     lessonMoveBounds: same semantics at the lesson level
//   - countLessons / totalLessonSeconds: sums across nested
//     modules + lessons

import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendLesson,
  appendModule,
  countLessons,
  insertModuleAt,
  lessonMoveBounds,
  makeCurriculumId,
  MAX_LESSONS_PER_MODULE,
  MAX_MODULES,
  moduleMoveBounds,
  moveLessonById,
  moveModuleById,
  removeLessonById,
  removeModuleById,
  totalLessonSeconds,
  type LessonShape,
  type ModuleShape,
} from './curriculumOps'

// ---------------------------------------------------------------------------
// Factories — cheap pure builders
// ---------------------------------------------------------------------------

let _idSeq = 0
function nextSeq(prefix = 'id'): string {
  _idSeq += 1
  return `${prefix}-${_idSeq.toString().padStart(4, '0')}`
}

function makeModule(overrides: Partial<ModuleShape> = {}): ModuleShape {
  return {
    id: overrides.id ?? nextSeq('m'),
    title: overrides.title ?? 'Module',
    summary: overrides.summary ?? '',
    display_order: overrides.display_order ?? 0,
    lessons: overrides.lessons ?? [],
  }
}

function makeLesson(overrides: Partial<LessonShape> = {}): LessonShape {
  return {
    id: overrides.id ?? nextSeq('l'),
    title: overrides.title ?? 'Lesson',
    summary: overrides.summary ?? '',
    duration_seconds: overrides.duration_seconds ?? 60,
    is_preview: overrides.is_preview ?? false,
    display_order: overrides.display_order ?? 0,
  }
}

beforeEach(() => {
  _idSeq = 0
})

// ---------------------------------------------------------------------------
// makeCurriculumId
// ---------------------------------------------------------------------------

describe('makeCurriculumId', () => {
  it('returns a non-empty string', () => {
    const id = makeCurriculumId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
  it('returns distinct values on successive calls', () => {
    const a = makeCurriculumId()
    const b = makeCurriculumId()
    expect(a).not.toBe(b)
  })
  it('honors crypto.randomUUID() when available (36 chars + canonical v4)', () => {
    // In Node 18+ and modern browsers, `crypto.randomUUID` returns
    // a canonical 36-char RFC 4122 v4 string. The helper falls back
    // to the manual builder only if `crypto` is unavailable; in the
    // vitest Node environment it always uses the canonical path.
    const id = makeCurriculumId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})

// ---------------------------------------------------------------------------
// appendModule
// ---------------------------------------------------------------------------

describe('appendModule', () => {
  it('appends a module to an empty list and assigns display_order 0', () => {
    const m = makeModule({ title: 'Intro' })
    const out = appendModule([], m)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: m.id, title: 'Intro', display_order: 0, lessons: [] })
  })
  it('appends + re-derives display_order 0..N-1', () => {
    const m0 = makeModule({ id: 'm0', title: 'A', display_order: 0 })
    const m1 = makeModule({ id: 'm1', title: 'B', display_order: 0 })
    const m2 = makeModule({ id: 'm2', title: 'New', display_order: 99 })
    const out = appendModule([m0, m1], m2)
    expect(out.map((m) => m.id)).toEqual(['m0', 'm1', 'm2'])
    expect(out.map((m) => m.display_order)).toEqual([0, 1, 2])
  })
  it("preserves the appended module's id + title + lessons", () => {
    const lesson = makeLesson({ id: 'l1', title: 'Lesson 1' })
    const newM = makeModule({ id: 'newM', title: 'Title', lessons: [lesson] })
    const out = appendModule([makeModule()], newM)
    expect(out[1]).toMatchObject({
      id: 'newM',
      title: 'Title',
      lessons: [lesson],
      display_order: 1,
    })
  })
  it('does not mutate the input array', () => {
    const original: ModuleShape[] = []
    const before = original.length
    appendModule(original, makeModule())
    expect(original.length).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// insertModuleAt
// ---------------------------------------------------------------------------

describe('insertModuleAt', () => {
  it('inserts a module at the requested index', () => {
    const m0 = makeModule({ id: 'm0' })
    const m1 = makeModule({ id: 'm1' })
    const newM = makeModule({ id: 'NEW' })
    const out = insertModuleAt([m0, m1], newM, 1)
    expect(out.map((m) => m.id)).toEqual(['m0', 'NEW', 'm1'])
    expect(out.map((m) => m.display_order)).toEqual([0, 1, 2])
  })
  it('inserting at index 0 prepends', () => {
    const out = insertModuleAt([makeModule({ id: 'A' })], makeModule({ id: 'B' }), 0)
    expect(out.map((m) => m.id)).toEqual(['B', 'A'])
  })
  it('inserting at index === length appends', () => {
    const out = insertModuleAt([makeModule({ id: 'A' })], makeModule({ id: 'B' }), 1)
    expect(out.map((m) => m.id)).toEqual(['A', 'B'])
  })
  it('out-of-range index falls back to a clamped boundary (no throw)', () => {
    // Negative index → clamps to 0 (prepend).
    expect(insertModuleAt([makeModule({ id: 'A' })], makeModule({ id: 'B' }), -5).map((m) => m.id)).toEqual([
      'B',
      'A',
    ])
    // Beyond the end → clamps to length (append).
    expect(insertModuleAt([makeModule({ id: 'A' })], makeModule({ id: 'B' }), 99).map((m) => m.id)).toEqual([
      'A',
      'B',
    ])
  })
  it('non-integer index falls back to 0 (defensive clamp)', () => {
    const out = insertModuleAt([makeModule({ id: 'A' })], makeModule({ id: 'B' }), 0.5)
    expect(out[0]?.id).toBe('B')
  })
})

// ---------------------------------------------------------------------------
// removeModuleById
// ---------------------------------------------------------------------------

describe('removeModuleById', () => {
  it('removes a module by id and re-derives display_order', () => {
    const ms = [makeModule({ id: 'm0' }), makeModule({ id: 'm1' }), makeModule({ id: 'm2' })]
    const out = removeModuleById(ms, 'm1')
    expect(out.map((m) => m.id)).toEqual(['m0', 'm2'])
    expect(out.map((m) => m.display_order)).toEqual([0, 1])
  })
  it('returns the same array reference when id is unknown (no-op)', () => {
    const ms = [makeModule({ id: 'm0' })]
    const out = removeModuleById(ms, 'no-such-id')
    expect(out).toBe(ms)
  })
  it('removing the only module returns []', () => {
    const out = removeModuleById([makeModule({ id: 'm0' })], 'm0')
    expect(out).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// moveModuleById
// ---------------------------------------------------------------------------

describe('moveModuleById', () => {
  it('moves a module up by 1', () => {
    const ms = [makeModule({ id: 'm0' }), makeModule({ id: 'm1' }), makeModule({ id: 'm2' })]
    const out = moveModuleById(ms, 'm1', -1)
    expect(out.map((m) => m.id)).toEqual(['m1', 'm0', 'm2'])
    expect(out.map((m) => m.display_order)).toEqual([0, 1, 2])
  })
  it('moves a module down by 1', () => {
    const ms = [makeModule({ id: 'm0' }), makeModule({ id: 'm1' }), makeModule({ id: 'm2' })]
    const out = moveModuleById(ms, 'm1', 1)
    expect(out.map((m) => m.id)).toEqual(['m0', 'm2', 'm1'])
  })
  it('returns the same array reference at the up boundary (m0 → -1)', () => {
    const ms = [makeModule({ id: 'm0' }), makeModule({ id: 'm1' })]
    const out = moveModuleById(ms, 'm0', -1)
    expect(out).toBe(ms)
  })
  it('returns the same array reference at the down boundary (last → +1)', () => {
    const ms = [makeModule({ id: 'm0' }), makeModule({ id: 'm1' })]
    const out = moveModuleById(ms, 'm1', 1)
    expect(out).toBe(ms)
  })
  it('returns the same array reference for an unknown id', () => {
    const ms = [makeModule({ id: 'm0' })]
    const out = moveModuleById(ms, 'nope', -1)
    expect(out).toBe(ms)
  })
})

// ---------------------------------------------------------------------------
// moduleMoveBounds
// ---------------------------------------------------------------------------

describe('moduleMoveBounds', () => {
  it('first module: canMoveUp=false, canMoveDown=true', () => {
    const ms = [makeModule({ id: 'm0' }), makeModule({ id: 'm1' })]
    expect(moduleMoveBounds(ms, 'm0')).toEqual({ canMoveUp: false, canMoveDown: true })
  })
  it('middle module: both canMoveUp and canMoveDown are true', () => {
    const ms = [makeModule({ id: 'm0' }), makeModule({ id: 'm1' }), makeModule({ id: 'm2' })]
    expect(moduleMoveBounds(ms, 'm1')).toEqual({ canMoveUp: true, canMoveDown: true })
  })
  it('last module: canMoveUp=true, canMoveDown=false', () => {
    const ms = [makeModule({ id: 'm0' }), makeModule({ id: 'm1' })]
    expect(moduleMoveBounds(ms, 'm1')).toEqual({ canMoveUp: true, canMoveDown: false })
  })
  it('single module: both canMove values are false', () => {
    expect(moduleMoveBounds([makeModule({ id: 'm0' })], 'm0')).toEqual({
      canMoveUp: false,
      canMoveDown: false,
    })
  })
  it('unknown id: both canMove values are false (defensive no-op)', () => {
    expect(moduleMoveBounds([makeModule({ id: 'm0' })], 'nope')).toEqual({
      canMoveUp: false,
      canMoveDown: false,
    })
  })
})

// ---------------------------------------------------------------------------
// Lesson helpers (mirrors the module helpers — test geometry only)
// ---------------------------------------------------------------------------

describe('appendLesson / removeLessonById', () => {
  it('appendLesson appends + re-derives display_order', () => {
    const ls = [makeLesson({ id: 'l0', display_order: 0 }), makeLesson({ id: 'l1', display_order: 1 })]
    const out = appendLesson(ls, makeLesson({ id: 'lN', display_order: 99 }))
    expect(out.map((l) => l.id)).toEqual(['l0', 'l1', 'lN'])
    expect(out.map((l) => l.display_order)).toEqual([0, 1, 2])
  })
  it('removeLessonById removes by id + re-derives display_order', () => {
    const ls = [makeLesson({ id: 'l0' }), makeLesson({ id: 'l1' }), makeLesson({ id: 'l2' })]
    const out = removeLessonById(ls, 'l1')
    expect(out.map((l) => l.id)).toEqual(['l0', 'l2'])
    expect(out.map((l) => l.display_order)).toEqual([0, 1])
  })
  it('removeLessonById returns the same array for an unknown id', () => {
    const ls = [makeLesson({ id: 'l0' })]
    const out = removeLessonById(ls, 'nope')
    expect(out).toBe(ls)
  })
})

describe('moveLessonById', () => {
  it('moves up by 1', () => {
    const ls = [makeLesson({ id: 'l0' }), makeLesson({ id: 'l1' }), makeLesson({ id: 'l2' })]
    const out = moveLessonById(ls, 'l1', -1)
    expect(out.map((l) => l.id)).toEqual(['l1', 'l0', 'l2'])
  })
  it('moves down by 1', () => {
    const ls = [makeLesson({ id: 'l0' }), makeLesson({ id: 'l1' }), makeLesson({ id: 'l2' })]
    const out = moveLessonById(ls, 'l1', 1)
    expect(out.map((l) => l.id)).toEqual(['l0', 'l2', 'l1'])
  })
  it('returns the same array reference at the up boundary', () => {
    const ls = [makeLesson({ id: 'l0' }), makeLesson({ id: 'l1' })]
    const out = moveLessonById(ls, 'l0', -1)
    expect(out).toBe(ls)
  })
  it('returns the same array reference at the down boundary', () => {
    const ls = [makeLesson({ id: 'l0' }), makeLesson({ id: 'l1' })]
    const out = moveLessonById(ls, 'l1', 1)
    expect(out).toBe(ls)
  })
  it('returns the same array reference for an unknown id', () => {
    const ls = [makeLesson({ id: 'l0' })]
    const out = moveLessonById(ls, 'nope', -1)
    expect(out).toBe(ls)
  })
})

describe('lessonMoveBounds', () => {
  it('first lesson: canMoveUp=false, canMoveDown=true', () => {
    const ls = [makeLesson({ id: 'l0' }), makeLesson({ id: 'l1' })]
    expect(lessonMoveBounds(ls, 'l0')).toEqual({ canMoveUp: false, canMoveDown: true })
  })
  it('middle lesson: both true', () => {
    const ls = [makeLesson({ id: 'l0' }), makeLesson({ id: 'l1' }), makeLesson({ id: 'l2' })]
    expect(lessonMoveBounds(ls, 'l1')).toEqual({ canMoveUp: true, canMoveDown: true })
  })
  it('last lesson: canMoveUp=true, canMoveDown=false', () => {
    const ls = [makeLesson({ id: 'l0' }), makeLesson({ id: 'l1' })]
    expect(lessonMoveBounds(ls, 'l1')).toEqual({ canMoveUp: true, canMoveDown: false })
  })
  it('single lesson: both false', () => {
    expect(lessonMoveBounds([makeLesson({ id: 'l0' })], 'l0')).toEqual({
      canMoveUp: false,
      canMoveDown: false,
    })
  })
  it('unknown id: both false', () => {
    expect(lessonMoveBounds([makeLesson({ id: 'l0' })], 'nope')).toEqual({
      canMoveUp: false,
      canMoveDown: false,
    })
  })
})

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

describe('countLessons / totalLessonSeconds', () => {
  it('countLessons sums across modules', () => {
    const ms: ModuleShape[] = [
      makeModule({ lessons: [makeLesson(), makeLesson(), makeLesson()] }),
      makeModule({ lessons: [makeLesson()] }),
      makeModule({ lessons: [] }),
    ]
    expect(countLessons(ms)).toBe(4)
  })
  it('countLessons on empty array is 0', () => {
    expect(countLessons([])).toBe(0)
  })
  it('totalLessonSeconds sums durations across every lesson', () => {
    const ms: ModuleShape[] = [
      makeModule({ lessons: [makeLesson({ duration_seconds: 60 }), makeLesson({ duration_seconds: 120 })] }),
      makeModule({ lessons: [makeLesson({ duration_seconds: 30 })] }),
    ]
    expect(totalLessonSeconds(ms)).toBe(210)
  })
  it('totalLessonSeconds allows 0-second lessons (text/PDF)', () => {
    const ms: ModuleShape[] = [makeModule({ lessons: [makeLesson({ duration_seconds: 0 })] })]
    expect(totalLessonSeconds(ms)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Capacity caps (mirror schema)
// ---------------------------------------------------------------------------

describe('capacity caps', () => {
  it('MAX_MODULES matches the schema constant', () => {
    expect(MAX_MODULES).toBe(100)
  })
  it('MAX_LESSONS_PER_MODULE matches the schema constant', () => {
    expect(MAX_LESSONS_PER_MODULE).toBe(200)
  })
})
