import { z } from 'zod'

/**
 * Environment variable validation. Runs at the edge (middleware) and
 * inside server actions. Fails closed at boot if a required value is
 * missing in production. In development, missing values are surfaced
 * as warnings and the relevant feature degrades to a no-op.
 *
 * NEVER log the full env object — only validation errors.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_NAME: z.string().default('Uthena'),

  // Supabase — required always.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),

  // Stripe — optional, fails closed.
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional().default(''),
  STRIPE_PRICE_PERSONAL_ACCESS_MONTHLY: z.string().optional().default(''),

  // Bunny — optional, fails closed.
  BUNNY_STORAGE_ZONE: z.string().optional().default(''),
  BUNNY_STORAGE_ACCESS_KEY: z.string().optional().default(''),
  BUNNY_STORAGE_PUBLIC_HOSTNAME: z.string().optional().default(''),
  BUNNY_STREAM_LIBRARY_ID: z.string().optional().default(''),
  BUNNY_STREAM_TOKEN_KEY: z.string().optional().default(''),
  BUNNY_SIGNING_KEY: z.string().optional().default(''),
  // P12.8 — Bunny webhook secret for the Storage scan-result webhook at
  // /api/webhooks/bunny. Bunny signs the event body with HMAC-SHA256 and
  // the handler verifies via timingSafeEqual. Optional in dev/test
  // (the handler returns 503 "bunny webhooks not configured" when
  // missing, so dev curls return a clean error rather than a 401);
  // required in production for the scan-result pipeline to function.
  BUNNY_WEBHOOK_SECRET: z.string().optional().default(''),
  // P12.8 — Separate signing secret for the Bunny Stream video
  // webhook (transcoding events). Bunny lets each webhook URL have its
  // own secret so a leaked storage secret doesn't also leak video
  // signing. Same optional-in-dev / required-in-prod posture as
  // BUNNY_WEBHOOK_SECRET.
  BUNNY_VIDEO_WEBHOOK_SECRET: z.string().optional().default(''),

  // PostHog — optional, no-op if empty.
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional().default(''),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional().default('https://eu.i.posthog.com'),
  // P4.6 — server-side PostHog capture for cron-fired events. The
  // value is the same as NEXT_PUBLIC_POSTHOG_KEY in PostHog (the
  // project has one API key, but it has two env names so the server
  // can be enabled independently from the browser). Falls back to
  // the public key when only NEXT_PUBLIC_POSTHOG_KEY is set, so
  // dev environments don't need a second secret.
  POSTHOG_PROJECT_API_KEY: z.string().optional().default(''),
  // Audit hash salt for PII-safe identifier hashing in logs and
  // analytics. Mirrors the salt in 00-foundations/auth/rate-limit.ts
  // (which reads from `AUDIT_HASH_SALT` at runtime via
  // `process.env`). Optional with a dev fallback; rotate via Doppler
  // / Coolify env in production.
  AUDIT_HASH_SALT: z.string().optional().default(''),

  // Gorse — optional, no-op if empty.
  GORSE_API_URL: z.string().optional().default(''),
  GORSE_API_KEY: z.string().optional().default(''),

  // SES — optional, falls back to console transport.
  AWS_REGION: z.string().optional().default(''),
  AWS_SES_FROM_EMAIL: z.string().email().optional().default('noreply@uthena.com'),
  AWS_ACCESS_KEY_ID: z.string().optional().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
  AWS_SES_CONFIGURATION_SET: z.string().optional().default(''),

  // Sentry — optional.
  SENTRY_DSN: z.string().optional().default(''),

  // OAuth — display-toggles only. The provider credentials (Google
  // client ID + secret, Apple Services ID + key) live in the Supabase
  // project's Authentication → Providers config, not in this env.
  // Setting OAUTH_GOOGLE_ENABLED=true makes the "Continue with Google"
  // button visible on /login + /signup; the actual OAuth roundtrip is
  // handled by Supabase. See STUB-042 for the wiring Klaas needs to
  // do in the Supabase project before these can flip to `true`.
  OAUTH_GOOGLE_ENABLED: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.literal('')])
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  OAUTH_APPLE_ENABLED: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.literal('')])
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // Security — required always.
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars'),
  ALLOWED_ORIGINS: z.string().default(''),

  // Encryption key for partner-PII at-rest (see
  // `00-foundations/security/encryption.ts`). Optional in dev/test
  // (the encryption module derives a deterministic fallback from
  // AUTH_SECRET); required in production (fail-closed). 32 raw
  // bytes, base64-encoded — generate with `openssl rand -base64 32`
  // and wire via Doppler / Coolify.
  PARTNER_PAYOUT_ENCRYPTION_KEY: z.string().default(''),

  // P12.19 — Pepper for HMAC-SHA256 hashing of partner API tokens
  // before storing in `api_tokens.token_hash`. Optional in dev/test
  // (the helper falls back to plain SHA-256 when the pepper is empty —
  // safe for local development but a DB leak would expose hashes that
  // can be brute-forced); required in production for the
  // "DB leak gives hashes only" property. 32+ random bytes, any
  // encoding — generate with `openssl rand -base64 32` and wire via
  // Doppler / Coolify. Rotating the pepper invalidates every existing
  // token; that is acceptable in v1 (few partners, mass re-issue is
  // cheap) and is the documented trade-off vs. per-token salts.
  UTHENA_API_TOKEN_PEPPER: z.string().default(''),

  // Feature flags.
  DEFAULT_ROYALTY_PCT_BPS: z.coerce.number().int().min(0).max(10000).default(3000),
  PLR_SUBSCRIBER_DISCOUNT_PCT_BPS: z.coerce.number().int().min(0).max(10000).default(1500),
  PERSONAL_ACCESS_PRICE_CENTS: z.coerce.number().int().min(0).default(1900),
})

type Env = z.infer<typeof envSchema>

let cached: Env | null = null

// Defaults used when dev falls back to a partial parse.
const defaults: Env = envSchema.parse({
  NODE_ENV: 'development',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_NAME: 'Uthena',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'dev-placeholder-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'dev-placeholder-service-role',
  AUTH_SECRET: 'x'.repeat(32),
  ALLOWED_ORIGINS: 'http://localhost:3000',
})

export function getEnv(): Env {
  if (cached) return cached
  const parsed = envSchema.safeParse(process.env)
  if (parsed.success) {
    cached = parsed.data
    return cached
  }
  // Failed validation.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
  if (process.env.NODE_ENV === 'production') {
    // Fail closed in production.
    throw new Error(`Invalid environment variables:\n${issues}`)
  }
  // In dev, surface the issues and fall back to a best-effort partial parse.
  // We swallow the type: at this point we know the parse failed; the partial
  // is only to let the app boot, not to mask the warning we just printed.
  // eslint-disable-next-line no-console
  console.warn(`[env] Invalid environment variables (continuing in dev):\n${issues}`)
  const partial = envSchema.partial().parse(process.env) as Partial<Env>
  cached = {
    ...defaults,
    ...partial,
  } as Env
  return cached
}

/** Test-only. Resets the cache. */
export function _resetEnvForTests() {
  cached = null
}
