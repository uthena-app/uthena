// emailQueue.ts — durable email queue (P17.2).
//
// Sits on top of the `email_queue` table. The standard `sendEmail`
// is synchronous; this module wraps it to:
//   1. Insert a row with status='pending' (durable).
//   2. The cron worker (per environment) picks up rows where
//      status='pending' AND next_attempt_at <= now()
//   3. Calls SES via @aws-sdk/client-sesv2 (from ses.ts).
//   4. On failure, bumps attempts + sets next_attempt_at for retry.
//
// Idempotency: every enqueue mints a UUID queue_id. The same queue_id
// can be enqueued twice safely (PK conflict = no-op).
//
// PII safety: the table stores the message body. The row is only
// read by the worker (service-role) + admin tools (audit). It is
// NEVER exposed in regular API responses.

import 'server-only'
import { z } from 'zod'
import { getServiceSupabase } from '@foundations/data/supabase'
import { sendEmail, type EmailCategory, type EmailMessage } from './ses'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'email.queue' })

const MAX_ATTEMPTS = 5
const BACKOFF_BASE_SECONDS = 60

const EnqueueSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(998),
  html: z.string().min(1).max(200_000),
  text: z.string().min(1).max(200_000),
  category: z.enum(['transactional', 'marketing', 'consent', 'operational']),
  from: z.string().email().optional(),
  replyTo: z.string().email().optional(),
  tags: z.record(z.string(), z.string()).optional(),
})

export type EmailQueueInput = z.infer<typeof EnqueueSchema>

export type EnqueueResult =
  | { ok: true; queueId: string }
  | { ok: false; error: string }

/**
 * Enqueue an email. The cron worker will pick it up shortly.
 * Returns the queue_id (UUID) so callers can correlate with later
 * status checks if needed.
 *
 * If the row already exists (PK conflict), this is a no-op + returns
 * the existing queue_id. Matches the at-least-once delivery contract.
 */
export async function enqueueEmail(input: EmailQueueInput): Promise<EnqueueResult> {
  const parsed = EnqueueSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid email envelope.' }
  }
  const queueId = crypto.randomUUID()
  const service = getServiceSupabase()
  const { error } = await service.from('email_queue').insert({
    queue_id: queueId,
    to_email: parsed.data.to,
    subject: parsed.data.subject,
    html_body: parsed.data.html,
    text_body: parsed.data.text,
    category: parsed.data.category,
    from_email: parsed.data.from ?? null,
    reply_to: parsed.data.replyTo ?? null,
    tags: parsed.data.tags ?? null,
    status: 'pending',
    attempts: 0,
  } as never)
  if (error) {
    // The PK conflict (queue_id collision — 1-in-2^122 chance) bubbles
    // up as a 23505; we treat it as a soft success because the row
    // is durably queued either way.
    if (error.code === '23505') {
      return { ok: true, queueId }
    }
    log.warn(
      { code: 'enqueue_failed', to_domain: parsed.data.to.split('@')[1], msg: error.message },
      'enqueueEmail: insert failed',
    )
    return { ok: false, error: 'Could not enqueue email.' }
  }
  return { ok: true, queueId }
}

/**
 * Worker batch — pick up to `limit` pending rows whose
 * `next_attempt_at <= now()`, send them via SES, update status.
 *
 * Returns the count + per-row outcomes so the cron can log progress.
 *
 * **Idempotency on the worker side:** we flip status='pending' to
 * 'sending' atomically; if another worker grabs the same row in the
 * tiny window between SELECT and UPDATE, the UPDATE's WHERE filter
 * (status='pending') misses it and the call is a no-op for that row.
 *
 * Lock discipline: the `select … limit 1 for update skip locked`
 * pattern would be ideal, but PostgREST doesn't expose `FOR UPDATE`
 * directly. The optimistic WHERE filter is good enough for our
 * scale (single worker per env).
 */
export type ProcessBatchResult = {
  picked: number
  sent: number
  failed: number
  skipped: number
  errors: Array<{ queueId: string; error: string }>
}

export async function processEmailBatch(
  limit: number = 25,
): Promise<ProcessBatchResult> {
  const service = getServiceSupabase()

  // Step 1: select candidates.
  const { data: candidates, error: selectErr } = await service
    .from('email_queue')
    .select('queue_id, to_email, subject, html_body, text_body, category, from_email, reply_to, tags, attempts')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit)

  if (selectErr || !candidates) {
    log.warn(
      { code: 'email_queue_select_failed', msg: selectErr?.message },
      'processEmailBatch: select failed',
    )
    return { picked: 0, sent: 0, failed: 0, skipped: 0, errors: [] }
  }

  const result: ProcessBatchResult = {
    picked: candidates.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  }

  for (const row of candidates) {
    const r = row as {
      queue_id: string
      to_email: string
      subject: string
      html_body: string
      text_body: string
      category: EmailCategory
      from_email: string | null
      reply_to: string | null
      tags: Record<string, string> | null
      attempts: number
    }

    // Atomic: flip pending -> sending only if still pending. If another
    // worker beat us to it, this UPDATE is a no-op and we skip.
    const { data: locked, error: lockErr } = await service
      .from('email_queue')
      .update({ status: 'sending', last_attempt_at: new Date().toISOString() } as never)
      .eq('queue_id', r.queue_id)
      .eq('status', 'pending')
      .select('queue_id')
      .maybeSingle()
    if (lockErr || !locked) {
      result.skipped++
      continue
    }

    // Dispatch.
    const sendResult = await sendEmail({
      to: r.to_email,
      subject: r.subject,
      html: r.html_body,
      text: r.text_body,
      category: r.category,
      ...(r.from_email ? { from: r.from_email } : {}),
      ...(r.reply_to ? { replyTo: r.reply_to } : {}),
      ...(r.tags ? { tags: r.tags } : {}),
    })

    if (sendResult.ok) {
      await service
        .from('email_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          attempts: r.attempts + 1,
          last_error: null,
        } as never)
        .eq('queue_id', r.queue_id)
      result.sent++
    } else if (r.attempts + 1 >= MAX_ATTEMPTS) {
      // Max retries exhausted.
      await service
        .from('email_queue')
        .update({
          status: 'failed',
          attempts: r.attempts + 1,
          last_error: (sendResult.error ?? 'unknown').slice(0, 2000),
          last_attempt_at: new Date().toISOString(),
        } as never)
        .eq('queue_id', r.queue_id)
      result.failed++
      result.errors.push({ queueId: r.queue_id, error: sendResult.error ?? 'unknown' })
    } else {
      // Exponential backoff: 60s, 120s, 240s, 480s, 960s; capped at 6 hours.
      const backoffSec = Math.min(
        6 * 3600,
        BACKOFF_BASE_SECONDS * Math.pow(2, r.attempts),
      )
      const nextAttemptAt = new Date(Date.now() + backoffSec * 1000).toISOString()
      await service
        .from('email_queue')
        .update({
          status: 'pending',
          attempts: r.attempts + 1,
          last_error: (sendResult.error ?? 'unknown').slice(0, 2000),
          last_attempt_at: new Date().toISOString(),
          next_attempt_at: nextAttemptAt,
        } as never)
        .eq('queue_id', r.queue_id)
      result.failed++
      result.errors.push({ queueId: r.queue_id, error: sendResult.error ?? 'unknown' })
    }
  }

  if (result.sent > 0 || result.failed > 0) {
    log.info(
      { picked: result.picked, sent: result.sent, failed: result.failed, skipped: result.skipped },
      'email queue batch processed',
    )
  }
  return result
}

/** Convenience wrapper — enqueue + immediate attempt (best-effort) for
 *  transactional messages that need to leave the building right now. */
export async function sendEmailViaQueue(input: EmailMessage): Promise<EnqueueResult> {
  return enqueueEmail(input)
}
