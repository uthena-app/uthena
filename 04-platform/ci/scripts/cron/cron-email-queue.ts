// cron-email-queue.ts — worker that processes the email_queue.
//
// Run via:
//   pnpm cron:email-queue
// Schedule it in cron at every minute. Each invocation processes up
// to 50 messages with bounded concurrency.

import 'server-only'
import { processEmailBatch } from '../../../../00-foundations/email/emailQueue'

const BATCH_LIMIT = 50

async function main() {
  const result = await processEmailBatch(BATCH_LIMIT)
  // Plain stdout — the cron wrapper captures this.
  console.log(
    JSON.stringify({
      ok: true,
      picked: result.picked,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
      errorCount: result.errors.length,
    }),
  )
  if (result.errors.length > 0) {
    process.exitCode = 1 // signal partial failure to the cron runner
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ok: false,
      code: 'email_queue_cron_unhandled_error',
      msg: err instanceof Error ? err.message : 'unknown',
    }),
  )
  process.exitCode = 2
})
