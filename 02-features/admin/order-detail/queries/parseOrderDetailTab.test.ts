// Test suite for parseOrderDetailTab — covers the single-tab allowlist
// + all the documented rejection branches.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORDER_DETAIL_TAB,
  ORDER_DETAIL_TABS,
  parseOrderDetailTab,
} from './parseOrderDetailTab'

describe('parseOrderDetailTab', () => {
  it('accepts the canonical "overview" value', () => {
    expect(parseOrderDetailTab('overview')).toBe('overview')
  })

  it('returns the default when the input is null / undefined', () => {
    expect(parseOrderDetailTab(null)).toBe(DEFAULT_ORDER_DETAIL_TAB)
    expect(parseOrderDetailTab(undefined)).toBe(DEFAULT_ORDER_DETAIL_TAB)
  })

  it('returns the default when the input is empty / whitespace', () => {
    expect(parseOrderDetailTab('')).toBe(DEFAULT_ORDER_DETAIL_TAB)
    expect(parseOrderDetailTab('   ')).toBe(DEFAULT_ORDER_DETAIL_TAB)
    expect(parseOrderDetailTab('\t')).toBe(DEFAULT_ORDER_DETAIL_TAB)
  })

  it('returns the default on oversized input', () => {
    expect(parseOrderDetailTab('overview-but-with-extra-padding')).toBe(
      DEFAULT_ORDER_DETAIL_TAB,
    )
    expect(parseOrderDetailTab('a'.repeat(50))).toBe(DEFAULT_ORDER_DETAIL_TAB)
  })

  it('returns the default on unknown tab names', () => {
    expect(parseOrderDetailTab('unknown')).toBe(DEFAULT_ORDER_DETAIL_TAB)
    expect(parseOrderDetailTab('OVERVIEW')).toBe(DEFAULT_ORDER_DETAIL_TAB)
    expect(parseOrderDetailTab('Overview')).toBe(DEFAULT_ORDER_DETAIL_TAB)
    expect(parseOrderDetailTab('overview ')).toBe(DEFAULT_ORDER_DETAIL_TAB)
  })

  it('returns the default on SQL-injection-shaped input', () => {
    expect(parseOrderDetailTab("overview' OR 1=1;--")).toBe(DEFAULT_ORDER_DETAIL_TAB)
    expect(parseOrderDetailTab('overview;DROP TABLE orders;--')).toBe(
      DEFAULT_ORDER_DETAIL_TAB,
    )
  })

  it('uses the first value when given an array form', () => {
    expect(parseOrderDetailTab(['overview'])).toBe('overview')
    expect(parseOrderDetailTab(['overview', 'unknown'])).toBe('overview')
    expect(parseOrderDetailTab([])).toBe(DEFAULT_ORDER_DETAIL_TAB)
    expect(parseOrderDetailTab(['', 'overview'])).toBe(DEFAULT_ORDER_DETAIL_TAB)
    expect(parseOrderDetailTab(['unknown'])).toBe(DEFAULT_ORDER_DETAIL_TAB)
  })

  it('exposes the canonical tab list as a single-entry tuple', () => {
    expect(ORDER_DETAIL_TABS).toEqual(['overview'])
    // Default is part of the tuple
    expect(DEFAULT_ORDER_DETAIL_TAB).toBe('overview')
  })
})
