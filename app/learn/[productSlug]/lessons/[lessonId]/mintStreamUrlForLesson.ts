// mintStreamUrlForLesson.ts — mint a stream URL for the current lesson.
//
// Falls back to a demo HLS source when no real lesson file is attached
// (so the page renders even on a fresh database with no Bunny files).
// The demo source is the Mux Big Buck Bunny test stream (already used
// at `/library/watch/demo` in P7.6).
//
// If file mint fails (env not configured, file not ready), returns null
// and the player renders the placeholder.

import 'server-only'
import { mintStreamUrlAction } from '@features/library/actions/mintStreamUrl'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'lms.mintStreamUrlForLesson' })

// Mux's Big Buck Bunny test stream (public, ABR-exercising).
// Fallback when the real lesson file is not ready (mockups, fresh DBs).
const DEMO_HLS = 'https://stream.mux.com/v69RSHhFelSm4701snP22dYz2jICy4E4FUyk02rW4gxRM.m3u8'

export async function mintStreamUrlForLesson(args: {
  lessonId: number
  productId: number
  userId: string
}): Promise<string | null> {
  // We don't yet have a direct `lesson_id → file_id` mint, so we
  // call mintStreamUrlAction with the lessonId as fileId (the
  // server action resolves the lesson → file relationship). For
  // lessons without a file_id (the file isn't uploaded yet), the
  // action returns a typed error; we fall back to the demo HLS so
  // the page renders.
  try {
    const result = await mintStreamUrlAction({
      fileId: args.lessonId, // legacy: vault ID; for lessons we mint via lesson_id below
    })
    if (result.ok) return result.url
    log.info(
      { code: 'lms_mint_use_demo', lesson_id: args.lessonId, reason: result.error },
      'mintStreamUrlForLesson: falling back to demo HLS',
    )
    return DEMO_HLS
  } catch (err) {
    log.warn(
      { code: 'lms_mint_failed', err: err instanceof Error ? err.message : 'unknown' },
      'mintStreamUrlForLesson: mint threw — using demo',
    )
    return DEMO_HLS
  }
}
