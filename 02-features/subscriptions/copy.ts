// Pricing-page copy — static (non-data) sections of `/pricing` live here.
//
// Phase 17 / P14.12 swap these for admin-editable content. Until then,
// this file is the single source of truth for the pricing-page FAQ and
// "what's included" list. Mirrors the home page's `copy.ts` pattern.

export type PricingFeature = {
  /** Short headline (3-6 words). */
  title: string
  /** One-sentence body explaining the benefit. */
  body: string
}

/**
 * Benefits listed under the "What's included" heading on `/pricing`.
 * Order = display order (most-attention-grabbing first).
 *
 * Mirrors the bullet list in the existing `StartSubscriptionCard`
 * (`02-features/subscriptions/components/StartSubscriptionCard.tsx`) —
 * the pricing page reuses that card as its centerpiece, so the
 * expanded list here is the longer-form version of the card's bullets.
 */
export const PRICING_FEATURES: readonly PricingFeature[] = [
  {
    title: '15% off every PLR order',
    body: 'Save 15% on every PLR-tier one-time course you buy. The discount applies automatically at checkout when your subscription is active.',
  },
  {
    title: 'Works across the full catalog',
    body: 'Every product in the catalog is eligible. No opt-in per product, no minimum order size, no partner opt-outs.',
  },
  {
    title: 'Stacks with partner attribution',
    body: "If you came in through a partner's affiliate link, their attribution still applies. Coupons are mutually exclusive with the subscriber discount — one or the other, not both.",
  },
  {
    title: 'Cancel anytime',
    body: "Cancel from /account/subscriptions in two clicks. Your access continues until the end of the period you've already paid for.",
  },
  {
    title: 'Secure Stripe billing',
    body: 'Payment via Stripe Checkout. Card, Apple Pay, Google Pay, Link. We never see your card number.',
  },
  {
    title: 'Future subscriber-only content',
    body: "As partners flag courses as subscriber-only (P8.3), you'll see them in /library under your Personal Access rail without a separate purchase.",
  },
]

export type FaqItem = {
  q: string
  a: string
}

/**
 * FAQ for `/pricing`. Six questions covering the most common pre-purchase
 * concerns. The answers are short (1-3 sentences) and link-friendly where
 * appropriate (refund → /refund-policy, cancel → /account/subscriptions).
 */
export const PRICING_FAQ: readonly FaqItem[] = [
  {
    q: 'What is Personal Access?',
    a: "Personal Access is Uthena's monthly subscription tier. For $19/month you get an automatic 15% discount on every PLR-tier one-time order, applied at checkout. The subscription itself doesn't grant library access in v1 — that ships in P8.1.",
  },
  {
    q: 'How is this different from a one-time PLR purchase?',
    a: 'A one-time PLR purchase gives you a single course you can resell forever. Personal Access gives you a recurring discount on every PLR purchase — including every future course added to the catalog. Subscribe if you plan to buy more than ~$130 worth of PLR per month.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel from /account/subscriptions in two clicks. Your subscription stays active until the end of the period you already paid for. After that, no more charges — and no more discount. Your previous purchases stay in your library.',
  },
  {
    q: 'What happens to courses I bought while subscribed?',
    a: 'Nothing changes. Courses you bought are yours forever under their license terms, whether or not your subscription is active. Canceling only stops future discounts — it does not revoke what you already own.',
  },
  {
    q: 'Do you offer a free trial?',
    a: 'Not at the moment. The v1 plan is a paid monthly subscription with no trial. Stripe supports trials on the underlying subscription, so a future promo can offer 7-day trials without code changes.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'Anything Stripe Checkout supports — Card, Apple Pay, Google Pay, Link. Payment methods are configured in the Stripe Dashboard; the Uthena site does not gate which methods are offered.',
  },
  {
    q: 'How do refunds work?',
    a: 'Subscriptions are not refundable mid-period (you keep access until the period ends). For one-time course purchases, the standard 14-day refund policy applies — see /refund-policy for details.',
  },
  {
    q: 'Will Personal Access ever include library streaming?',
    a: "Yes. P8.1 wires subscription access into the /library so subscribers stream every course without buying it. The discount is the v1 benefit; full library streaming is the next phase.",
  },
]