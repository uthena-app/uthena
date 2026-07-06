// parsePartnerDetailTab.test.ts — unit tests for the parsePartnerDetailTab
// pure helper. The function is small but the input surface (?tab= URL
// param) is hostile, so the test budget covers every rejection case.

import { describe, it, expect } from 'vitest'
import {
  parsePartnerDetailTab,
  PARTNER_DETAIL_TABS,
  DEFAULT_PARTNER_DETAIL_TAB,
  PARTNER_DETAIL_TAB_LABEL,
} from './parsePartnerDetailTab'

describe('parsePartnerDetailTab', () => {
  describe('happy path — every allowed tab', () => {
    it('accepts each tab in the canonical 10-tab allowlist', () => {
      for (const tab of PARTNER_DETAIL_TABS) {
        expect(parsePartnerDetailTab(tab)).toBe(tab)
      }
    })

    it('the canonical overview tab is the default', () => {
      expect(parsePartnerDetailTab('overview')).toBe('overview')
      expect(DEFAULT_PARTNER_DETAIL_TAB).toBe('overview')
    })

    it('every tab has a human label', () => {
      for (const tab of PARTNER_DETAIL_TABS) {
        const label = PARTNER_DETAIL_TAB_LABEL[tab]
        expect(typeof label).toBe('string')
        expect(label.length).toBeGreaterThan(0)
      }
    })
  })

  describe('rejections — empty / null / undefined', () => {
    it('returns default on null', () => {
      expect(parsePartnerDetailTab(null)).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })

    it('returns default on undefined', () => {
      expect(parsePartnerDetailTab(undefined)).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })

    it('returns default on empty string', () => {
      expect(parsePartnerDetailTab('')).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })

    it('returns default on whitespace-only string', () => {
      expect(parsePartnerDetailTab('   ')).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })

    it('returns default on empty array', () => {
      expect(parsePartnerDetailTab([])).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })
  })

  describe('rejections — unknown / malformed tab values', () => {
    it('returns default on unknown tab name', () => {
      expect(parsePartnerDetailTab('unknown')).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })

    it('returns default on tab name with whitespace', () => {
      // The trim-then-reject keeps the URL contract clean — " overview "
      // is treated as suspicious, not silently coerced.
      expect(parsePartnerDetailTab(' overview')).toBe(DEFAULT_PARTNER_DETAIL_TAB)
      expect(parsePartnerDetailTab('overview ')).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })

    it('returns default on uppercase', () => {
      expect(parsePartnerDetailTab('OVERVIEW')).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })

    it('returns default on mixed case', () => {
      expect(parsePartnerDetailTab('Overview')).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })

    it('returns default on oversized input (> 32 chars)', () => {
      expect(parsePartnerDetailTab('a'.repeat(33))).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })

    it('returns default on 1000-char input', () => {
      expect(parsePartnerDetailTab('a'.repeat(1000))).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })
  })

  describe('rejections — injection-shaped', () => {
    it('returns default on SQL injection-shaped input', () => {
      expect(parsePartnerDetailTab("overview'; DROP TABLE partners; --")).toBe(
        DEFAULT_PARTNER_DETAIL_TAB,
      )
    })

    it('returns default on CRLF-shaped input', () => {
      expect(parsePartnerDetailTab('overview\r\nX-Evil: 1')).toBe(
        DEFAULT_PARTNER_DETAIL_TAB,
      )
    })

    it('returns default on shell injection-shaped input', () => {
      expect(parsePartnerDetailTab('overview$(whoami)')).toBe(
        DEFAULT_PARTNER_DETAIL_TAB,
      )
    })

    it('returns default on path traversal-shaped input', () => {
      expect(parsePartnerDetailTab('../../../etc/passwd')).toBe(
        DEFAULT_PARTNER_DETAIL_TAB,
      )
    })
  })

  describe('array input handling', () => {
    it('takes the first element of an array', () => {
      // Next.js's `searchParams` can be `string | string[] | undefined`
      // when the same param appears multiple times. We pick the first.
      expect(parsePartnerDetailTab(['sales', 'overview'])).toBe('sales')
    })

    it('returns default on an array of empty strings', () => {
      expect(parsePartnerDetailTab([''])).toBe(DEFAULT_PARTNER_DETAIL_TAB)
    })
  })

  describe('PARTNER_DETAIL_TABS array shape', () => {
    it('has exactly 10 tabs', () => {
      expect(PARTNER_DETAIL_TABS).toHaveLength(10)
    })

    it('includes the canonical tabs in the spec line 9 order', () => {
      expect(PARTNER_DETAIL_TABS).toEqual([
        'overview',
        'profile',
        'kyc',
        'tax',
        'courses',
        'sales',
        'payouts',
        'refunds',
        'notes',
        'activity',
      ])
    })
  })
})