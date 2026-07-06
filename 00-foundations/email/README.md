# 00-foundations/email/

The Amazon SES seam for transactional email. Env-gated; falls back to a structured log transport in dev so the app boots without AWS keys. The real SES SDK call ships in PH18 (PHASES.md P17.x wires the templates; PH18 wires the SDK + queue + bounce handling + suppression list).

## Files

- **`ses.ts`** — server-side helpers. Exports:
  - `EMAIL_CATEGORIES` — typed union: `transactional | marketing | consent | operational`.
  - `isSesConfigured()` — env gate (true when `AWS_REGION + AWS_SES_FROM_EMAIL + AWS_ACCESS_KEY_ID` are set).
  - `sendEmail(msg)` — best-effort send. Returns `{ ok, id, mode: 'ses' | 'log' }`. In P2.9, mode is always `'log'` because the SES SDK isn't wired yet.
  - `EmailMessage` type — the message shape (`to, subject, html, text, category, from?, replyTo?, tags?`).
  - `EmailSendResult` type — the result shape.
- **`ses.test.ts`** — 18 unit tests covering env-gated behavior, the `EMAIL_CATEGORIES` catalog, the `EmailSendResult` shape, and per-category acceptance.

## Event shape

### EmailMessage
```ts
{
  to: string
  subject: string
  html: string
  text: string
  category: 'transactional' | 'marketing' | 'consent' | 'operational'
  from?: string          // override the env's default from address
  replyTo?: string       // e.g. 'support@uthena.com' for transactional
  tags?: Record<string, string>  // SES message tags + log context (no PII)
}
```

### EmailSendResult
```ts
{ ok: boolean; id: string | null; mode: 'ses' | 'log' }
```

`mode: 'ses'` means the SES SDK was called (PH18). `mode: 'log'` means the message was emitted to the structured log only. `id` is always a fresh UUID — callers can correlate with the SES MessageId in production or with the log line in dev.

## Why four categories?

The category field drives three downstream behaviors:

1. **Suppression list (P17.4)** — `marketing` honors the global unsubscribe; `transactional` / `consent` / `operational` are exempt (legal requirement: must always reach the recipient).
2. **Consent gate (P11)** — `marketing` requires opt-in via the consent surface; the other categories are unconditional.
3. **Per-kind rate limits** — `transactional` has higher ceilings than `marketing` to avoid lockouts on order flows.

Adding a category: edit `EMAIL_CATEGORIES` + update the suppression-list + consent + rate-limit code paths.

## PII safety

- The `to` field is the recipient email. Pino's global redact list (`'email', '*.email'`) replaces it with `[REDACTED]` in logs.
- The `tags` field is a flat string→string map; do NOT put user identifiers (email, user_id, name) in tags. Use only high-cardinality campaign / surface / variant keys.
- The `subject` is logged (low-PII; necessary for debugging). Avoid putting PII in subject lines.

## Why "log" mode in P2.9?

PHASES.md scopes the SES SDK to PH17/PH18. P2.9 ships the seam's contract (env gate + category taxonomy + result shape) so that:
1. Call sites can start using `sendEmail()` with confidence in the contract.
2. PH17 templates can plug in without refactoring the call sites.
3. PH18 SDK wiring flips `mode: 'log' → 'ses'` without touching the call sites.

Until the SDK is wired, the message is logged at `info` level (unconfigured) or `warn` level (configured but SDK pending) — both are PII-safe via the redact list.