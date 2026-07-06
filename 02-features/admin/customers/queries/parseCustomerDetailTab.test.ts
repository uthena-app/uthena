// parseCustomerDetailTab.test.ts — unit tests for the tab parser.

import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_DETAIL_TABS,
  DEFAULT_CUSTOMER_DETAIL_TAB,
  parseCustomerDetailTab,
} from './parseCustomerDetailTab'

describe('parseCustomerDetailTab', () => {
  it('exposes exactly 9 tabs', () => {
    expect(CUSTOMER_DETAIL_TABS).toHaveLength(9)
  })

  it('returns the input value when valid', () => {
    for (const tab of CUSTOMER_DETAIL_TABS) {
      expect(parseCustomerDetailTab(tab)).toBe(tab)
    }
  })

  it('returns the default on null / undefined / empty', () => {
    expect(parseCustomerDetailTab(null)).toBe(DEFAULT_CUSTOMER_DETAIL_TAB)
    expect(parseCustomerDetailTab(undefined)).toBe(DEFAULT_CUSTOMER_DETAIL_TAB)
    expect(parseCustomerDetailTab('')).toBe(DEFAULT_CUSTOMER_DETAIL_TAB)
    expect(parseCustomerDetailTab('   ')).toBe(DEFAULT_CUSTOMER_DETAIL_TAB)
  })

  it('returns the default on unknown values', () => {
    expect(parseCustomerDetailTab('bogus')).toBe(DEFAULT_CUSTOMER_DETAIL_TAB)
    expect(parseCustomerDetailTab('OVERVIEW')).toBe(DEFAULT_CUSTOMER_DETAIL_TAB)
    expect(parseCustomerDetailTab('Overview')).toBe(DEFAULT_CUSTOMER_DETAIL_TAB)
  })

  it('returns the default on oversized strings', () => {
    expect(parseCustomerDetailTab('a'.repeat(100))).toBe(DEFAULT_CUSTOMER_DETAIL_TAB)
  })

  it('returns the default on SQL-injection-shaped garbage', () => {
    expect(parseCustomerDetailTab("'; DROP TABLE profiles;--")).toBe(
      DEFAULT_CUSTOMER_DETAIL_TAB,
    )
  })

  it('uses the first value of an array', () => {
    expect(parseCustomerDetailTab(['overview', 'orders'])).toBe('overview')
    expect(parseCustomerDetailTab(['orders'])).toBe('orders')
  })

  it('falls back to default for empty array', () => {
    expect(parseCustomerDetailTab([])).toBe(DEFAULT_CUSTOMER_DETAIL_TAB)
  })

  it('trims whitespace before matching', () => {
    expect(parseCustomerDetailTab('  orders  ')).toBe('orders')
  })
})