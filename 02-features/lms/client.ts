// client.ts — CLIENT barrel for the LMS module.
// Client components ONLY. Anything that imports React, browser-only APIs,
// or styles for client components goes here. NO server actions / queries.

export { CoursePlayer } from './components/CoursePlayer'
export type { CoursePlayerProps } from './components/CoursePlayer'
export { MarkCompleteButton } from './components/MarkCompleteButton'
export { BookmarkButton } from './components/BookmarkButton'
