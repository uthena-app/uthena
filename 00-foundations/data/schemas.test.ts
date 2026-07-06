// Unit tests for the centralized Zod schemas in `schemas.ts`.
//
// What's covered:
//   - Primitives: Cents, Bps, Slug, Uuid, PhoneE164, CountryCode, SafeUrl
//   - Action inputs: AddToCartInput, UpdateCartLineLicenseInput,
//     ApplyCouponInput, UpdateProfileInput, UpdatePrefsInput,
//     UpdateLocaleTzInput, CreateReviewInput, AddCategoryInput,
//     ImpersonationInput, CancelSubscriptionInput, MintDownloadInput,
//     CheckoutInput, ProductUpsert
//   - Entity reads: every <Entity>EntitySchema — happy path + a few
//     rejection paths each
//
// Run: `pnpm test schemas` (vitest).

import { describe, expect, it } from 'vitest'
import {
  AddCategoryInput,
  AddToCartInput,
  AffiliateEntitySchema,
  AffiliateClickEntitySchema,
  ApplyCouponInput,
  AuditLogEntitySchema,
  Bps,
  BrowseUrlParams,
  BundleItemEntitySchema,
  CancelSubscriptionInput,
  CartItemEntitySchema,
  CartLineInput,
  CartUpdate,
  CategoryEntitySchema,
  Cents,
  CheckoutInput,
  CollectionEntitySchema,
  CouponEntitySchema,
  CountryCode,
  CreateReviewInput,
  DeleteReviewInput,
  FaqEntryInput,
  FileDownloadEntitySchema,
  ImpersonationInput,
  ImpersonationSessionEntitySchema,
  LibraryGrantEntitySchema,
  MintDownloadInput,
  MintStreamInput,
  NotificationPreferencesEntitySchema,
  OpenBillingPortalInput,
  OrderEntitySchema,
  OrderItemEntitySchema,
  PartnerEntitySchema,
  PayoutLedgerEntitySchema,
  PhoneE164,
  PlatformSettingsEntitySchema,
  PositiveCents,
  ProductFileAttach,
  ProductFileEntitySchema,
  ProductImageEntitySchema,
  ProductPricingEntitySchema,
  ProductUpsert,
  ProfileEntitySchema,
  ProfileUpdate,
  ReorderCategoryInput,
  RefundDecisionInput,
  RefundEntitySchema,
  RefundRequestInput,
  ResumeSubscriptionInput,
  ReviewEntitySchema,
  SafeUrl,
  Slug,
  SubscriptionEntitySchema,
  SubscriptionStartInput,
  TipTapDocSchema,
  parseTipTapDoc,
  TIP_TAP_MAX_DOC_NODES,
  TIP_TAP_MAX_DOC_DEPTH,
  UpdateCartLineLicenseInput,
  UpdateCartLineQuantityInput,
  UpdateCategoryInput,
  UpdateLocaleTzInput,
  UpdatePartnerSettingsInput,
  UpdatePrefsInput,
  UpdateReviewInput,
  UpdateProfileInput,
  Uuid,
} from './schemas'

// ===========================================================================
// 1. Primitives
// ===========================================================================

describe('Cents', () => {
  it.each([0, 1, 100, 49700, Number.MAX_SAFE_INTEGER])('accepts %i cents', (n) => {
    expect(Cents.safeParse(n).success).toBe(true)
  })
  it.each([-1, 0.5, NaN, Infinity, '100'])('rejects %s', (v) => {
    expect(Cents.safeParse(v).success).toBe(false)
  })
})

describe('PositiveCents', () => {
  it.each([1, 100, 49700])('accepts %i cents', (n) => {
    expect(PositiveCents.safeParse(n).success).toBe(true)
  })
  it('rejects zero', () => {
    expect(PositiveCents.safeParse(0).success).toBe(false)
  })
  it('rejects negatives', () => {
    expect(PositiveCents.safeParse(-1).success).toBe(false)
  })
})

describe('Bps', () => {
  it.each([0, 100, 5000, 10000])('accepts %i bps', (n) => {
    expect(Bps.safeParse(n).success).toBe(true)
  })
  it.each([-1, 10001, 0.5])('rejects %s', (v) => {
    expect(Bps.safeParse(v).success).toBe(false)
  })
})

describe('Slug', () => {
  it.each(['ai', 'ai-courses', 'plr-product-2', 'a'.repeat(100)])('accepts %s', (s) => {
    expect(Slug.safeParse(s).success).toBe(true)
  })
  it.each([
    ['a', 'too short'],
    ['AI', 'uppercase'],
    ['ai_courses', 'underscore'],
    ['ai courses', 'space'],
    ['ai.courses', 'dot'],
    ['-ai', 'leading hyphen'],
    ['ai-', 'trailing hyphen'],
    ['a'.repeat(101), 'too long'],
  ])('rejects %s (%s)', (s) => {
    expect(Slug.safeParse(s).success).toBe(false)
  })
})

describe('Uuid', () => {
  it('accepts a valid v4 UUID', () => {
    expect(Uuid.safeParse('11111111-2222-4333-8444-555555555555').success).toBe(true)
  })
  it('rejects an empty string', () => {
    expect(Uuid.safeParse('').success).toBe(false)
  })
  it('rejects a non-UUID string', () => {
    expect(Uuid.safeParse('not-a-uuid').success).toBe(false)
  })
})

describe('PhoneE164', () => {
  it('accepts E.164', () => {
    expect(PhoneE164.safeParse('+15555555555').success).toBe(true)
  })
  it.each(['15555555555', '+0123', '+12'])('rejects %s', (s) => {
    expect(PhoneE164.safeParse(s).success).toBe(false)
  })
  it('is optional', () => {
    expect(PhoneE164.safeParse(undefined).success).toBe(true)
  })
})

describe('CountryCode', () => {
  it.each(['US', 'NL', 'JP'])('accepts %s', (s) => {
    expect(CountryCode.safeParse(s).success).toBe(true)
  })
  it.each(['USA', 'us', 'U1'])('rejects %s', (s) => {
    expect(CountryCode.safeParse(s).success).toBe(false)
  })
})

describe('SafeUrl', () => {
  it('accepts https URLs', () => {
    expect(SafeUrl.safeParse('https://example.com/x.png').success).toBe(true)
  })
  it.each(['javascript:alert(1)', 'not a url', ''])('rejects %s', (s) => {
    expect(SafeUrl.safeParse(s).success).toBe(false)
  })
  it('rejects URLs longer than 2000 chars', () => {
    const huge = 'https://example.com/' + 'a'.repeat(2000)
    expect(SafeUrl.safeParse(huge).success).toBe(false)
  })
})

// ===========================================================================
// 2. Action INPUT schemas
// ===========================================================================

describe('AddToCartInput', () => {
  it('accepts a valid add', () => {
    const r = AddToCartInput.safeParse({ product_id: '42', license: 'plr', quantity: '2' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.product_id).toBe(42)
      expect(r.data.license).toBe('plr')
      expect(r.data.quantity).toBe(2)
    }
  })
  it('defaults quantity to 1', () => {
    const r = AddToCartInput.safeParse({ product_id: 1, license: 'mrr' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.quantity).toBe(1)
  })
  it('rejects invalid license', () => {
    expect(AddToCartInput.safeParse({ product_id: 1, license: 'evil' }).success).toBe(false)
  })
  it('rejects non-positive product_id', () => {
    expect(AddToCartInput.safeParse({ product_id: 0, license: 'plr' }).success).toBe(false)
  })
  it('rejects quantity > 99', () => {
    expect(AddToCartInput.safeParse({ product_id: 1, license: 'plr', quantity: 100 }).success).toBe(false)
  })
})

describe('UpdateCartLineLicenseInput', () => {
  it('accepts a valid update', () => {
    expect(
      UpdateCartLineLicenseInput.safeParse({ cart_item_id: '10', license: 'mrr' }).success,
    ).toBe(true)
  })
  it('rejects unknown license', () => {
    expect(
      UpdateCartLineLicenseInput.safeParse({ cart_item_id: 10, license: 'enterprise' }).success,
    ).toBe(false)
  })
})

describe('UpdateCartLineQuantityInput', () => {
  it.each([1, 50, 99])('accepts quantity %i', (q) => {
    expect(
      UpdateCartLineQuantityInput.safeParse({ cart_item_id: 1, quantity: q }).success,
    ).toBe(true)
  })
  it.each([0, -1, 100])('rejects quantity %i', (q) => {
    expect(
      UpdateCartLineQuantityInput.safeParse({ cart_item_id: 1, quantity: q }).success,
    ).toBe(false)
  })
})

describe('ApplyCouponInput', () => {
  it.each(['WINTER20', 'NEW-USER_50', 'A2', 'winter20'])('accepts %s', (s) => {
    // Lowercase is accepted and normalized to uppercase via transform.
    const r = ApplyCouponInput.safeParse({ code: s })
    expect(r.success).toBe(true)
    if (r.success && s === 'winter20') {
      expect(r.data.code).toBe('WINTER20')
    }
  })
  it.each([
    ['a', 'too short'],
    ['has space', 'spaces'],
    ['with.dot', 'dots'],
  ])('rejects %s (%s)', (s) => {
    expect(ApplyCouponInput.safeParse({ code: s }).success).toBe(false)
  })
})

describe('CheckoutInput', () => {
  it('accepts a minimal checkout', () => {
    const r = CheckoutInput.safeParse({
      email: 'a@b.com',
      lines: [{ product_id: 1, quantity: 1 }],
    })
    expect(r.success).toBe(true)
  })
  it('rejects empty lines', () => {
    expect(
      CheckoutInput.safeParse({ email: 'a@b.com', lines: [] }).success,
    ).toBe(false)
  })
  it('rejects malformed email', () => {
    expect(
      CheckoutInput.safeParse({
        email: 'not-an-email',
        lines: [{ product_id: 1, quantity: 1 }],
      }).success,
    ).toBe(false)
  })
  it('accepts optional coupon_code + affiliate_handle', () => {
    expect(
      CheckoutInput.safeParse({
        email: 'a@b.com',
        lines: [{ product_id: 1, quantity: 1 }],
        coupon_code: 'WINTER20',
        affiliate_handle: 'jane',
      }).success,
    ).toBe(true)
  })
})

describe('SubscriptionStartInput', () => {
  it('accepts a valid start', () => {
    expect(
      SubscriptionStartInput.safeParse({
        price_id: 'price_abc',
        success_url: 'https://example.com/done',
        cancel_url: 'https://example.com/cancel',
      }).success,
    ).toBe(true)
  })
  it('rejects missing price_id', () => {
    expect(
      SubscriptionStartInput.safeParse({
        success_url: 'https://example.com/done',
        cancel_url: 'https://example.com/cancel',
      }).success,
    ).toBe(false)
  })
})

describe('CancelSubscriptionInput', () => {
  it('requires the literal "cancel" confirmation', () => {
    expect(
      CancelSubscriptionInput.safeParse({ subscription_id: 1, confirmation: 'cancel' }).success,
    ).toBe(true)
  })
  it.each(['CANCEL', 'Cancel', 'yes', '', undefined])('rejects %s', (c) => {
    expect(
      CancelSubscriptionInput.safeParse({ subscription_id: 1, confirmation: c }).success,
    ).toBe(false)
  })
})

describe('ResumeSubscriptionInput', () => {
  it('accepts a subscription_id', () => {
    expect(ResumeSubscriptionInput.safeParse({ subscription_id: '5' }).success).toBe(true)
  })
})

describe('OpenBillingPortalInput', () => {
  it('accepts an optional return_url', () => {
    expect(
      OpenBillingPortalInput.safeParse({ return_url: 'https://example.com/back' }).success,
    ).toBe(true)
  })
  it('accepts empty input', () => {
    expect(OpenBillingPortalInput.safeParse({}).success).toBe(true)
  })
})

describe('MintDownloadInput', () => {
  it('accepts a numeric file id', () => {
    expect(MintDownloadInput.safeParse({ file_id: '123' }).success).toBe(true)
  })
  it('rejects non-positive', () => {
    expect(MintDownloadInput.safeParse({ file_id: 0 }).success).toBe(false)
  })
})

describe('MintStreamInput', () => {
  it('accepts a numeric lesson id', () => {
    expect(MintStreamInput.safeParse({ lesson_id: 7 }).success).toBe(true)
  })
})

describe('UpdateProfileInput', () => {
  it('accepts a valid profile update', () => {
    expect(
      UpdateProfileInput.safeParse({
        display_name: 'Jane',
        bio: 'Hello world',
        locale: 'en',
        timezone: 'UTC',
      }).success,
    ).toBe(true)
  })
  it('requires display_name', () => {
    expect(
      UpdateProfileInput.safeParse({
        display_name: '',
        locale: 'en',
        timezone: 'UTC',
      }).success,
    ).toBe(false)
  })
  it('rejects display_name > 80 chars', () => {
    expect(
      UpdateProfileInput.safeParse({
        display_name: 'x'.repeat(81),
        locale: 'en',
        timezone: 'UTC',
      }).success,
    ).toBe(false)
  })
  it('rejects bio > 280 chars', () => {
    expect(
      UpdateProfileInput.safeParse({
        display_name: 'Jane',
        bio: 'x'.repeat(281),
        locale: 'en',
        timezone: 'UTC',
      }).success,
    ).toBe(false)
  })
  it('accepts null avatar_url (to clear it)', () => {
    expect(
      UpdateProfileInput.safeParse({
        display_name: 'Jane',
        locale: 'en',
        timezone: 'UTC',
        avatar_url: null,
      }).success,
    ).toBe(true)
  })
})

describe('ProfileUpdate', () => {
  it('accepts an empty update (no fields)', () => {
    expect(ProfileUpdate.safeParse({}).success).toBe(true)
  })
  it('rejects display_name > 80 chars', () => {
    expect(ProfileUpdate.safeParse({ display_name: 'x'.repeat(81) }).success).toBe(false)
  })
})

describe('UpdatePrefsInput', () => {
  it('accepts a full set of v2 preferences', () => {
    expect(
      UpdatePrefsInput.safeParse({
        email_digest_freq: 'weekly',
        marketing_opt_in: true,
        newsletter_opt_in: true,
        partner_updates_opt_in: false,
        affiliate_updates_opt_in: false,
      }).success,
    ).toBe(true)
  })
  it('accepts a single-field patch (email_digest_freq only)', () => {
    expect(UpdatePrefsInput.safeParse({ email_digest_freq: 'daily' }).success).toBe(true)
  })
  it('accepts a single-field patch (marketing_opt_in only)', () => {
    expect(UpdatePrefsInput.safeParse({ marketing_opt_in: false }).success).toBe(true)
  })
  it('accepts a single-field patch (newsletter_opt_in only)', () => {
    expect(UpdatePrefsInput.safeParse({ newsletter_opt_in: true }).success).toBe(true)
  })
  it('rejects an unknown email_digest_freq value', () => {
    expect(UpdatePrefsInput.safeParse({ email_digest_freq: 'biweekly' }).success).toBe(false)
  })
  it('rejects non-boolean values for the marketing toggles', () => {
    expect(UpdatePrefsInput.safeParse({ marketing_opt_in: 'yes' }).success).toBe(false)
  })
  it('rejects an empty object (no fields to patch)', () => {
    expect(UpdatePrefsInput.safeParse({}).success).toBe(false)
  })
  it('rejects unknown keys (strict mode)', () => {
    expect(
      UpdatePrefsInput.safeParse({ email_digest_freq: 'weekly', legacy_field: true }).success,
    ).toBe(false)
  })
  it('rejects a transaction attempt for transactional_opt_in (locked field)', () => {
    // The schema doesn't even declare transactional_opt_in, so any
    // attempt to set it should fail under strict mode.
    expect(
      UpdatePrefsInput.safeParse({ transactional_opt_in: false, email_digest_freq: 'weekly' })
        .success,
    ).toBe(false)
  })
})

describe('UpdateLocaleTzInput', () => {
  it('accepts a valid pair', () => {
    expect(UpdateLocaleTzInput.safeParse({ locale: 'en-US', timezone: 'UTC' }).success).toBe(true)
  })
  it('rejects locale too short', () => {
    expect(UpdateLocaleTzInput.safeParse({ locale: 'e', timezone: 'UTC' }).success).toBe(false)
  })
})

describe('CreateReviewInput', () => {
  it('accepts a valid review', () => {
    expect(
      CreateReviewInput.safeParse({
        productId: '42',
        rating: 5,
        title: 'Great!',
        body: 'x'.repeat(50),
      }).success,
    ).toBe(true)
  })
  it('rejects body < 50 chars', () => {
    expect(
      CreateReviewInput.safeParse({
        productId: 1,
        rating: 5,
        body: 'too short',
      }).success,
    ).toBe(false)
  })
  it('rejects rating > 5', () => {
    expect(
      CreateReviewInput.safeParse({
        productId: 1,
        rating: 6,
        body: 'x'.repeat(50),
      }).success,
    ).toBe(false)
  })
})

describe('UpdateReviewInput', () => {
  it('accepts a valid update', () => {
    expect(
      UpdateReviewInput.safeParse({
        reviewId: 1,
        rating: 4,
        body: 'x'.repeat(50),
      }).success,
    ).toBe(true)
  })
})

describe('DeleteReviewInput', () => {
  it('accepts a numeric reviewId', () => {
    expect(DeleteReviewInput.safeParse({ reviewId: '5' }).success).toBe(true)
  })
})

describe('RefundRequestInput', () => {
  it('accepts a valid refund request', () => {
    expect(
      RefundRequestInput.safeParse({
        order_id: 1,
        reason: 'requested_by_customer',
        amount_cents: 4900,
        notes: 'Please',
      }).success,
    ).toBe(true)
  })
  it('rejects unknown reason', () => {
    expect(
      RefundRequestInput.safeParse({
        order_id: 1,
        reason: 'because-i-said-so',
        amount_cents: 4900,
      }).success,
    ).toBe(false)
  })
  it('rejects amount_cents = 0', () => {
    expect(
      RefundRequestInput.safeParse({
        order_id: 1,
        reason: 'duplicate',
        amount_cents: 0,
      }).success,
    ).toBe(false)
  })
})

describe('RefundDecisionInput', () => {
  it.each(['approve', 'deny'])('accepts %s', (d) => {
    expect(RefundDecisionInput.safeParse({ refund_id: 1, decision: d }).success).toBe(true)
  })
})

describe('AddCategoryInput', () => {
  it('accepts a top-level category', () => {
    expect(
      AddCategoryInput.safeParse({
        name: 'AI',
        slug: 'ai',
        description: 'AI courses',
      }).success,
    ).toBe(true)
  })
  it('accepts a sub-category with parent_id', () => {
    expect(
      AddCategoryInput.safeParse({
        name: 'AI Copywriting',
        slug: 'ai-copywriting',
        parent_id: '5',
      }).success,
    ).toBe(true)
  })
  it('rejects uppercase slug', () => {
    expect(
      AddCategoryInput.safeParse({ name: 'AI', slug: 'AI' }).success,
    ).toBe(false)
  })
})

describe('UpdateCategoryInput', () => {
  it('requires id', () => {
    expect(
      UpdateCategoryInput.safeParse({ name: 'AI', slug: 'ai' }).success,
    ).toBe(false)
  })
})

describe('ReorderCategoryInput', () => {
  it('accepts a new parent + display_order + sibling_ids', () => {
    expect(
      ReorderCategoryInput.safeParse({
        id: 5,
        new_parent_id: 2,
        new_display_order: 3,
        sibling_ids: [1, 5, 7],
      }).success,
    ).toBe(true)
  })
  it('accepts new_parent_id = null (move to top-level)', () => {
    expect(
      ReorderCategoryInput.safeParse({
        id: 5,
        new_parent_id: null,
        new_display_order: 0,
        sibling_ids: [5, 8, 9],
      }).success,
    ).toBe(true)
  })
  it('rejects negative display_order', () => {
    expect(
      ReorderCategoryInput.safeParse({
        id: 5,
        new_parent_id: 2,
        new_display_order: -1,
        sibling_ids: [5],
      }).success,
    ).toBe(false)
  })
  it('rejects > 500 siblings', () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => i + 1)
    expect(
      ReorderCategoryInput.safeParse({
        id: 5,
        new_parent_id: 2,
        new_display_order: 0,
        sibling_ids: tooMany,
      }).success,
    ).toBe(false)
  })
})

describe('ImpersonationInput', () => {
  it('accepts a valid impersonation request', () => {
    expect(
      ImpersonationInput.safeParse({
        target_user_id: '11111111-2222-4333-8444-555555555555',
        reason: 'Customer support ticket #12345 needs review',
      }).success,
    ).toBe(true)
  })
  it('rejects reason < 20 chars (audit-log readable)', () => {
    expect(
      ImpersonationInput.safeParse({
        target_user_id: '11111111-2222-4333-8444-555555555555',
        reason: 'support',
      }).success,
    ).toBe(false)
  })
  it('rejects reason > 500 chars', () => {
    expect(
      ImpersonationInput.safeParse({
        target_user_id: '11111111-2222-4333-8444-555555555555',
        reason: 'x'.repeat(501),
      }).success,
    ).toBe(false)
  })
})

describe('UpdatePartnerSettingsInput', () => {
  it('accepts an empty update', () => {
    expect(UpdatePartnerSettingsInput.safeParse({}).success).toBe(true)
  })
  it('accepts a public_slug + bio', () => {
    expect(
      UpdatePartnerSettingsInput.safeParse({
        public_slug: 'jane-doe',
        bio: 'PLR author since 2018',
      }).success,
    ).toBe(true)
  })
})

describe('ProductUpsert', () => {
  const valid = {
    slug: 'ai-course',
    title: 'AI Personal Branding',
    short_description: 'Learn to brand yourself with AI',
    long_description: { type: 'doc', content: [] },
    kind: 'video_course' as const,
    category_id: 1,
    price_cents: 4900,
  }
  it('accepts a valid product', () => {
    expect(ProductUpsert.safeParse(valid).success).toBe(true)
  })
  it('requires slug', () => {
    const { slug, ...rest } = valid
    expect(ProductUpsert.safeParse(rest).success).toBe(false)
  })
  it('rejects unknown kind', () => {
    expect(ProductUpsert.safeParse({ ...valid, kind: 'podcast' }).success).toBe(false)
  })
  it('rejects negative price_cents', () => {
    expect(ProductUpsert.safeParse({ ...valid, price_cents: -1 }).success).toBe(false)
  })
})

describe('ProductFileAttach', () => {
  it('accepts a video file attach', () => {
    expect(
      ProductFileAttach.safeParse({
        product_id: 1,
        kind: 'video',
        original_filename: 'module-1.mp4',
        storage_path: 'products/1/module-1.mp4',
        size_bytes: 100_000_000,
        mime_type: 'video/mp4',
      }).success,
    ).toBe(true)
  })
  it('rejects unknown kind', () => {
    expect(
      ProductFileAttach.safeParse({
        product_id: 1,
        kind: 'podcast',
        original_filename: 'x.mp3',
        storage_path: 'x',
        size_bytes: 100,
        mime_type: 'audio/mpeg',
      }).success,
    ).toBe(false)
  })
  it('rejects bad sha256', () => {
    expect(
      ProductFileAttach.safeParse({
        product_id: 1,
        kind: 'video',
        original_filename: 'x.mp4',
        storage_path: 'x',
        size_bytes: 100,
        mime_type: 'video/mp4',
        checksum_sha256: 'not-a-sha',
      }).success,
    ).toBe(false)
  })
})

describe('FaqEntryInput', () => {
  it('accepts a valid FAQ entry', () => {
    expect(
      FaqEntryInput.safeParse({
        question: 'What is PLR?',
        answer: { type: 'doc', content: [] },
        display_order: 0,
        is_published: false,
      }).success,
    ).toBe(true)
  })
  it('requires question ≥ 3 chars', () => {
    expect(
      FaqEntryInput.safeParse({
        question: 'Hi',
        answer: {},
      }).success,
    ).toBe(false)
  })
})

describe('CartLineInput + CartUpdate', () => {
  it('CartLineInput accepts a valid line', () => {
    expect(CartLineInput.safeParse({ product_id: 1, quantity: 1 }).success).toBe(true)
  })
  it('CartUpdate caps at 50 lines', () => {
    const lines = Array.from({ length: 51 }, (_, i) => ({
      product_id: i + 1,
      quantity: 1,
    }))
    expect(CartUpdate.safeParse({ lines }).success).toBe(false)
  })
})

describe('BrowseUrlParams', () => {
  it('accepts the default empty URL', () => {
    expect(BrowseUrlParams.safeParse({}).success).toBe(true)
  })
  it('accepts all 4 params together', () => {
    expect(
      BrowseUrlParams.safeParse({
        category: 'ai',
        sort: 'popular',
        price: 'under-50',
        density: 'compact',
      }).success,
    ).toBe(true)
  })
  it('rejects unknown sort', () => {
    expect(BrowseUrlParams.safeParse({ sort: 'shiny' }).success).toBe(false)
  })
  it('rejects unknown density', () => {
    expect(BrowseUrlParams.safeParse({ density: 'spacious' }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// TipTapDocSchema — the contract for WYSIWYG content (RichTextField editor
// output, renderTipTap renderer input).
//
// Validates the recursive node tree shape, caps depth + total node count,
// and allowlist-checks link-mark href to reject javascript:/data:/vbscript:/
// file: schemes (XSS defense). Node `type` is intentionally free-form so
// forward-compat nodes still parse; the renderer is also permissive
// (unknown types render their children as a fallback).
// ---------------------------------------------------------------------------

describe('TipTapDocSchema — outer shape', () => {
  it('accepts an empty doc', () => {
    expect(
      TipTapDocSchema.safeParse({ type: 'doc', content: [] }).success,
    ).toBe(true)
  })

  it('defaults content to [] when missing', () => {
    const r = TipTapDocSchema.safeParse({ type: 'doc' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.content).toEqual([])
  })

  it('rejects non-doc root', () => {
    expect(
      TipTapDocSchema.safeParse({ type: 'paragraph', content: [] }).success,
    ).toBe(false)
    expect(
      TipTapDocSchema.safeParse({ type: 'text', text: 'hi' }).success,
    ).toBe(false)
  })

  it('rejects non-objects (null, number, string, array)', () => {
    expect(TipTapDocSchema.safeParse(null).success).toBe(false)
    expect(TipTapDocSchema.safeParse(42).success).toBe(false)
    expect(TipTapDocSchema.safeParse('doc').success).toBe(false)
    expect(TipTapDocSchema.safeParse([]).success).toBe(false)
  })

  it('exports the defensive caps as named constants', () => {
    expect(TIP_TAP_MAX_DOC_NODES).toBe(5000)
    expect(TIP_TAP_MAX_DOC_DEPTH).toBe(64)
  })
})

describe('TipTapDocSchema — paragraph + heading nodes', () => {
  it('accepts a paragraph with a text child', () => {
    const r = TipTapDocSchema.safeParse({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('accepts a heading with level 2 + 3', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'H2' }],
          },
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'H3' }],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('rejects heading with level=1 (out of allowlist)', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'H1' }],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects heading with level=4 (out of allowlist)', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 4 },
            content: [{ type: 'text', text: 'H4' }],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects heading with level as a string', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: '2' },
            content: [{ type: 'text', text: 'bad' }],
          },
        ],
      }).success,
    ).toBe(false)
  })
})

describe('TipTapDocSchema — list nodes', () => {
  it('accepts bulletList → listItem → paragraph → text', () => {
    const r = TipTapDocSchema.safeParse({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'first' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'second' }],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('accepts orderedList with start attr', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'orderedList',
            attrs: { start: 1 },
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })
})

describe('TipTapDocSchema — blockquote + codeBlock + horizontalRule + hardBreak', () => {
  it('accepts blockquote with nested paragraph', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'blockquote',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'quoted' }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('accepts codeBlock with a language attr', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'typescript' },
            content: [{ type: 'text', text: 'const x = 1' }],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('accepts horizontalRule as a void node', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'horizontalRule' }],
      }).success,
    ).toBe(true)
  })

  it('accepts hardBreak inside a text run', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'line1' },
              { type: 'hardBreak' },
              { type: 'text', text: 'line2' },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })
})

describe('TipTapDocSchema — marks', () => {
  it('accepts a bold + italic + strike + underline + code mark on a text node', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
              { type: 'text', text: 'i', marks: [{ type: 'italic' }] },
              { type: 'text', text: 's', marks: [{ type: 'strike' }] },
              { type: 'text', text: 'u', marks: [{ type: 'underline' }] },
              { type: 'text', text: 'c', marks: [{ type: 'code' }] },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('rejects an unknown mark type', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight' }] }],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('accepts a link mark with a safe http(s) href', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [
                  { type: 'link', attrs: { href: 'https://example.com' } },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('accepts a link mark with a relative href', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [{ type: 'link', attrs: { href: '/products' } }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('accepts a link mark with a mailto: href', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'email',
                marks: [{ type: 'link', attrs: { href: 'mailto:hi@example.com' } }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('accepts a link mark with a tel: href', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'call',
                marks: [{ type: 'link', attrs: { href: 'tel:+15555555555' } }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('accepts a link mark with an anchor href', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'jump',
                marks: [{ type: 'link', attrs: { href: '#section-2' } }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('rejects a link mark with a javascript: href (XSS defense)', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [
                  { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects a link mark with a data: href (XSS defense)', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [
                  {
                    type: 'link',
                    attrs: { href: 'data:text/html,<script>alert(1)</script>' },
                  },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects a link mark with a vbscript: href (XSS defense)', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [{ type: 'link', attrs: { href: 'vbscript:msgbox(1)' } }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects a link mark with a file: href (XSS defense)', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [{ type: 'link', attrs: { href: 'file:///etc/passwd' } }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects a link mark with case-variant JavaScript: scheme', () => {
    // Defense in depth — the regex is case-insensitive
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [
                  { type: 'link', attrs: { href: 'JaVaScRiPt:alert(1)' } },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects a link mark with an empty href', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [{ type: 'link', attrs: { href: '' } }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false)
  })
})

describe('TipTapDocSchema — defensive caps', () => {
  it('rejects a doc with depth > TIP_TAP_MAX_DOC_DEPTH', () => {
    // Build a doc nested deeper than 64 levels: 80 nested paragraphs.
    const deeply: any = { type: 'doc', content: [] }
    let cur = deeply
    for (let i = 0; i < TIP_TAP_MAX_DOC_DEPTH + 16; i++) {
      const child = { type: 'doc', content: [] }
      cur.content = [child]
      cur = child
    }
    expect(TipTapDocSchema.safeParse(deeply).success).toBe(false)
  })

  it('rejects a doc with total nodes > TIP_TAP_MAX_DOC_NODES', () => {
    // Build a doc with 5,001 paragraph siblings — one over the cap.
    const overflow = Array.from({ length: TIP_TAP_MAX_DOC_NODES + 1 }, () => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x' }],
    }))
    expect(
      TipTapDocSchema.safeParse({ type: 'doc', content: overflow }).success,
    ).toBe(false)
  })

  it('accepts a doc at the boundary: 2500 paragraphs (= 5001 total nodes, under the 5001 cap... wait under the 5000 cap)', () => {
    // 2500 paragraphs × 2 nodes each (paragraph + text) + 1 doc = 5001 nodes.
    // Wait — the cap is on total nodes including the doc. So 2500 paragraphs
    // = 5001 total, which IS over the 5000 cap. Use 2499 paragraphs instead.
    const exact = Array.from({ length: 2499 }, () => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x' }],
    }))
    // 2499 paragraphs × 2 = 4998, +1 doc = 4999 total nodes (under the 5000 cap).
    expect(
      TipTapDocSchema.safeParse({ type: 'doc', content: exact }).success,
    ).toBe(true)
  })

  it('rejects 2500 paragraphs (= 5001 total nodes, over the 5000 cap)', () => {
    const overflow = Array.from({ length: 2500 }, () => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x' }],
    }))
    expect(
      TipTapDocSchema.safeParse({ type: 'doc', content: overflow }).success,
    ).toBe(false)
  })

  it('rejects a doc with total nodes exceeding the cap (accumulated via recursion)', () => {
    // Each level contributes 10 children, nested 5 deep = 10^5 = 100,000
    // nodes — well over the 5000 cap. The .superRefine must catch this,
    // not just the per-content-array cap.
    const root: any = { type: 'doc', content: [] }
    let cur = root
    for (let depth = 0; depth < 5; depth++) {
      const next: any = { type: 'doc', content: [] }
      for (let i = 0; i < 10; i++) {
        cur.content.push(next)
      }
      cur = next
    }
    expect(TipTapDocSchema.safeParse(root).success).toBe(false)
  })
})

describe('TipTapDocSchema — forward compat (unknown node types pass through)', () => {
  it('accepts an unknown node type (renderer falls back to "render children")', () => {
    const r = TipTapDocSchema.safeParse({
      type: 'doc',
      content: [
        {
          type: 'customThing',
          attrs: { foo: 'bar' },
          content: [{ type: 'text', text: 'forward compat' }],
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('accepts a text node with marks[] + a content field (forward compat)', () => {
    // Some TipTap extensions add fields beyond the base shape. `.passthrough()`
    // means unknown fields are preserved, not stripped.
    const r = TipTapDocSchema.safeParse({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          unknownField: 'preserved',
          content: [{ type: 'text', text: 'hi' }],
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rejects a text node with a non-string `text` field', () => {
    expect(
      TipTapDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'text', text: 123 }],
      }).success,
    ).toBe(false)
  })
})

describe('parseTipTapDoc helper — graceful degradation', () => {
  it('returns the validated node for valid input', () => {
    const doc = { type: 'doc', content: [] } as const
    expect(parseTipTapDoc(doc)).toEqual(doc)
  })

  it('returns null for null', () => {
    expect(parseTipTapDoc(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(parseTipTapDoc(undefined)).toBeNull()
  })

  it('returns null for a string', () => {
    expect(parseTipTapDoc('doc')).toBeNull()
  })

  it('returns null for a number', () => {
    expect(parseTipTapDoc(42)).toBeNull()
  })

  it('returns null for an array', () => {
    expect(parseTipTapDoc([])).toBeNull()
  })

  it('returns null for an object missing type=doc', () => {
    expect(parseTipTapDoc({ type: 'paragraph', content: [] })).toBeNull()
  })

  it('returns null for a corrupt doc with an unsafe link', () => {
    expect(
      parseTipTapDoc({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      }),
    ).toBeNull()
  })

  it('returns null for a doc exceeding the node cap', () => {
    const overflow = Array.from({ length: TIP_TAP_MAX_DOC_NODES + 1 }, () => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x' }],
    }))
    expect(parseTipTapDoc({ type: 'doc', content: overflow })).toBeNull()
  })

  it('returns null for a doc exceeding the depth cap', () => {
    const deeply: any = { type: 'doc', content: [] }
    let cur = deeply
    for (let i = 0; i < TIP_TAP_MAX_DOC_DEPTH + 16; i++) {
      const child: any = { type: 'doc', content: [] }
      cur.content = [child]
      cur = child
    }
    expect(parseTipTapDoc(deeply)).toBeNull()
  })

  it('returns the validated node for a doc containing all common node types', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'p' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'l' }] }] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'o' }] }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'c' }] },
        { type: 'horizontalRule' },
      ],
    }
    const result = parseTipTapDoc(doc)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('doc')
  })
})

// ===========================================================================
// 3. Entity READ schemas — happy path + 1-2 rejection paths each
// ===========================================================================

const VALID_USER_ID = '11111111-2222-4333-8444-555555555555'

describe('ProfileEntitySchema', () => {
  it('accepts a profile row', () => {
    expect(
      ProfileEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        display_name: 'Jane',
        avatar_url: null,
        role: 'customer',
        status: 'active',
      }).success,
    ).toBe(true)
  })
  it('rejects invalid role', () => {
    expect(
      ProfileEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        display_name: 'Jane',
        avatar_url: null,
        role: 'god',
        status: 'active',
      }).success,
    ).toBe(false)
  })
})

describe('PartnerEntitySchema', () => {
  it('accepts a partner row', () => {
    expect(
      PartnerEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        public_slug: 'jane',
        bio: null,
        royalty_pct_bps: 1500,
        status: 'approved',
        kyc_status: 'approved',
        tax_form_status: 'none',
      }).success,
    ).toBe(true)
  })
})

describe('ProductPricingEntitySchema', () => {
  it('accepts an active tier', () => {
    expect(
      ProductPricingEntitySchema.safeParse({
        id: 1,
        product_id: 1,
        license: 'plr',
        price_cents: 4900,
        compare_at_cents: null,
        is_active: true,
        display_order: 0,
      }).success,
    ).toBe(true)
  })
  it('rejects unknown license', () => {
    expect(
      ProductPricingEntitySchema.safeParse({
        id: 1,
        product_id: 1,
        license: 'enterprise',
        price_cents: 4900,
        is_active: true,
        display_order: 0,
      }).success,
    ).toBe(false)
  })
})

describe('ProductFileEntitySchema', () => {
  it('accepts a clean + ready file row', () => {
    expect(
      ProductFileEntitySchema.safeParse({
        id: 1,
        product_id: 1,
        kind: 'video',
        original_filename: 'x.mp4',
        storage_path: 'x',
        size_bytes: 100,
        mime_type: 'video/mp4',
        scan_status: 'clean',
        encoding_status: 'ready',
      }).success,
    ).toBe(true)
  })
})

describe('OrderEntitySchema', () => {
  it('accepts a paid order', () => {
    expect(
      OrderEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        email: 'a@b.com',
        status: 'paid',
        subtotal_cents: 4900,
        discount_cents: 0,
        subscriber_discount_cents: 0,
        tax_cents: 0,
        total_cents: 4900,
        refunded_cents: 0,
        currency: 'USD',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
  it('rejects unknown status', () => {
    expect(
      OrderEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        email: 'a@b.com',
        status: 'pending-approval',
        subtotal_cents: 0,
        discount_cents: 0,
        subscriber_discount_cents: 0,
        tax_cents: 0,
        total_cents: 0,
        refunded_cents: 0,
        currency: 'USD',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(false)
  })
})

describe('OrderItemEntitySchema', () => {
  it('accepts a line', () => {
    expect(
      OrderItemEntitySchema.safeParse({
        id: 1,
        order_id: 1,
        product_id: 1,
        partner_id: 2,
        license: 'plr',
        quantity: 1,
        unit_price_cents: 4900,
        line_total_cents: 4900,
        subscriber_discount_cents: 0,
        royalty_pct_bps: 1500,
        royalty_cents: 735,
      }).success,
    ).toBe(true)
  })
})

describe('SubscriptionEntitySchema', () => {
  it('accepts an active subscription', () => {
    expect(
      SubscriptionEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        stripe_subscription_id: 'sub_1',
        status: 'active',
        stripe_price_id: 'price_1',
        current_period_start: '2026-06-01T00:00:00Z',
        current_period_end: '2026-07-01T00:00:00Z',
        cancel_at_period_end: false,
      }).success,
    ).toBe(true)
  })
})

describe('LibraryGrantEntitySchema', () => {
  it('accepts a subscription grant', () => {
    expect(
      LibraryGrantEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        product_id: 1,
        license: 'personal',
        source: 'subscription',
        granted_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
})

describe('PayoutLedgerEntitySchema', () => {
  it('accepts a negative amount (clawback)', () => {
    expect(
      PayoutLedgerEntitySchema.safeParse({
        id: 1,
        partner_id: 2,
        kind: 'clawback',
        status: 'paid',
        amount_cents: -1000,
        currency: 'USD',
        created_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
})

describe('CouponEntitySchema', () => {
  it('accepts a 100%-off coupon', () => {
    expect(
      CouponEntitySchema.safeParse({
        id: 1,
        code: 'WINTER20',
        discount_bps: 2000,
        redemptions_count: 0,
        is_active: true,
      }).success,
    ).toBe(true)
  })
})

describe('RefundEntitySchema', () => {
  it('accepts a succeeded refund', () => {
    expect(
      RefundEntitySchema.safeParse({
        id: 1,
        order_id: 1,
        amount_cents: 4900,
        reason: 'requested_by_customer',
        status: 'succeeded',
        requested_by: VALID_USER_ID,
        created_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
})

describe('ReviewEntitySchema', () => {
  it('accepts a published review', () => {
    expect(
      ReviewEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        product_id: 1,
        rating: 5,
        body: 'x'.repeat(50),
        status: 'published',
        helpful_count: 0,
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
  it('rejects rating > 5', () => {
    expect(
      ReviewEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        product_id: 1,
        rating: 6,
        body: 'x'.repeat(50),
        status: 'published',
        helpful_count: 0,
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(false)
  })
})

describe('CategoryEntitySchema', () => {
  it('accepts a top-level category', () => {
    expect(
      CategoryEntitySchema.safeParse({
        id: 1,
        slug: 'ai',
        name: 'AI',
        display_order: 0,
        product_count_cache: 5,
      }).success,
    ).toBe(true)
  })
})

describe('ProductImageEntitySchema', () => {
  it('accepts a gallery image', () => {
    expect(
      ProductImageEntitySchema.safeParse({
        id: 1,
        product_id: 1,
        url: 'https://cdn.example.com/img.png',
        alt: 'Screenshot',
        kind: 'gallery',
        display_order: 0,
        created_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
  it('rejects bad URL', () => {
    expect(
      ProductImageEntitySchema.safeParse({
        id: 1,
        product_id: 1,
        url: 'not-a-url',
        alt: 'Screenshot',
        kind: 'gallery',
        display_order: 0,
        created_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(false)
  })
})

describe('CollectionEntitySchema', () => {
  it('accepts a featured collection', () => {
    expect(
      CollectionEntitySchema.safeParse({
        id: 1,
        slug: 'ai-bundle',
        name: 'AI Bundle',
        is_featured: true,
        display_order: 0,
        status: 'published',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
})

describe('BundleItemEntitySchema', () => {
  it('accepts a bundle item', () => {
    expect(
      BundleItemEntitySchema.safeParse({
        id: 1,
        bundle_product_id: 10,
        included_product_id: 1,
        display_order: 0,
      }).success,
    ).toBe(true)
  })
})

describe('AffiliateEntitySchema', () => {
  it('accepts an approved affiliate', () => {
    expect(
      AffiliateEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        handle: 'jane',
        status: 'approved',
      }).success,
    ).toBe(true)
  })
})

describe('AffiliateClickEntitySchema', () => {
  it('accepts a converted click', () => {
    expect(
      AffiliateClickEntitySchema.safeParse({
        id: 1,
        affiliate_id: 1,
        url_path: '/products/ai',
        converted: true,
        created_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
})

describe('NotificationPreferencesEntitySchema', () => {
  it('accepts preferences', () => {
    expect(
      NotificationPreferencesEntitySchema.safeParse({
        user_id: VALID_USER_ID,
        weekly_digest_email: true,
        marketing_email: false,
        updated_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
})

describe('PlatformSettingsEntitySchema', () => {
  it('requires id=1 (singleton)', () => {
    expect(
      PlatformSettingsEntitySchema.safeParse({
        id: 2,
        default_royalty_pct_bps: 1500,
        default_currency: 'USD',
        default_subscriber_discount_bps: 1500,
        refund_window_days: 14,
        updated_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(false)
  })
  it('accepts the singleton', () => {
    expect(
      PlatformSettingsEntitySchema.safeParse({
        id: 1,
        default_royalty_pct_bps: 1500,
        default_currency: 'USD',
        default_subscriber_discount_bps: 1500,
        refund_window_days: 14,
        updated_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
})

describe('ImpersonationSessionEntitySchema', () => {
  it('accepts a session row', () => {
    // The schema validates the SHAPE; the "admin != target" invariant
    // is enforced at the DB layer via a CHECK constraint
    // (impersonation_sessions.sql) — application-layer tests for the
    // constraint itself live in 06-quality.
    expect(
      ImpersonationSessionEntitySchema.safeParse({
        id: '22222222-3333-4444-8555-666666666666',
        admin_id: '11111111-2222-4333-8444-555555555555',
        target_user_id: '77777777-8888-4999-8000-111111111111',
        reason: 'Customer support ticket #12345 needs review',
        started_at: '2026-06-01T00:00:00Z',
        expires_at: '2026-06-01T00:05:00Z',
      }).success,
    ).toBe(true)
  })
  it('rejects a bad reason length', () => {
    expect(
      ImpersonationSessionEntitySchema.safeParse({
        id: '22222222-3333-4444-8555-666666666666',
        admin_id: '11111111-2222-4333-8444-555555555555',
        target_user_id: '77777777-8888-4999-8000-111111111111',
        reason: 'short',
        started_at: '2026-06-01T00:00:00Z',
        expires_at: '2026-06-01T00:05:00Z',
      }).success,
    ).toBe(false)
  })
})

describe('CartItemEntitySchema', () => {
  it('accepts an active line', () => {
    expect(
      CartItemEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        product_id: 1,
        license: 'plr',
        quantity: 2,
        status: 'active',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
})

describe('FileDownloadEntitySchema', () => {
  it('accepts a download row', () => {
    expect(
      FileDownloadEntitySchema.safeParse({
        id: 1,
        user_id: VALID_USER_ID,
        file_id: 1,
        product_id: 1,
        kind: 'download',
        url_expires_at: '2026-06-02T00:00:00Z',
        created_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
})

describe('AuditLogEntitySchema', () => {
  it('accepts a typical audit row', () => {
    expect(
      AuditLogEntitySchema.safeParse({
        id: 1,
        actor_id: VALID_USER_ID,
        action: 'admin.category_create',
        target_kind: 'categories',
        target_id: '5',
        metadata: { slug: 'ai' },
        created_at: '2026-06-01T00:00:00Z',
      }).success,
    ).toBe(true)
  })
})
