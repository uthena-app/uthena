// getContinueWatching.ts — return the most recent in-progress lesson
// for the user. PH09: stub that returns null (no progress UI yet).
// PH16 will replace this with a real progress query.

import 'server-only'
import { getSessionUser } from '@foundations/auth/guards'

export type ContinueWatchingEntry = {
  lesson_id: number
  product_id: number
  product_title: string
  product_thumbnail_url: string | null
  lesson_title: string
  position_seconds: number
  total_duration_seconds: number
}

export async function getContinueWatching(): Promise<ContinueWatchingEntry | null> {
  const user = await getSessionUser()
  if (!user) return null
  // PH16 wires the real progress query. v1 returns null so the
  // /library page renders without the continue card.
  return null
}
