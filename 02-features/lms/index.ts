// index.ts — SERVER barrel for the LMS module.
// Server actions and queries. NO client components here — those
// are re-exported from `./client` only, to avoid the P0.5 barrel-pulls-
// server-only-into-client-bundle bug.

export { getCourseWithLessons } from './queries/getCourseWithLessons'
export { getLibraryProgress, getContinueWatching } from './queries/getLibraryProgress'
export type { CourseForShell, ModuleForShell, LessonForShell } from './queries/getCourseWithLessons'
export type { CourseProgress } from './queries/getLibraryProgress'

export { updateLessonProgressAction } from './actions/updateLessonProgress'
export { toggleBookmarkAction } from './actions/toggleBookmark'
export type { UpdateProgressInput, UpdateProgressResult, UpdateProgressErrorCode } from './actions/updateLessonProgress'
export type { ToggleBookmarkInput, ToggleBookmarkResult, ToggleBookmarkErrorCode } from './actions/toggleBookmark'

export { formatLessonDuration, sumDurations, isCompleteAtPosition, clampPosition } from './lib/formatLessonDuration'
