// saveUploadDraftSchema.test.ts — unit tests for the partner-upload
// `saveUploadDraftSchema` pure schemas (P12.7 Slice 2 = Curriculum).
//
// Covers:
//   - SaveUploadDraftInput: wire schema (step + optional payload,
//     step ∈ [1, 5], payload must be a record not an array)
//   - LessonPayload: id required + length cap; title required +
//     trimmed + cap; summary optional + cap; duration_seconds integer
//     ≥ 0 and ≤ CURRICULUM_DURATION_MAX_SECONDS; is_preview boolean;
//     display_order integer ≥ 0 and ≤ 1000
//   - ModulePayload: id required + length cap; title required + cap;
//     summary optional + cap; display_order caps; lessons array
//     ≤ CURRICULUM_MAX_LESSONS_PER_MODULE
//   - CurriculumPayload: modules array ≤ CURRICULUM_MAX_MODULES
//   - payloadForStep: Step 1 strict Details wrap; Step 2 strict
//     Curriculum wrap; Steps 3-5 open shapes; default returns never;
//     rejection of wrong-top-level-key payloads (defense-in-depth)
//   - Constants: CURRICULUM_*_MAX match the documented caps

import { describe, expect, it } from 'vitest'
import {
  CURRICULUM_DURATION_MAX_SECONDS,
  CURRICULUM_ID_MAX,
  CURRICULUM_MAX_LESSONS_PER_MODULE,
  CURRICULUM_MAX_MODULES,
  CURRICULUM_SUMMARY_MAX,
  CURRICULUM_TITLE_MAX,
  CurriculumPayload,
  LessonPayload,
  ModulePayload,
  SaveUploadDraftInput,
  payloadForStep,
} from './saveUploadDraftSchema'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Curriculum constants — defensive caps mirror the DB schema', () => {
  it('ID cap is permissive for UUIDs but bounded', () => {
    expect(CURRICULUM_ID_MAX).toBe(64)
  })
  it('title cap matches product_modules.title / product_lessons.title (DB CHECK = 200)', () => {
    expect(CURRICULUM_TITLE_MAX).toBe(200)
  })
  it('summary cap matches product_modules.summary / product_lessons.summary (DB CHECK = 1000)', () => {
    expect(CURRICULUM_SUMMARY_MAX).toBe(1000)
  })
  it('duration cap is 24 hours of seconds', () => {
    expect(CURRICULUM_DURATION_MAX_SECONDS).toBe(86_400)
  })
  it('module cap is generous but bounded', () => {
    expect(CURRICULUM_MAX_MODULES).toBe(100)
  })
  it('lesson-per-module cap is generous but bounded', () => {
    expect(CURRICULUM_MAX_LESSONS_PER_MODULE).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Wire schema — SaveUploadDraftInput (still Slice 1's contract)
// ---------------------------------------------------------------------------

describe('SaveUploadDraftInput — wire schema (Slice 1 contract)', () => {
  it('accepts a step in 1..5 with an object payload', () => {
    const r = SaveUploadDraftInput.safeParse({ step: 1, payload: { foo: 'bar' } })
    expect(r.success).toBe(true)
  })
  it('accepts a step in 1..5 with no payload', () => {
    const r = SaveUploadDraftInput.safeParse({ step: 2 })
    expect(r.success).toBe(true)
  })
  it('rejects step out of range (< 1, > 5, fractional, NaN, string)', () => {
    expect(SaveUploadDraftInput.safeParse({ step: 0 }).success).toBe(false)
    expect(SaveUploadDraftInput.safeParse({ step: 6 }).success).toBe(false)
    expect(SaveUploadDraftInput.safeParse({ step: 1.5 }).success).toBe(false)
    expect(SaveUploadDraftInput.safeParse({ step: NaN }).success).toBe(false)
    expect(SaveUploadDraftInput.safeParse({ step: 'abc' }).success).toBe(false)
    expect(SaveUploadDraftInput.safeParse({}).success).toBe(false)
  })
  it('rejects array payload (records only, not arrays)', () => {
    const r = SaveUploadDraftInput.safeParse({ step: 1, payload: ['a', 'b'] })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// LessonPayload
// ---------------------------------------------------------------------------

describe('LessonPayload — happy path', () => {
  it('accepts a fully-formed lesson', () => {
    const r = LessonPayload.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Introduction',
      summary: 'A short overview',
      duration_seconds: 0,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(true)
  })
  it('accepts a lesson with summary omitted (defaults to empty string)', () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      title: 'Lesson 1',
      duration_seconds: 30,
      is_preview: true,
      display_order: 0,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.summary).toBe('')
  })
  it('accepts duration_seconds = 0 (text/PDF lesson has no media length)', () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      title: 'Reading',
      duration_seconds: 0,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(true)
  })
  it('accepts the largest valid lesson values', () => {
    const bigSummary = 'x'.repeat(CURRICULUM_SUMMARY_MAX)
    const r = LessonPayload.safeParse({
      id: 'x'.repeat(CURRICULUM_ID_MAX),
      title: 'T'.repeat(CURRICULUM_TITLE_MAX),
      summary: bigSummary,
      duration_seconds: CURRICULUM_DURATION_MAX_SECONDS,
      is_preview: true,
      display_order: 1_000,
    })
    expect(r.success).toBe(true)
  })
})

describe('LessonPayload — rejection paths', () => {
  it('rejects missing id', () => {
    const r = LessonPayload.safeParse({
      title: 't',
      duration_seconds: 1,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(false)
  })
  it('rejects empty-string id', () => {
    const r = LessonPayload.safeParse({
      id: '',
      title: 't',
      duration_seconds: 1,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(false)
  })
  it(`rejects id longer than ${CURRICULUM_ID_MAX} chars`, () => {
    const r = LessonPayload.safeParse({
      id: 'x'.repeat(CURRICULUM_ID_MAX + 1),
      title: 't',
      duration_seconds: 1,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(false)
  })
  it('rejects missing title (string required)', () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      duration_seconds: 1,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(false)
  })
  it('rejects empty / whitespace-only title (after trim)', () => {
    for (const title of ['', '   ', '\n\n', '\t']) {
      const r = LessonPayload.safeParse({
        id: 'l-1',
        title,
        duration_seconds: 1,
        is_preview: false,
        display_order: 0,
      })
      expect(r.success).toBe(false)
    }
  })
  it(`rejects title longer than ${CURRICULUM_TITLE_MAX} chars`, () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      title: 'T'.repeat(CURRICULUM_TITLE_MAX + 1),
      duration_seconds: 1,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(false)
  })
  it(`rejects summary longer than ${CURRICULUM_SUMMARY_MAX} chars`, () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      title: 't',
      summary: 'x'.repeat(CURRICULUM_SUMMARY_MAX + 1),
      duration_seconds: 1,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(false)
  })
  it('rejects negative duration_seconds', () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      title: 't',
      duration_seconds: -1,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(false)
  })
  it('rejects fractional duration_seconds', () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      title: 't',
      duration_seconds: 30.5,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(false)
  })
  it(`rejects duration_seconds greater than ${CURRICULUM_DURATION_MAX_SECONDS}`, () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      title: 't',
      duration_seconds: CURRICULUM_DURATION_MAX_SECONDS + 1,
      is_preview: false,
      display_order: 0,
    })
    expect(r.success).toBe(false)
  })
  it('rejects non-boolean is_preview (string "true")', () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      title: 't',
      duration_seconds: 1,
      is_preview: 'true',
      display_order: 0,
    })
    expect(r.success).toBe(false)
  })
  it('rejects negative display_order', () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      title: 't',
      duration_seconds: 1,
      is_preview: false,
      display_order: -1,
    })
    expect(r.success).toBe(false)
  })
  it('rejects fractional display_order', () => {
    const r = LessonPayload.safeParse({
      id: 'l-1',
      title: 't',
      duration_seconds: 1,
      is_preview: false,
      display_order: 0.5,
    })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ModulePayload
// ---------------------------------------------------------------------------

describe('ModulePayload — happy path', () => {
  it('accepts a module with no lessons (autosave partial state)', () => {
    const r = ModulePayload.safeParse({
      id: 'm-1',
      title: 'Module 1',
      display_order: 0,
      lessons: [],
    })
    expect(r.success).toBe(true)
  })
  it('accepts a module with multiple lessons in any order (display_order is informational)', () => {
    const r = ModulePayload.safeParse({
      id: 'm-1',
      title: 'Module 1',
      display_order: 2,
      lessons: [
        {
          id: 'l-3',
          title: 'Lesson 3',
          duration_seconds: 60,
          is_preview: false,
          display_order: 0,
        },
        {
          id: 'l-1',
          title: 'Lesson 1',
          duration_seconds: 60,
          is_preview: true,
          display_order: 0,
        },
      ],
    })
    expect(r.success).toBe(true)
  })
  it(`accepts up to ${CURRICULUM_MAX_LESSONS_PER_MODULE} lessons`, () => {
    const lessons = Array.from({ length: CURRICULUM_MAX_LESSONS_PER_MODULE }, (_, i) => ({
      id: `l-${i}`,
      title: `Lesson ${i}`,
      duration_seconds: 0,
      is_preview: false,
      display_order: i,
    }))
    const r = ModulePayload.safeParse({
      id: 'm-1',
      title: 'Module 1',
      display_order: 0,
      lessons,
    })
    expect(r.success).toBe(true)
  })
  it('accepts a module with summary omitted', () => {
    const r = ModulePayload.safeParse({
      id: 'm-1',
      title: 'Module 1',
      display_order: 0,
      lessons: [],
    })
    if (r.success) expect(r.data.summary).toBe('')
  })
})

describe('ModulePayload — rejection paths', () => {
  it('rejects missing id', () => {
    const r = ModulePayload.safeParse({
      title: 't',
      display_order: 0,
      lessons: [],
    })
    expect(r.success).toBe(false)
  })
  it('rejects empty title after trim', () => {
    const r = ModulePayload.safeParse({
      id: 'm-1',
      title: '   ',
      display_order: 0,
      lessons: [],
    })
    expect(r.success).toBe(false)
  })
  it(`rejects title longer than ${CURRICULUM_TITLE_MAX} chars`, () => {
    const r = ModulePayload.safeParse({
      id: 'm-1',
      title: 'T'.repeat(CURRICULUM_TITLE_MAX + 1),
      display_order: 0,
      lessons: [],
    })
    expect(r.success).toBe(false)
  })
  it(`rejects lessons array longer than ${CURRICULUM_MAX_LESSONS_PER_MODULE}`, () => {
    const lessons = Array.from({ length: CURRICULUM_MAX_LESSONS_PER_MODULE + 1 }, (_, i) => ({
      id: `l-${i}`,
      title: `Lesson ${i}`,
      duration_seconds: 0,
      is_preview: false,
      display_order: i,
    }))
    const r = ModulePayload.safeParse({
      id: 'm-1',
      title: 'Module 1',
      display_order: 0,
      lessons,
    })
    expect(r.success).toBe(false)
  })
  it('rejects a malformed lesson (LessonPayload errors bubble up)', () => {
    const r = ModulePayload.safeParse({
      id: 'm-1',
      title: 'Module 1',
      display_order: 0,
      lessons: [
        {
          id: 'l-1',
          title: '',
          duration_seconds: 1,
          is_preview: false,
          display_order: 0,
        },
      ],
    })
    expect(r.success).toBe(false)
  })
  it('rejects a module summary that exceeds the cap', () => {
    const r = ModulePayload.safeParse({
      id: 'm-1',
      title: 'Module 1',
      summary: 'x'.repeat(CURRICULUM_SUMMARY_MAX + 1),
      display_order: 0,
      lessons: [],
    })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CurriculumPayload
// ---------------------------------------------------------------------------

describe('CurriculumPayload — happy path', () => {
  it('accepts an empty modules array (partial-progress save)', () => {
    const r = CurriculumPayload.safeParse({ modules: [] })
    expect(r.success).toBe(true)
  })
  it('accepts a single-module / single-lesson curriculum', () => {
    const r = CurriculumPayload.safeParse({
      modules: [
        {
          id: 'm-1',
          title: 'Module 1',
          display_order: 0,
          lessons: [
            {
              id: 'l-1',
              title: 'Lesson 1',
              duration_seconds: 60,
              is_preview: false,
              display_order: 0,
            },
          ],
        },
      ],
    })
    expect(r.success).toBe(true)
  })
  it(`accepts up to ${CURRICULUM_MAX_MODULES} modules`, () => {
    const modules = Array.from({ length: CURRICULUM_MAX_MODULES }, (_, i) => ({
      id: `m-${i}`,
      title: `Module ${i}`,
      display_order: i,
      lessons: [],
    }))
    const r = CurriculumPayload.safeParse({ modules })
    expect(r.success).toBe(true)
  })
})

describe('CurriculumPayload — rejection paths', () => {
  it('rejects missing modules key', () => {
    const r = CurriculumPayload.safeParse({})
    expect(r.success).toBe(false)
  })
  it('rejects modules-as-array root', () => {
    const r = CurriculumPayload.safeParse(['m-1'])
    expect(r.success).toBe(false)
  })
  it('rejects unknown top-level keys (defense in depth)', () => {
    const r = CurriculumPayload.safeParse({ modules: [], extra: 'no' })
    expect(r.success).toBe(false)
  })
  it(`rejects modules array longer than ${CURRICULUM_MAX_MODULES}`, () => {
    const modules = Array.from({ length: CURRICULUM_MAX_MODULES + 1 }, (_, i) => ({
      id: `m-${i}`,
      title: `Module ${i}`,
      display_order: i,
      lessons: [],
    }))
    const r = CurriculumPayload.safeParse({ modules })
    expect(r.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// payloadForStep — dispatcher
// ---------------------------------------------------------------------------

describe('payloadForStep — per-step dispatch', () => {
  it('Step 1 accepts the strict Details wrap', () => {
    const schema = payloadForStep(1)
    const r = schema.safeParse({
      details: {
        title: 'A title',
        long_description:
          'A description that is at least fifty characters long so the strict Zod schema passes for step one validation.',
        category_id: 1,
        kind: 'video_course',
      },
    })
    expect(r.success).toBe(true)
  })

  it('Step 1 rejects arbitrary objects (defense in depth)', () => {
    const schema = payloadForStep(1)
    const r = schema.safeParse({ anything: 'goes' })
    expect(r.success).toBe(false)
  })

  it('Step 2 accepts the strict Curriculum wrap', () => {
    const schema = payloadForStep(2)
    const r = schema.safeParse({
      curriculum: {
        modules: [
          {
            id: 'm-1',
            title: 'Module 1',
            display_order: 0,
            lessons: [
              {
                id: 'l-1',
                title: 'Lesson 1',
                duration_seconds: 60,
                is_preview: false,
                display_order: 0,
              },
            ],
          },
        ],
      },
    })
    expect(r.success).toBe(true)
  })

  it('Step 2 accepts an empty curriculum (autosave partial state)', () => {
    const schema = payloadForStep(2)
    const r = schema.safeParse({ curriculum: { modules: [] } })
    expect(r.success).toBe(true)
  })

  it('Step 2 rejects the Slice 1 wire shape (defense in depth — wrong top-level key)', () => {
    const schema = payloadForStep(2)
    const r = schema.safeParse({
      details: {
        title: 't',
        long_description: 'x'.repeat(60),
        category_id: 1,
        kind: 'ebook',
      },
    })
    expect(r.success).toBe(false)
  })

  it('Step 2 rejects a bare curriculum array (curriculum is an object, modules is the array)', () => {
    const schema = payloadForStep(2)
    const r = schema.safeParse({ curriculum: [{ id: 'm-1', title: 'm', display_order: 0, lessons: [] }] })
    expect(r.success).toBe(false)
  })

  it('Step 2 rejects an empty object (curriculum key required)', () => {
    const schema = payloadForStep(2)
    const r = schema.safeParse({})
    expect(r.success).toBe(false)
  })

  it('Step 2 rejects a malformed module (e.g. negative display_order)', () => {
    const schema = payloadForStep(2)
    const r = schema.safeParse({
      curriculum: {
        modules: [{ id: 'm-1', title: 'M', display_order: -1, lessons: [] }],
      },
    })
    expect(r.success).toBe(false)
  })

  it('Steps 3-5 ship open shapes (Slices 3-5 will tighten in place)', () => {
    for (const step of [3, 4, 5]) {
      const schema = payloadForStep(step)
      expect(schema.safeParse({ anything: 'goes' }).success).toBe(true)
      expect(schema.safeParse({}).success).toBe(true)
      expect(schema.safeParse(undefined).success).toBe(true)
    }
  })

  it('Out-of-range step returns z.never()', () => {
    expect(payloadForStep(0).safeParse(undefined).success).toBe(false)
    expect(payloadForStep(6).safeParse(undefined).success).toBe(false)
    expect(payloadForStep(99).safeParse(undefined).success).toBe(false)
  })
})
