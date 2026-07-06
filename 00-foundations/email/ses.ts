// ses.ts — Amazon SES transactional email seam.
//
// P17.1 — wires the @aws-sdk/client-sesv2 SDK so configured envs
// send real emails (vs the log-only fallback that P2.9 shipped).
//
// Env gate (defense in depth — same as `isSesConfigured`):
//   - AWS_REGION
//   - AWS_SES_FROM_EMAIL
//   - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (or AWS_BEARER_TOKEN_BEARER)
// Optional: AWS_SES_CONFIGURATION_SET (for bounce/complaint event
// destination; P17.3 wires the SNS topic).
//
// Failure modes:
//   - SES unconfigured → falls back to structured log (P2.9 behavior).
//     Same `{ ok, id, mode: 'log' }` result shape.
//   - SES configured but the call throws → caller decides retry. We
//     return `{ ok: false, id, mode: 'ses' }` so the caller can
//     re-enqueue rather than drop.
//
// PII safety: structured log never includes `msg.html` / `msg.body`
// (the message body is in the audit log row + in the queue row, NOT
// in the regular pino logger). Pino logs `to` / `subject` / `category`
// only — matching the existing P2.9 contract.

import 'server-only'

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { getEnv } from '@foundations/env'
import { loggerFor } from '@foundations/log/pino'

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const EMAIL_CATEGORIES = [
  'transactional',
  'marketing',
  'consent',
  'operational',
] as const satisfies readonly string[]

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number]

// ---------------------------------------------------------------------------
// Message + result shapes
// ---------------------------------------------------------------------------

export type EmailMessage = {
  to: string
  subject: string
  html: string
  text: string
  category: EmailCategory
  from?: string
  replyTo?: string
  tags?: Record<string, string>
}

export type EmailSendResult = {
  ok: boolean
  id: string | null
  mode: 'ses' | 'log'
  error?: string
}

export type EmailQueueRow = {
  /** `id` we mint client-side (UUIDv4) so the SES + queue log share it. */
  queueId: string
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'
  attempts: number
  nextAttemptAt: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Config + send
// ---------------------------------------------------------------------------

export function isSesConfigured(): boolean {
  const env = getEnv()
  return Boolean(env.AWS_REGION && env.AWS_SES_FROM_EMAIL && env.AWS_ACCESS_KEY_ID)
}

const log = loggerFor({ component: 'email' })

let client: SESv2Client | null = null

function getClient(): SESv2Client | null {
  if (!isSesConfigured()) return null
  if (client) return client
  const env = getEnv()
  client = new SESv2Client({ region: env.AWS_REGION })
  return client
}

/**
 * Send an email. Env-gated. When `isSesConfigured()` returns false
 * (dev / no AWS), writes the message to the structured log so the
 * sender can verify the call site is reachable. When configured,
 * dispatches to SES via `@aws-sdk/client-sesv2` `SendEmailCommand`.
 *
 * Returns `{ ok, id, mode, error? }` — the caller (queue worker,
 * webhook handler) decides whether to retry on failure.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const env = getEnv()
  const id = crypto.randomUUID()
  const from = msg.from ?? env.AWS_SES_FROM_EMAIL ?? 'noreply@uthena.com'

  const c = getClient()
  if (!c) {
    log.info(
      { to: msg.to, subject: msg.subject, id, category: msg.category, from },
      'email (dev) — would send via SES',
    )
    return { ok: true, id, mode: 'log' }
  }

  // Real SES dispatch.
  try {
    const cmd = new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [msg.to] },
      ReplyToAddresses: msg.replyTo ? [msg.replyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Charset: 'UTF-8', Data: msg.subject },
          Body: {
            Html: { Charset: 'UTF-8', Data: msg.html },
            Text: { Charset: 'UTF-8', Data: msg.text },
          },
        },
      },
      EmailTags: msg.tags
        ? Object.entries(msg.tags).map(([Name, Value]) => ({ Name, Value }))
        : undefined,
      ConfigurationSetName: env.AWS_SES_CONFIGURATION_SET ?? undefined,
    })
    const response = await c.send(cmd)
    log.info(
      { id, ses_message_id: response.MessageId, category: msg.category, to_domain: msg.to.split('@')[1] },
      'email sent via SES',
    )
    return { ok: true, id, mode: 'ses' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    log.warn(
      { code: 'ses_send_failed', id, to_domain: msg.to.split('@')[1], category: msg.category, msg: message },
      'email — SES send failed',
    )
    return { ok: false, id, mode: 'ses', error: message }
  }
}
