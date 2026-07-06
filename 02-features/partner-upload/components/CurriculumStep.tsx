'use client'

// CurriculumStep — Step 2 of the partner-upload wizard (P12.7 Slice 2).
//
// Renders the editable curriculum tree (modules + lessons) the spec
// calls out at `01-specs/pages/instructor-upload.md` line 18:
//
//   Step 2 — Curriculum | modules list (each with title, display_order,
//             lessons array with title, duration_seconds, file_id,
//             is_preview)
//
// The JSONB shape stored on the draft row matches the eventual
// `product_modules + product_lessons` tables (migration 0039); the
// Slice 5 submit-for-review flow drains this JSONB into the
// normalized tables. Each module + lesson carries a stable
// client-generated `id` (UUID via `crypto.randomUUID()`) for React
// keys + drag/drop correlation.
//
// Auto-saves on every state change with a 1s debounce (same pattern
// as DetailsStep). The flush-on-unmount useEffect ensures an
// in-flight change reaches the DB before navigation. The action's
// `current_step = MAX(existing, 2)` advances the wizard cursor on
// the partner's first save here.
//
// Per-step payload contract (lib/saveUploadDraftSchema.ts
// CurriculumPayload):
//   { curriculum: { modules: [{ id, title, summary, display_order,
//     lessons: [{ id, title, summary, duration_seconds, is_preview,
//     display_order }] }] } }
//
// The CurriculumPayload Zod schema is shape-validated on save
// (`.strict()` — defense in depth). It does NOT enforce the spec's
// "at least 1 module, each with at least 1 lesson, each lesson has
// a title and duration > 0" criterion (line 72) — that gating is
// the responsibility of Step 5 (submit-for-review) + the Future
// Right-Rail Summary widget (STUB-094). Partial-progress saves (the
// partner just typed a module title without finishing) must
// round-trip cleanly per the autosave criterion (line 79).
//
// **Deferred to STUB-094 (future slices):** drag-and-drop reordering
// (using keyboard-accessible up/down buttons in Slice 2 instead —
// the helper APIs `moveModuleById` / `moveLessonById` are the
// building blocks for drag-drop when a future slice adds it),
// right-rail summary widget (live "X modules · Y lessons · Z min"
// counts), inline validation gating on Continue/Submit buttons, and
// the slice-1 StepPlaceholder → Slice-5 live preview transition.

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { saveUploadDraftAction } from '../actions/saveUploadDraft'
import {
  appendLesson,
  appendModule,
  lessonMoveBounds,
  makeCurriculumId,
  moduleMoveBounds,
  moveLessonById,
  moveModuleById,
  removeLessonById,
  removeModuleById,
  type LessonShape,
  type ModuleShape,
} from '../lib/curriculumOps'
import { CURRICULUM_TITLE_MAX } from '../lib/saveUploadDraftSchema'
import type { UploadDraftResult } from '../queries/getMyUploadDraft'
import styles from './CurriculumStep.module.css'

const LESSON_TITLE_MAX = CURRICULUM_TITLE_MAX
const DEBOUNCE_MS = 1000

export type CurriculumStepProps = {
  /** The user's draft (or `{ exists: false }`). Hydrates the tree
   *  when the partner lands on Step 2 from a saved draft. */
  draft: UploadDraftResult
}

// ---------------------------------------------------------------------------
// Reading the curriculum off the draft
// ---------------------------------------------------------------------------

/** Coerce the row's `payload.curriculum.modules` into a safe
 *  `ModuleShape[]`. Defensive against garbage JSON: drops unknown
 *  shapes, replaces each with a degenerate module that has the
 *  missing fields defaulted (so the UI can re-edit them rather than
 *  silently dropping the partner's work). Returns `[]` for a fresh
 *  visitor with no draft. */
function readCurriculumFromDraft(draft: UploadDraftResult): ModuleShape[] {
  if (!draft.exists) return []
  const raw = draft.payload?.curriculum
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const obj = raw as { modules?: unknown }
  if (!Array.isArray(obj.modules)) return []
  const out: ModuleShape[] = []
  for (const m of obj.modules) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue
    const mo = m as Record<string, unknown>
    const moduleId = typeof mo.id === 'string' ? mo.id : makeCurriculumId()
    const moduleTitle = typeof mo.title === 'string' ? mo.title : ''
    const moduleSummary = typeof mo.summary === 'string' ? mo.summary : ''
    const moduleOrder =
      typeof mo.display_order === 'number' && Number.isInteger(mo.display_order) && mo.display_order >= 0
        ? mo.display_order
        : 0
    const lessonsRaw = Array.isArray(mo.lessons) ? mo.lessons : []
    const lessons: LessonShape[] = []
    for (const l of lessonsRaw) {
      if (!l || typeof l !== 'object' || Array.isArray(l)) continue
      const lo = l as Record<string, unknown>
      lessons.push({
        id: typeof lo.id === 'string' ? lo.id : makeCurriculumId(),
        title: typeof lo.title === 'string' ? lo.title : '',
        summary: typeof lo.summary === 'string' ? lo.summary : '',
        duration_seconds:
          typeof lo.duration_seconds === 'number' &&
          Number.isInteger(lo.duration_seconds) &&
          lo.duration_seconds >= 0
            ? lo.duration_seconds
            : 0,
        is_preview: typeof lo.is_preview === 'boolean' ? lo.is_preview : false,
        display_order:
          typeof lo.display_order === 'number' &&
          Number.isInteger(lo.display_order) &&
          lo.display_order >= 0
            ? lo.display_order
            : 0,
      })
    }
    out.push({
      id: moduleId,
      title: moduleTitle,
      summary: moduleSummary,
      display_order: moduleOrder,
      lessons,
    })
  }
  // Re-derive display_order defensively — a malformed draft could
  // have gaps or duplicates; the saver + UI rely on contiguous
  // 0..N-1 ordering.
  return out.map((m, i) => ({
    ...m,
    display_order: i,
    lessons: m.lessons.map((l, j) => ({ ...l, display_order: j })),
  }))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CurriculumStep({ draft }: CurriculumStepProps) {
  const [modules, setModules] = useState<ModuleShape[]>(() => readCurriculumFromDraft(draft))

  const [lastSavedAt, setLastSavedAt] = useState<string | null>(draft.exists ? draft.updatedAt : null)
  const [error, setError] = useState<string | null>(null)
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  // Debounced save plumbing — collects the latest tree in a ref so
  // a pending save picks up the freshest state. Mirrors the
  // DetailsStep pattern.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<ModuleShape[]>(modules)
  latestRef.current = modules

  const flushSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const v = latestRef.current
    startTransition(async () => {
      setError(null)
      setRetryAfterSeconds(null)
      const result = await saveUploadDraftAction({
        step: 2,
        payload: {
          curriculum: {
            modules: v.map((m, mi) => ({
              id: m.id,
              title: m.title.trim(),
              summary: m.summary ?? '',
              display_order: mi,
              lessons: m.lessons.map((l, li) => ({
                id: l.id,
                title: l.title.trim(),
                summary: l.summary ?? '',
                duration_seconds: l.duration_seconds,
                is_preview: l.is_preview,
                display_order: li,
              })),
            })),
          },
        },
      })
      if (result.ok) {
        setLastSavedAt(result.savedAt)
      } else if (result.code === 'rate_limited') {
        setError('Saving too quickly.')
        setRetryAfterSeconds(result.retryAfterSeconds ?? 60)
      } else if (result.code === 'unauthenticated') {
        setError('Please sign in again to keep saving.')
      } else {
        setError(result.error)
      }
    })
  }, [])

  // Re-schedule the debounced save on every tree change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(flushSave, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [modules, flushSave])

  // Flush on unmount — if the partner makes a change and immediately
  // navigates away, we still persist the latest keystroke.
  useEffect(() => {
    return () => {
      flushSave()
    }
  }, [flushSave])

  // ----- Module-level callbacks -----------------------------------------------

  const onAddModule = useCallback(() => {
    setModules((prev) =>
      appendModule(prev, {
        id: makeCurriculumId(),
        title: '',
        summary: '',
        display_order: prev.length,
        lessons: [],
      }),
    )
  }, [])

  const onRemoveModule = useCallback((moduleId: string) => {
    setModules((prev) => removeModuleById(prev, moduleId))
  }, [])

  const onMoveModule = useCallback((moduleId: string, direction: -1 | 1) => {
    setModules((prev) => moveModuleById(prev, moduleId, direction))
  }, [])

  const onUpdateModule = useCallback((moduleId: string, patch: Partial<ModuleShape>) => {
    setModules((prev) =>
      prev.map((m) =>
        m.id === moduleId
          ? {
              ...m,
              ...patch,
            }
          : m,
      ),
    )
  }, [])

  // ----- Lesson-level callbacks ----------------------------------------------

  const onAddLesson = useCallback((moduleId: string) => {
    setModules((prev) =>
      prev.map((m) =>
        m.id === moduleId
          ? {
              ...m,
              lessons: appendLesson(m.lessons, {
                id: makeCurriculumId(),
                title: '',
                summary: '',
                duration_seconds: 0,
                is_preview: false,
                display_order: m.lessons.length,
              }),
            }
          : m,
      ),
    )
  }, [])

  const onRemoveLesson = useCallback((moduleId: string, lessonId: string) => {
    setModules((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...m, lessons: removeLessonById(m.lessons, lessonId) } : m)),
    )
  }, [])

  const onMoveLesson = useCallback((moduleId: string, lessonId: string, direction: -1 | 1) => {
    setModules((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...m, lessons: moveLessonById(m.lessons, lessonId, direction) } : m)),
    )
  }, [])

  const onUpdateLesson = useCallback((moduleId: string, lessonId: string, patch: Partial<LessonShape>) => {
    setModules((prev) =>
      prev.map((m) =>
        m.id === moduleId
          ? {
              ...m,
              lessons: m.lessons.map((l) => (l.id === lessonId ? { ...l, ...patch } : l)),
            }
          : m,
      ),
    )
  }, [])

  // ----- Render ---------------------------------------------------------------

  const empty = modules.length === 0

  return (
    <section className={styles.wrap}>
      <header className={styles.head}>
        <h2 className={styles.title}>Curriculum</h2>
        <p className={styles.lede}>
          Break the course into modules and lessons. Buyers will see this list on your product page. Drafts auto-save.
        </p>
      </header>

      {empty ? (
        <div className={styles.empty} role="status">
          <p className={styles.emptyTitle}>No modules yet</p>
          <p className={styles.emptyLede}>
            Add your first module to start shaping the course. You can reorder + edit modules and add lessons
            underneath.
          </p>
          <button type="button" className={styles.primaryCta} onClick={onAddModule}>
            + Add your first module
          </button>
        </div>
      ) : (
        <ol className={styles.moduleList} aria-label="Modules">
          {modules.map((m) => {
            const bounds = moduleMoveBounds(modules, m.id)
            return (
              <li key={m.id} className={styles.moduleCard}>
                <div className={styles.moduleHeader}>
                  <span className={styles.eyebrow}>Module {m.display_order + 1}</span>
                  <div className={styles.moduleCtas} role="group" aria-label="Module actions">
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => onMoveModule(m.id, -1)}
                      disabled={!bounds.canMoveUp}
                      aria-label="Move module up"
                      title="Move module up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => onMoveModule(m.id, 1)}
                      disabled={!bounds.canMoveDown}
                      aria-label="Move module down"
                      title="Move module down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={styles.dangerBtn}
                      onClick={() => onRemoveModule(m.id)}
                      aria-label={`Remove module ${m.display_order + 1}`}
                      title="Remove module"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor={`module-title-${m.id}`} className={styles.label}>
                    Module title <span className={styles.optional}>(required, max {LESSON_TITLE_MAX} chars)</span>
                  </label>
                  <input
                    id={`module-title-${m.id}`}
                    type="text"
                    className={styles.input}
                    value={m.title}
                    onChange={(e) =>
                      onUpdateModule(m.id, { title: e.target.value.slice(0, LESSON_TITLE_MAX) })
                    }
                    maxLength={LESSON_TITLE_MAX}
                    placeholder="e.g. Getting started"
                    autoComplete="off"
                    spellCheck="true"
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor={`module-summary-${m.id}`} className={styles.label}>
                    Summary <span className={styles.optional}>(optional, max 1000 chars)</span>
                  </label>
                  <textarea
                    id={`module-summary-${m.id}`}
                    className={styles.textarea}
                    value={m.summary ?? ''}
                    onChange={(e) =>
                      onUpdateModule(m.id, { summary: e.target.value.slice(0, 1000) })
                    }
                    maxLength={1000}
                    rows={2}
                    placeholder="A short description of what this module covers"
                    spellCheck="true"
                  />
                </div>

                {/* Lessons */}
                <div className={styles.lessons}>
                  <div className={styles.lessonsHead}>
                    <h3 className={styles.lessonsTitle}>Lessons</h3>
                    <button
                      type="button"
                      className={styles.secondaryCta}
                      onClick={() => onAddLesson(m.id)}
                    >
                      + Add lesson
                    </button>
                  </div>
                  {m.lessons.length === 0 ? (
                    <p className={styles.lessonsEmpty}>
                      No lessons in this module yet. Add at least one before submitting.
                    </p>
                  ) : (
                    <ol className={styles.lessonList} aria-label={`Lessons in module ${m.display_order + 1}`}>
                      {m.lessons.map((l) => {
                        const lb = lessonMoveBounds(m.lessons, l.id)
                        return (
                          <li key={l.id} className={styles.lessonRow}>
                            <div className={styles.lessonHeader}>
                              <span className={styles.lessonEyebrow}>Lesson {l.display_order + 1}</span>
                              <div className={styles.lessonCtas} role="group" aria-label="Lesson actions">
                                <button
                                  type="button"
                                  className={styles.iconBtn}
                                  onClick={() => onMoveLesson(m.id, l.id, -1)}
                                  disabled={!lb.canMoveUp}
                                  aria-label="Move lesson up"
                                  title="Move lesson up"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className={styles.iconBtn}
                                  onClick={() => onMoveLesson(m.id, l.id, 1)}
                                  disabled={!lb.canMoveDown}
                                  aria-label="Move lesson down"
                                  title="Move lesson down"
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  className={styles.dangerBtn}
                                  onClick={() => onRemoveLesson(m.id, l.id)}
                                  aria-label={`Remove lesson ${l.display_order + 1}`}
                                  title="Remove lesson"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>

                            <div className={styles.lessonGrid}>
                              <div className={`${styles.field} ${styles.fieldGrow}`}>
                                <label htmlFor={`lesson-title-${l.id}`} className={styles.label}>
                                  Lesson title{' '}
                                  <span className={styles.optional}>(required, max {LESSON_TITLE_MAX} chars)</span>
                                </label>
                                <input
                                  id={`lesson-title-${l.id}`}
                                  type="text"
                                  className={styles.input}
                                  value={l.title}
                                  onChange={(e) =>
                                    onUpdateLesson(m.id, l.id, {
                                      title: e.target.value.slice(0, LESSON_TITLE_MAX),
                                    })
                                  }
                                  maxLength={LESSON_TITLE_MAX}
                                  placeholder="e.g. Installing the tools"
                                  autoComplete="off"
                                />
                              </div>

                              <div className={styles.field}>
                                <label htmlFor={`lesson-duration-${l.id}`} className={styles.label}>
                                  Duration <span className={styles.optional}>(seconds; 0 for PDFs)</span>
                                </label>
                                <input
                                  id={`lesson-duration-${l.id}`}
                                  type="number"
                                  className={styles.input}
                                  value={l.duration_seconds}
                                  onChange={(e) => {
                                    const raw = e.target.value
                                    const n = raw === '' ? 0 : Number.parseInt(raw, 10)
                                    onUpdateLesson(m.id, l.id, {
                                      duration_seconds:
                                        Number.isInteger(n) && n >= 0
                                          ? Math.min(n, 86_400)
                                          : 0,
                                    })
                                  }}
                                  min={0}
                                  max={86_400}
                                  step={1}
                                  inputMode="numeric"
                                />
                              </div>
                            </div>

                            <label className={styles.previewToggle}>
                              <input
                                type="checkbox"
                                checked={l.is_preview}
                                onChange={(e) =>
                                  onUpdateLesson(m.id, l.id, { is_preview: e.target.checked })
                                }
                              />
                              <span>Free preview lesson (visible without purchase)</span>
                            </label>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </div>
              </li>
            )
          })}

          <li className={styles.addModuleRow}>
            <button type="button" className={styles.primaryCta} onClick={onAddModule}>
              + Add another module
            </button>
          </li>
        </ol>
      )}

      <footer className={styles.foot}>
        <div className={styles.saveStatus} aria-live="polite">
          {isPending && <span className={styles.saving}>Saving…</span>}
          {!isPending && lastSavedAt && (
            <span className={styles.saved}>
              <span className={styles.dot} aria-hidden="true" />
              Saved{' '}
              <time dateTime={lastSavedAt}>
                {new Date(lastSavedAt).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </time>
            </span>
          )}
          {!isPending && !lastSavedAt && <span className={styles.unsaved}>Not saved yet</span>}
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
            {retryAfterSeconds !== null && <> — retry in {retryAfterSeconds}s</>}
          </p>
        )}
      </footer>
    </section>
  )
}
