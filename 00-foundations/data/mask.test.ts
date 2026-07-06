// mask.test.ts — unit tests for the admin PII-masking helpers.
//
// Pattern matches `00-foundations/gdpr/retention.test.ts` +
// `00-foundations/gdpr/export.test.ts` — pure, fast, no fixtures.

import { describe, expect, it } from 'vitest'
import { maskEmail, maskIp } from './mask'

describe('maskEmail', () => {
  describe('canonical shape (Stripe/Shopify style)', () => {
    it('masks a standard email', () => {
      expect(maskEmail('john.doe@example.com')).toBe('j***@example.com')
    })

    it('preserves the full domain', () => {
      expect(maskEmail('alice@stripe.com')).toBe('a***@stripe.com')
    })

    it('handles a 1-char local part', () => {
      expect(maskEmail('a@example.com')).toBe('a***@example.com')
    })

    it('handles a long local part (only first char preserved)', () => {
      expect(maskEmail('long.email.alias@example.com')).toBe('l***@example.com')
    })

    it('handles subdomains', () => {
      expect(maskEmail('user@mail.example.com')).toBe('u***@mail.example.com')
    })

    it('handles plus-addressing', () => {
      expect(maskEmail('user+tag@example.com')).toBe('u***@example.com')
    })
  })

  describe('defensive / fallback branches', () => {
    it('returns em-dash for null', () => {
      expect(maskEmail(null)).toBe('—')
    })

    it('returns em-dash for undefined', () => {
      expect(maskEmail(undefined)).toBe('—')
    })

    it('returns em-dash for empty string', () => {
      expect(maskEmail('')).toBe('—')
    })

    it('returns em-dash for whitespace-only string', () => {
      expect(maskEmail('   ')).toBe('—')
    })

    it('falls back for non-string inputs', () => {
      // @ts-expect-error testing runtime guard
      expect(maskEmail(123)).toBe('—')
      // @ts-expect-error testing runtime guard
      expect(maskEmail({})).toBe('—')
    })

    it('handles missing @ (no domain)', () => {
      expect(maskEmail('not-an-email')).toBe('n***')
    })

    it('handles leading @ (no local)', () => {
      expect(maskEmail('@example.com')).toBe('***')
    })

    it('handles trailing @ (no domain)', () => {
      expect(maskEmail('user@')).toBe('u***')
    })

    it('handles email with no chars before @', () => {
      // Degenerate case — just `@` → no head, no domain
      expect(maskEmail('@')).toBe('***')
    })

    it('trims surrounding whitespace', () => {
      expect(maskEmail('  john@example.com  ')).toBe('j***@example.com')
    })
  })

  describe('stability invariant', () => {
    it('renders the same email the same way every time', () => {
      const a = maskEmail('john@example.com')
      const b = maskEmail('john@example.com')
      expect(a).toBe(b)
      expect(a).toBe('j***@example.com')
    })

    it('renders different emails in the same domain differently', () => {
      // 'j' and 'k' both have unique first chars, so admins can
      // still recognize them as different aliases.
      expect(maskEmail('john@example.com')).not.toBe(maskEmail('kate@example.com'))
    })
  })
})

describe('maskIp', () => {
  describe('canonical shape (first 8 chars + ...)', () => {
    it('masks a standard IPv4', () => {
      expect(maskIp('192.168.1.42')).toBe('192.168....')
    })

    it('masks a short IPv4 (under 8 chars + ...)', () => {
      expect(maskIp('10.0.0.1')).toBe('10.0.0.1...')
    })

    it('masks an IPv6 (first 8 chars + ...)', () => {
      expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8...')
    })

    it('masks a hash-shaped string (first 8 hex chars + ...)', () => {
      expect(maskIp('abc12345deadbeef')).toBe('abc12345...')
    })
  })

  describe('defensive / fallback branches', () => {
    it('returns em-dash for null', () => {
      expect(maskIp(null)).toBe('—')
    })

    it('returns em-dash for undefined', () => {
      expect(maskIp(undefined)).toBe('—')
    })

    it('returns em-dash for empty string', () => {
      expect(maskIp('')).toBe('—')
    })

    it('returns em-dash for whitespace-only string', () => {
      expect(maskIp('   ')).toBe('—')
    })

    it('returns em-dash for non-string inputs', () => {
      // @ts-expect-error testing runtime guard
      expect(maskIp(123)).toBe('—')
      // @ts-expect-error testing runtime guard
      expect(maskIp({})).toBe('—')
    })

    it('trims surrounding whitespace', () => {
      expect(maskIp('  192.168.1.42  ')).toBe('192.168....')
    })
  })

  describe('stability invariant', () => {
    it('renders the same IP the same way every time', () => {
      const a = maskIp('192.168.1.42')
      const b = maskIp('192.168.1.42')
      expect(a).toBe(b)
      expect(a).toBe('192.168....')
    })
  })
})