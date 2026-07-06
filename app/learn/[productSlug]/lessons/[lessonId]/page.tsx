// /learn/[productSlug]/lessons/[lessonId] — LMS watch shell.
//
// RSC. Auth-gated. Composes:
//   - <CoursePlayer> (client island) for the player + buttons
//   - <LessonList> (server component) for the sidebar
//   - <CourseTabs> (server component) for the overview / notes / resources / certificate tabs
//
// Access: the user must own the course (verify via user_accessible_products).
// Otherwise → 404 (not 403) so we don't leak whether the slug exists.

import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { requireUser } from '@foundations/auth/guards'
import { getCourseWithLessons } from '@features/lms'
import { CoursePlayer } from '@features/lms/client'
import { LessonList } from '@features/lms/components/LessonList'
import { lessonTabsForCourse, CourseTabs } from './CourseTabs'
import { mintStreamUrlForLesson } from './mintStreamUrlForLesson'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ productSlug: string; lessonId: string }>
}): Promise<Metadata> {
  const { productSlug, lessonId } = await params
  const course = await getCourseWithLessons(productSlug, Number(lessonId))
  if (!course || !course.current_lesson) {
    return sensitivePageMetadata({
      title: 'Watch lesson — Uthena',
      description: 'Watch this lesson on Uthena.',
      path: '/learn',
    })
  }
  return sensitivePageMetadata({
    title: `${course.current_lesson.title} — ${course.title}`,
    description: course.current_lesson.summary ?? `Watch this lesson on Uthena.`,
    path: `/learn/${productSlug}/lessons/${lessonId}`,
  })
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ productSlug: string; lessonId: string }>
}) {
  const user = await requireUser('/learn')
  if (!user) redirect(`/login?next=/learn`)

  const { productSlug, lessonId: lessonIdRaw } = await params
  const lessonId = Number(lessonIdRaw)
  if (!Number.isInteger(lessonId) || lessonId <= 0) {
    notFound()
  }

  const course = await getCourseWithLessons(productSlug, lessonId)
  if (!course || !course.current_lesson) {
    notFound()
  }

  // Build prev/next URLs from the flattened lesson list.
  const allLessons = course.modules.flatMap((m) => m.lessons)
  const currentIndex = allLessons.findIndex((l) => l.id === lessonId)
  const prev = currentIndex > 0 ? allLessons[currentIndex - 1] : null
  const next = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null

  // Mint a stream URL for the current lesson. If mint fails (env-gated,
  // file not ready, rate-limit), pass null and the player renders the
  // placeholder. We do NOT 500 the page for an unavailable file — the
  // course still has the curriculum + tabs to browse.
  const streamSrc = await mintStreamUrlForLesson({
    lessonId,
    productId: course.id,
    userId: user.id,
  })

  // Tab content: overview (current) + bookmarks count + cert status.
  const tabs = await lessonTabsForCourse({ course, userId: user.id })

  return (
    <main id="main" className={styles.page}>
      <div className={styles.layout}>
        <div className={styles.main}>
          <CoursePlayer
            productId={course.id}
            productSlug={course.slug}
            lessonId={course.current_lesson.id}
            lessonTitle={course.current_lesson.title}
            lessonSummary={course.current_lesson.summary}
            durationSeconds={course.current_lesson.duration_seconds}
            src={streamSrc}
            initialSeekSeconds={
              course.last_watched_lesson?.lesson_id === lessonId
                ? course.last_watched_lesson.position_seconds
                : course.current_lesson.progress?.position_seconds ?? 0
            }
            initiallyCompleted={course.current_lesson.progress?.completed ?? false}
            initiallyBookmarked={false}
            prevLessonUrl={
              prev
                ? `/learn/${productSlug}/lessons/${prev.id}`
                : null
            }
            nextLessonUrl={
              next
                ? `/learn/${productSlug}/lessons/${next.id}`
                : null
            }
          />
          <CourseTabs tabs={tabs} productSlug={productSlug} lessonId={lessonId} />
        </div>
        <LessonList
          productSlug={productSlug}
          modules={course.modules}
          currentLessonId={lessonId}
        />
      </div>
    </main>
  )
}
