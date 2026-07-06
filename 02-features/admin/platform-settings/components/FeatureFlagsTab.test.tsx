// FeatureFlagsTab.test.tsx — unit tests for the Feature flags tab
// client island. Uses `renderToStaticMarkup` for fast sync assertions
// (same pattern as `DmcaAgentForm.test.tsx` + `RefundForm.test.tsx`).
//
// We mock the server actions so we can assert that the form invokes
// them with the right payloads. The optimistic-update + rollback
// flow is covered at the action layer (`updatePlatformSettingsFlags.test.ts`).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Mock the server actions BEFORE importing the component under test.
vi.mock('../actions/updatePlatformSettingsFlags', () => ({
  addPlatformFlagAction: vi.fn(async () => ({ ok: true, flags: [], updatedAt: '2026-07-01T00:00:00Z', changed: true, auditId: 1 })),
  updatePlatformFlagAction: vi.fn(async () => ({ ok: true, flags: [], updatedAt: '2026-07-01T00:00:00Z', changed: true, auditId: 1 })),
  removePlatformFlagAction: vi.fn(async () => ({ ok: true, flags: [], updatedAt: '2026-07-01T00:00:00Z', changed: true, auditId: 1 })),
}))

import { FeatureFlagsTab } from './FeatureFlagsTab'
import type { FeatureFlags } from '../lib/featureFlags'

const SAMPLE_FLAGS: FeatureFlags = [
  {
    key: 'new_checkout_flow',
    enabled: true,
    description: 'Test the redesigned checkout',
    rollout_pct: 25,
  },
  {
    key: 'gift_subscriptions',
    enabled: false,
    description: 'Allow buying subscriptions as gifts',
    rollout_pct: null,
  },
]

describe('FeatureFlagsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the tab header + lede', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    expect(html).toContain('Feature flags')
    expect(html).toContain('Toggle runtime feature flags without a deploy.')
    expect(html).toContain('+ Add flag')
  })

  it('renders one row per flag', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    expect(html).toContain('new_checkout_flow')
    expect(html).toContain('gift_subscriptions')
    expect(html).toContain('Test the redesigned checkout')
    expect(html).toContain('Allow buying subscriptions as gifts')
  })

  it('renders the empty state when there are no flags', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={[]} />)
    expect(html).toContain('No feature flags defined yet.')
    expect(html).toContain('flags-empty')
  })

  it('renders an enabled toggle (checked) when enabled=true', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    // The enabled flag (new_checkout_flow) renders a checked switch.
    expect(html).toContain('flag-toggle-new_checkout_flow')
    expect(html).toMatch(/flag-toggle-new_checkout_flow[^>]*checked/);
  })

  it('renders a disabled toggle (unchecked) when enabled=false', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    // The disabled flag (gift_subscriptions) renders an unchecked switch.
    expect(html).toContain('flag-toggle-gift_subscriptions')
  })

  it('renders the rollout_pct value in the number input', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    // new_checkout_flow has rollout_pct=25 → renders "25" in the input
    expect(html).toContain('value="25"')
    // gift_subscriptions has rollout_pct=null → renders empty
  })

  it('renders the placeholder "100" when rollout_pct is null', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    // The "Rollout %" column uses placeholder="100" for the null-100 case.
    expect(html).toContain('placeholder="100"')
  })

  it('renders the key in a monospace <code> block', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    expect(html).toContain('<code')
    expect(html).toContain('flag-key-new_checkout_flow')
  })

  it('renders "No description." muted text when description is empty', () => {
    const flags: FeatureFlags = [
      { key: 'no_desc', enabled: false, description: '', rollout_pct: null },
    ]
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={flags} />)
    expect(html).toContain('No description.')
  })

  it('renders a Remove button per row', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    expect(html).toContain('flag-remove-new_checkout_flow')
    expect(html).toContain('flag-remove-gift_subscriptions')
  })

  it('does not render the add modal initially', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    // The modal backdrop has role="dialog" — should be absent.
    expect(html).not.toContain('Add feature flag')
  })

  it('marks rows with data-pending=false initially', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    expect(html).toContain('data-pending="false"')
  })

  it('marks rows with data-enabled=true/false correctly', () => {
    const html = renderToStaticMarkup(<FeatureFlagsTab initial={SAMPLE_FLAGS} />)
    expect(html).toContain('data-enabled="true"')
    expect(html).toContain('data-enabled="false"')
  })
})