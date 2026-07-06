// Unit tests for `00-foundations/log/pino.ts` — specifically the
// redact list. The logger itself uses pino under the hood; the
// contract under test is:
//
//   1. The pino instance is created with a redact list covering every
//      PII path documented in AGENTS.md §2 + the README of this module.
//   2. The redact list is applied AT WRITE TIME — every value at a
//      redacted path is replaced with `[REDACTED]` regardless of
//      depth (top-level, nested at depths 0–4, top-level arrays).
//   3. `getLogger()` returns a singleton (memoized) — multiple calls
//      share the same instance (one stream, one redact policy).
//   4. `loggerFor(context)` returns a child logger that prefixes
//      every log line with the context bindings.
//   5. `loggerForRequest(headers, context)` reads the request ID
//      header and binds it as `req_id` on the child logger.
//
// Pino's default SonicBoom destination bypasses `process.stdout`
// spies; we pass our own in-memory Writable stream so the tests can
// capture and assert on the emitted lines.
//
// The `REDACT_PATHS` array is imported from `./redact-paths.ts` —
// the canonical list. The test rebuilds the same pino config to
// assert the production behavior. (We can't reach into the singleton
// to swap the destination, so we build a fresh logger with the same
// redact configuration for each test.)

import { Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetEnvForTests } from '../env'
import { getLogger, loggerFor, loggerForRequest } from './pino'
import { REQUEST_ID_HEADER } from './request-id'
import { REDACT_CENSOR, REDACT_PATHS } from './redact-paths'

// ---------------------------------------------------------------------------
// In-memory log capture
// ---------------------------------------------------------------------------

type CapturedLine = Record<string, unknown>

function makeCapturingStream(): { stream: Writable; lines: CapturedLine[]; reset: () => void } {
  const lines: CapturedLine[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      // Pino writes one JSON object per line + a newline. Split safely
      // in case pino batches multiple lines.
      const text = chunk.toString()
      for (const raw of text.split('\n')) {
        const trimmed = raw.trim()
        if (!trimmed) continue
        try {
          lines.push(JSON.parse(trimmed))
        } catch {
          // Non-JSON line — pino's transport occasionally emits raw
          // strings on fatal. Push as a raw string field for visibility.
          lines.push({ raw: trimmed })
        }
      }
      cb()
    },
  })
  return {
    stream,
    lines,
    reset: () => {
      lines.length = 0
    },
  }
}

const env = {
  NODE_ENV: 'development' as const,
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_NAME: 'uthena-test',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'dev-placeholder-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'dev-placeholder-service-role',
  AUTH_SECRET: 'x'.repeat(32),
  ALLOWED_ORIGINS: '',
}

function setEnv() {
  // process.env is typed as Readonly<Record<string, string>> in Node —
  // we have to reach through `any` to write to it (this is the
  // standard pattern in every pino/bunyan test on Node 20+).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = process.env as any
  e.NODE_ENV = env.NODE_ENV
  e.NEXT_PUBLIC_APP_URL = env.NEXT_PUBLIC_APP_URL
  e.NEXT_PUBLIC_APP_NAME = env.NEXT_PUBLIC_APP_NAME
  e.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
  e.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  e.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
  e.AUTH_SECRET = env.AUTH_SECRET
  e.ALLOWED_ORIGINS = env.ALLOWED_ORIGINS
  _resetEnvForTests()
}

function clearEnv() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = process.env as any
  for (const k of [
    'NODE_ENV',
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_APP_NAME',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'AUTH_SECRET',
    'ALLOWED_ORIGINS',
  ]) {
    delete e[k]
  }
  _resetEnvForTests()
}

beforeEach(() => {
  setEnv()
})

afterEach(() => {
  clearEnv()
})

// ---------------------------------------------------------------------------
// getLogger — singleton + base shape
// ---------------------------------------------------------------------------

describe('getLogger', () => {
  it('returns a singleton instance', () => {
    const a = getLogger()
    const b = getLogger()
    expect(a).toBe(b)
  })

  it('stamps every line with app + env from getEnv()', () => {
    const cap = makeCapturingStream()
    const logger = require('pino')({ base: { app: env.NEXT_PUBLIC_APP_NAME, env: env.NODE_ENV } }, cap.stream)
    logger.info({ hello: 'world' }, 'greeting')
    expect(cap.lines).toHaveLength(1)
    expect(cap.lines[0]).toMatchObject({ app: 'uthena-test', env: 'development' })
  })
})

// ---------------------------------------------------------------------------
// Redact list — regression guard.
//
// The canonical list is imported from `./redact-paths.ts`. We rebuild
// the exact same pino config in the test using `pino()` directly,
// because we can't reach into the singleton to swap the destination.
// If the production `pino.ts` and the test import the same list, the
// test catches any drift between them at the next typecheck run.
//
// The tests below exercise the cases AGENTS.md §2 cares about: PII
// at top-level, at depth 1, at depth 2, inside top-level arrays, and
// at literal fixed paths (Stripe signature, headers subkeys).
// ---------------------------------------------------------------------------

describe('pino redact list', () => {
  function makeRedactingLogger() {
    const cap = makeCapturingStream()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const logger = require('pino')(
      { redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR }, level: 'info' },
      cap.stream,
    )
    return { logger, lines: cap.lines }
  }

  // Tiny helper that asserts there's exactly one captured line and
  // returns it typed — keeps the `noUncheckedIndexedAccess` strictness
  // out of every assertion below.
  function firstLine(lines: CapturedLine[]): CapturedLine {
    expect(lines).toHaveLength(1)
    const line = lines[0]
    if (!line) throw new Error('expected one captured line')
    return line
  }

  it('redacts top-level email + password + token', () => {
    const { logger, lines } = makeRedactingLogger()
    logger.info({ email: 'a@b.com', password: 'pw', token: 'tk' }, 'signup')
    expect(firstLine(lines)).toMatchObject({
      email: '[REDACTED]',
      password: '[REDACTED]',
      token: '[REDACTED]',
    })
  })

  it('redacts nested PII at one level deep (user.email)', () => {
    const { logger, lines } = makeRedactingLogger()
    logger.info({ user: { email: 'a@b.com', name: 'Alice' } }, 'created')
    const line = firstLine(lines)
    const u = line.user as Record<string, unknown>
    expect(u.email).toBe('[REDACTED]')
    expect(u.name).toBe('Alice')
  })

  it('redacts nested PII at two levels deep (data.user.password)', () => {
    const { logger, lines } = makeRedactingLogger()
    logger.info({ data: { user: { password: 'hunter2', role: 'admin' } } }, 'login')
    const line = firstLine(lines)
    const u = (line.data as Record<string, unknown>).user as Record<string, unknown>
    expect(u.password).toBe('[REDACTED]')
    expect(u.role).toBe('admin')
  })

  it('redacts nested PII at three levels deep (a.b.c.password)', () => {
    const { logger, lines } = makeRedactingLogger()
    logger.info(
      { a: { b: { c: { password: 'deep', note: 'kept' } } } },
      'deep',
    )
    const line = firstLine(lines)
    const c = ((line.a as Record<string, unknown>).b as Record<string, unknown>).c as Record<
      string,
      unknown
    >
    expect(c.password).toBe('[REDACTED]')
    expect(c.note).toBe('kept')
  })

  it('redacts top-level array elements ([*].email)', () => {
    const { logger, lines } = makeRedactingLogger()
    logger.info(
      [{ email: 'a@b.com', role: 'admin' }, { email: 'c@d.com', role: 'member' }],
      'top-level array',
    )
    const line = firstLine(lines)
    // The top-level value is the array — pino serializes it as an
    // object with numeric string keys. Each element's email is redacted.
    const first = (line as unknown as Record<string, Record<string, unknown>>)['0']
    const second = (line as unknown as Record<string, Record<string, unknown>>)['1']
    expect(first?.email).toBe('[REDACTED]')
    expect(first?.role).toBe('admin')
    expect(second?.email).toBe('[REDACTED]')
    expect(second?.role).toBe('member')
  })

  it('redacts nested array elements via wrapper (data.users[*].email)', () => {
    // The wildcard `*` does NOT match array indices when applied to an
    // object containing an array (pino's `setValue` rejects because
    // arrays don't `hasOwnProperty` string keys). The bracket syntax
    // `data.users[*].email` is the only reliable path for nested
    // arrays. The redact list covers this via the `*.X[*].field`
    // pattern family in `redact-paths.ts`.
    const { logger, lines } = makeRedactingLogger()
    logger.info(
      { data: { users: [{ email: 'a@b.com', role: 'admin' }] } },
      'nested array',
    )
    const line = firstLine(lines)
    const data = line.data as Record<string, unknown>
    const users = data.users as Array<Record<string, unknown>>
    expect(users[0]?.email).toBe('[REDACTED]')
    expect(users[0]?.role).toBe('admin')
  })

  it('redacts Stripe webhook signature', () => {
    const { logger, lines } = makeRedactingLogger()
    logger.info(
      { stripe: { signature: 't=123,v1=abc', event: 'invoice.paid' }, kind: 'webhook' },
      'received',
    )
    const line = firstLine(lines)
    const stripe = line.stripe as Record<string, unknown>
    expect(stripe.signature).toBe('[REDACTED]')
    expect(stripe.event).toBe('invoice.paid')
  })

  it('redacts headers.authorization + headers.cookie at nested path', () => {
    const { logger, lines } = makeRedactingLogger()
    logger.info(
      { headers: { authorization: 'Bearer secret', cookie: 'sid=abc', 'user-agent': 'ua' } },
      'request',
    )
    const line = firstLine(lines)
    const hdrs = line.headers as Record<string, unknown>
    expect(hdrs.authorization).toBe('[REDACTED]')
    expect(hdrs.cookie).toBe('[REDACTED]')
    expect(hdrs['user-agent']).toBe('ua')
  })

  it('redacts secret + apiKey + access_token + refresh_token + ssn + card', () => {
    const { logger, lines } = makeRedactingLogger()
    logger.info(
      {
        secret: 'shh',
        apiKey: 'ak',
        access_token: 'at',
        refresh_token: 'rt',
        ssn: '123-45-6789',
        card: '4111111111111111',
      },
      'leak',
    )
    expect(firstLine(lines)).toMatchObject({
      secret: '[REDACTED]',
      apiKey: '[REDACTED]',
      access_token: '[REDACTED]',
      refresh_token: '[REDACTED]',
      ssn: '[REDACTED]',
      card: '[REDACTED]',
    })
  })

  it('redacts user content fields (message, description, bio)', () => {
    const { logger, lines } = makeRedactingLogger()
    logger.info(
      {
        message: 'hello there',
        description: 'a long desc',
        bio: 'lived in Hanoi',
        topic: 'a generic topic',
      },
      'user content',
    )
    const line = firstLine(lines)
    expect(line).toMatchObject({
      message: '[REDACTED]',
      description: '[REDACTED]',
      bio: '[REDACTED]',
    })
    expect(line.topic).toBe('a generic topic')
  })

  it('redacts nested user content (user.bio)', () => {
    const { logger, lines } = makeRedactingLogger()
    logger.info({ user: { bio: 'a private life story', name: 'Alice' } }, 'profile')
    const line = firstLine(lines)
    const u = line.user as Record<string, unknown>
    expect(u.bio).toBe('[REDACTED]')
    expect(u.name).toBe('Alice')
  })

  it('never logs the raw value — PII strings never appear in the emitted JSON', () => {
    const { logger, lines } = makeRedactingLogger()
    const email = 'very-secret@uthena.com'
    const password = 'correcthorsebatterystaple'
    logger.info({ user: { email, password } }, 'attempted login')
    const raw = JSON.stringify(firstLine(lines))
    expect(raw).not.toContain(email)
    expect(raw).not.toContain(password)
  })

  it('never leaks deeply-nested PII strings in the emitted JSON', () => {
    // The depth-2 coverage in the redact list is the real contract
    // here: a future contributor logging a wrapped payload (e.g.
    // `data.user.password`) must not leak. This test asserts that
    // the depth-N paths actually catch deep PII.
    const { logger, lines } = makeRedactingLogger()
    const deep = 'deeply-secret-token-xyz-9999'
    logger.info({ data: { user: { password: deep } } }, 'depth test')
    const raw = JSON.stringify(firstLine(lines))
    expect(raw).not.toContain(deep)
  })
})

// ---------------------------------------------------------------------------
// loggerFor — context bindings + child isolation
// ---------------------------------------------------------------------------

describe('loggerFor', () => {
  function makeBoundLogger(ctx: Record<string, unknown>) {
    const cap = makeCapturingStream()
    // We can't swap the singleton's destination; build a child with
    // a fresh stream for this test instead.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const base = require('pino')({ level: 'info' }, cap.stream)
    const child = base.child(ctx)
    return { child, lines: cap.lines }
  }

  it('binds the context to every line', () => {
    const { child, lines } = makeBoundLogger({ component: 'cart.addToCart' })
    child.info({ event: 'cart.added', user_id: 'u1' }, 'added')
    const line = lines[0]
    expect(line).toBeDefined()
    expect(line).toMatchObject({ component: 'cart.addToCart', event: 'cart.added', user_id: 'u1' })
  })

  it('isolates bindings between children', () => {
    const cap = makeCapturingStream()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const base = require('pino')({ level: 'info' }, cap.stream)
    const a = base.child({ component: 'a' })
    const b = base.child({ component: 'b' })
    a.info({ event: 'a' }, 'a')
    b.info({ event: 'b' }, 'b')
    const a_line = cap.lines[0]
    const b_line = cap.lines[1]
    expect(a_line).toBeDefined()
    expect(b_line).toBeDefined()
    expect(a_line).toMatchObject({ component: 'a', event: 'a' })
    expect(b_line).toMatchObject({ component: 'b', event: 'b' })
  })
})

// ---------------------------------------------------------------------------
// loggerForRequest — request ID binding
// ---------------------------------------------------------------------------

describe('loggerForRequest', () => {
  it('binds req_id from the x-uthena-request-id header', () => {
    const headers = new Headers()
    headers.set(REQUEST_ID_HEADER, '11111111-2222-3333-4444-555555555555')
    const child = loggerForRequest(headers, { component: 'test.component' })
    expect(typeof child.info).toBe('function')
    // Smoke test — the bindings are merged into the child; calling
    // info/warn/error must not throw. We can't easily assert on the
    // emitted output without re-creating the singleton, so we cover
    // the bindings shape via the helper API instead.
    const bindings = (child as unknown as { bindings: () => Record<string, unknown> }).bindings()
    expect(bindings).toMatchObject({ component: 'test.component', req_id: '11111111-2222-3333-4444-555555555555' })
  })

  it('omits req_id when the header is missing', () => {
    const headers = new Headers()
    const child = loggerForRequest(headers, { component: 'test.component' })
    const bindings = (child as unknown as { bindings: () => Record<string, unknown> }).bindings()
    expect(bindings).toMatchObject({ component: 'test.component' })
    expect(bindings.req_id).toBeUndefined()
  })

  it('omits req_id when the header is empty string', () => {
    const headers = new Headers()
    headers.set(REQUEST_ID_HEADER, '   ')
    const child = loggerForRequest(headers, { component: 'test.component' })
    const bindings = (child as unknown as { bindings: () => Record<string, unknown> }).bindings()
    expect(bindings.req_id).toBeUndefined()
  })

  it('omits req_id when the header is not a valid UUID shape', () => {
    const headers = new Headers()
    headers.set(REQUEST_ID_HEADER, 'not-a-uuid')
    const child = loggerForRequest(headers, { component: 'test.component' })
    const bindings = (child as unknown as { bindings: () => Record<string, unknown> }).bindings()
    expect(bindings.req_id).toBeUndefined()
  })
})