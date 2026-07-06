// CourseTabs.tsx — SERVER. Tabbed surface under the player.
//
// Tabs:
//   - Overview — lesson summary + course instructor notes
//   - Bookmarks — list of user's bookmarks on this lesson (or course)
//   - Resources — downloadable files attached to this lesson
//   - Certificate — issued certificate preview (Phase 15 P15.11/15.13)

import { formatLessonDuration } from '@features/lms'
import { getServerSupabase } from '@foundations/data/supabase'
import styles from './CourseTabs.module.css'

export type LessonTab = {
  id: 'overview' | 'bookmarks' | 'resources' | 'certificate'
  label: string
  content: React.ReactNode
}

export async function lessonTabsForCourse(args: {
  course: { id: number; slug: string; title: string; current_lesson: { id: number; title: string; summary: string | null } | null; completion_percent: number }
  userId: string
}): Promise<LessonTab[]> {
  const { course, userId } = args
  const lessonId = course.current_lesson?.id ?? null
  const supabase = await getServerSupabase()

  // Bookmarks for this lesson.
  let bookmarkNote: string | null = null
  if (lessonId != null) {
    const { data } = await supabase
      .from('bookmarks')
      .select('note')
      .eq('user_id', userId)
      .eq('lesson_id', lessonId)
      .maybeSingle()
    bookmarkNote = (data as { note: string | null } | null)?.note ?? null
  }

  // Resources (lesson files). For v1 we read product_files where the
  // lesson_id matches via product_lessons.file_id. We computed the
  // mapping already in getCourseWithLessons; here we hydrate the
  // downloadable URLs lazily.
  let resources: Array<{ id: number; title: string; kind: string; size_bytes: number | null }> = []
  if (lessonId != null) {
    const { data } = await supabase
      .from('product_lessons')
      .select('file_id')
      .eq('id', lessonId)
      .maybeSingle()
    const fileId = (data as { file_id: number | null } | null)?.file_id
    if (fileId != null) {
      const { data: files } = await supabase
        .from('product_files')
        .select('id, original_filename, kind, size_bytes')
        .eq('id', fileId)
      resources = (files ?? []).map((f) => {
        const r = f as { id: number; original_filename: string; kind: string; size_bytes: number | null }
        return { id: r.id, title: r.original_filename, kind: r.kind, size_bytes: r.size_bytes }
      })
    }
  }

  // Certificate for this course.
  const { data: cert } = await supabase
    .from('certificates')
    .select('id, certificate_code, issued_at, status')
    .eq('user_id', userId)
    .eq('product_id', course.id)
    .maybeSingle()
  const certInfo = cert as
    | { id: number; certificate_code: string; issued_at: string; status: string }
    | null

  const overview = (
    <div className={styles.overview}>
      {course.current_lesson?.summary ? (
        <p className={styles.lessonSummary}>{course.current_lesson.summary}</p>
      ) : (
        <p className={styles.muted}>No lesson summary provided.</p>
      )}
      <dl className={styles.facts}>
        <div>
          <dt>Course progress</dt>
          <dd>{course.completion_percent}%</dd>
        </div>
        <div>
          <dt>Lesson</dt>
          <dd>{course.current_lesson?.title ?? '—'}</dd>
        </div>
      </dl>
    </div>
  )

  const bookmarks = bookmarkNote != null ? (
    <div className={styles.notes}>
      <h3 className={styles.notesHeading}>Your note on this lesson</h3>
      <p className={styles.notesBody}>{bookmarkNote}</p>
    </div>
  ) : (
    <p className={styles.muted}>
      You haven't bookmarked this lesson yet. Click the bookmark button under the video to save a note.
    </p>
  )

  const resourcesContent =
    resources.length > 0 ? (
      <ul className={styles.resourceList}>
        {resources.map((r) => (
          <li key={r.id} className={styles.resourceItem}>
            <span className={styles.resourceKind}>{r.kind}</span>
            <span className={styles.resourceTitle}>{r.title}</span>
            <span className={styles.resourceSize}>
              {r.size_bytes != null ? formatLessonDuration(r.size_bytes / 1024) + ' KB' : ''}
            </span>
          </li>
        ))}
      </ul>
    ) : (
      <p className={styles.muted}>No downloadable resources for this lesson.</p>
    )

  const certContent = certInfo ? (
    <div className={styles.cert}>
      <p className={styles.muted}>
        You've earned a certificate for <strong>{course.title}</strong>.
      </p>
      <p className={styles.certCode}>
        Code: <code>{certInfo.certificate_code}</code>
      </p>
      <p className={styles.muted}>
        Issued {new Date(certInfo.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
      </p>
      <a
        href={`/verify-certificate/${certInfo.certificate_code}`}
        className={styles.certLink}
      >
        Verify this certificate →
      </a>
    </div>
  ) : (
    <p className={styles.muted}>
      You'll earn a certificate when you complete this course. Progress: {course.completion_percent}%.
    </p>
  )

  return [
    { id: 'overview', label: 'Overview', content: overview },
    { id: 'bookmarks', label: 'Bookmarks', content: bookmarks },
    { id: 'resources', label: 'Resources', content: resourcesContent },
    { id: 'certificate', label: 'Certificate', content: certContent },
  ]
}

// The component itself is a thin wrapper that the page renders.
// (Tabs are simple — direct render of all four panels; no URL state
// in v1 to keep the surface small. The "active" tab is the first one
// by default; future enhancement could add ?tab= URL state.)
export function CourseTabs({
  tabs,
  productSlug,
  lessonId,
}: {
  tabs: LessonTab[]
  productSlug: string
  lessonId: number
}) {
  return (
    <section className={styles.root} aria-label="Lesson details">
      <div className={styles.tabsList}>
        {tabs.map((t, idx) => (
          <div key={t.id} className={styles.tab} data-active={idx === 0 ? 'yes' : 'no'}>
            <h3 className={styles.tabLabel}>{t.label}</h3>
            <div className={styles.tabContent}>{t.content}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
