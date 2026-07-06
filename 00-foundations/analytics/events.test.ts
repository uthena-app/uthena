// Unit tests for the typed PostHog event catalog in
// `00-foundations/analytics/events.ts`. Pure functions, no fixtures,
// no mocks needed. Covers:
//
//   - POSTHOG_EVENTS: the catalog contains the expected event names
//   - POSTHOG_EVENT_PROPS: the schema validates the right shape per
//     event (happy paths + the discriminators reject malformed input)
//   - isPostHogConfigured: env-gated behavior
//   - DEFAULT_POSTHOG_HOST: the canonical EU host
//
// Run: `pnpm test events` (vitest).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetEnvForTests } from '../env'
import {
  DEFAULT_POSTHOG_HOST,
  POSTHOG_EVENTS,
  POSTHOG_EVENT_PROPS,
  isPostHogConfigured,
} from './events'

const BASE_ENV = {
  NEXT_PUBLIC_POSTHOG_KEY: 'phc_test_abc123',
}

function setEnv(overrides: Partial<typeof BASE_ENV> = {}) {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = overrides.NEXT_PUBLIC_POSTHOG_KEY ?? BASE_ENV.NEXT_PUBLIC_POSTHOG_KEY
  _resetEnvForTests()
}

function clearEnv() {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY
  _resetEnvForTests()
}

beforeEach(() => {
  setEnv()
})

afterEach(() => {
  clearEnv()
})

// ===========================================================================
// isPostHogConfigured
// ===========================================================================

describe('isPostHogConfigured', () => {
  it('returns true when NEXT_PUBLIC_POSTHOG_KEY is set', () => {
    setEnv({ NEXT_PUBLIC_POSTHOG_KEY: 'phc_test_abc123' })
    expect(isPostHogConfigured()).toBe(true)
  })

  it('returns false when NEXT_PUBLIC_POSTHOG_KEY is empty', () => {
    setEnv({ NEXT_PUBLIC_POSTHOG_KEY: '' })
    expect(isPostHogConfigured()).toBe(false)
  })
})

// ===========================================================================
// Defaults
// ===========================================================================

describe('defaults', () => {
  it('uses the EU PostHog host as the default', () => {
    expect(DEFAULT_POSTHOG_HOST).toBe('https://eu.i.posthog.com')
  })
})

// ===========================================================================
// Event catalog
// ===========================================================================

describe('POSTHOG_EVENTS catalog', () => {
  it('contains the core auth events', () => {
    for (const e of [
      'auth_signup_started',
      'auth_signup_succeeded',
      'auth_signin_succeeded',
      'auth_oauth_started',
    ]) {
      expect(POSTHOG_EVENTS).toContain(e)
    }
  })

  it('contains the core commerce events', () => {
    for (const e of [
      'catalog_product_viewed',
      'catalog_product_added_to_cart',
      'cart_viewed',
      'cart_abandoned',
      'checkout_started',
      'checkout_completed',
    ]) {
      expect(POSTHOG_EVENTS).toContain(e)
    }
  })

  it('contains the GDPR events', () => {
    for (const e of [
      'gdpr_consent_granted',
      'gdpr_consent_withdrawn',
      'gdpr_data_export_requested',
      'gdpr_account_deletion_requested',
    ]) {
      expect(POSTHOG_EVENTS).toContain(e)
    }
  })

  it('has no duplicate event names', () => {
    expect(new Set(POSTHOG_EVENTS).size).toBe(POSTHOG_EVENTS.length)
  })

  it('every event name is a lowercase snake_case string', () => {
    for (const e of POSTHOG_EVENTS) {
      expect(e).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})

// ===========================================================================
// Per-event schema validation
// ===========================================================================

describe('POSTHOG_EVENT_PROPS — happy paths', () => {
  it('validates page_viewed props', () => {
    expect(POSTHOG_EVENT_PROPS.page_viewed.safeParse({ path: '/browse' }).success).toBe(true)
  })

  it('validates auth_signup_started props (discriminator)', () => {
    expect(
      POSTHOG_EVENT_PROPS.auth_signup_started.safeParse({ surface: 'oauth_google' }).success,
    ).toBe(true)
  })

  it('validates checkout_payment_method_selected props (enum discriminator)', () => {
    expect(
      POSTHOG_EVENT_PROPS.checkout_payment_method_selected.safeParse({ method: 'apple_pay' })
        .success,
    ).toBe(true)
  })

  it('validates gdpr_consent_granted props (array of enum)', () => {
    expect(
      POSTHOG_EVENT_PROPS.gdpr_consent_granted.safeParse({
        categories: ['essential', 'analytics'],
      }).success,
    ).toBe(true)
  })

  it('validates cart_abandoned props (P4.6)', () => {
    expect(
      POSTHOG_EVENT_PROPS.cart_abandoned.safeParse({
        user_id_hash: 'a'.repeat(32),
        line_count: 3,
        subtotal_cents: 17900,
        days_idle_max: 27,
      }).success,
    ).toBe(true)
  })

  it('rejects cart_abandoned with line_count = 0 (positive-required)', () => {
    expect(
      POSTHOG_EVENT_PROPS.cart_abandoned.safeParse({
        user_id_hash: 'a'.repeat(32),
        line_count: 0,
        subtotal_cents: 0,
        days_idle_max: 27,
      }).success,
    ).toBe(false)
  })
})

describe('POSTHOG_EVENT_PROPS — rejections', () => {
  it('rejects page_viewed with missing path', () => {
    expect(POSTHOG_EVENT_PROPS.page_viewed.safeParse({}).success).toBe(false)
  })

  it('rejects auth_signup_started with an unknown surface', () => {
    expect(
      POSTHOG_EVENT_PROPS.auth_signup_started.safeParse({ surface: 'magic' }).success,
    ).toBe(false)
  })

  it('rejects checkout_payment_method_selected with an unknown method', () => {
    expect(
      POSTHOG_EVENT_PROPS.checkout_payment_method_selected.safeParse({ method: 'crypto' })
        .success,
    ).toBe(false)
  })

  it('rejects gdpr_consent_granted with a bogus category', () => {
    expect(
      POSTHOG_EVENT_PROPS.gdpr_consent_granted.safeParse({
        categories: ['essential', 'spyware'],
      }).success,
    ).toBe(false)
  })

  it('rejects auth_signin_succeeded with an unknown method', () => {
    expect(
      POSTHOG_EVENT_PROPS.auth_signin_succeeded.safeParse({
        user_id_hash: 'h',
        method: 'carrier-pigeon',
      }).success,
    ).toBe(false)
  })

  it('rejects numeric props when the schema expects a string', () => {
    expect(
      POSTHOG_EVENT_PROPS.catalog_product_viewed.safeParse({ product_id: 42, slug: 'x' }).success,
    ).toBe(false)
  })

  it('rejects negative integer props when the schema expects nonnegative', () => {
    expect(
      POSTHOG_EVENT_PROPS.cart_viewed.safeParse({ line_count: -3 }).success,
    ).toBe(false)
  })
})

// ===========================================================================
// Schema coverage
// ===========================================================================

describe('POSTHOG_EVENT_PROPS — coverage', () => {
  it('every event in POSTHOG_EVENTS has a matching schema', () => {
    for (const e of POSTHOG_EVENTS) {
      expect(POSTHOG_EVENT_PROPS).toHaveProperty(e)
    }
  })
})