// createCheckoutSession.ts — server action invoked from /checkout.
// Builds a Stripe Checkout session in "one-time payment" mode using
// the user's active cart, then returns the session URL for redirect.
//
// Money model:
//   - Subtotal = sum of (unit_price * quantity) across active cart lines
//   - Subscriber discount = per-line, PLR-only, opt-out via
//     product_pricing.subscriber_discount_bps. Single source of truth:
//     `calculateCartSubscriberDiscount` in @features/subscriptions.
//   - Discount = coupon if applied (validated again here; the cart's
//     coupon_id is a hint, not the source of truth)
//   - Tax (STUB-006 fix): the Stripe session is created with
//     `automatic_tax: { enabled: true }` + `billing_address_collection:
//     'required'` (Stripe Tax needs a billing location to calculate
//     against — digital goods have no shipping address to fall back
//     on). Stripe computes the authoritative tax AFTER the buyer enters
//     their billing address on the hosted page, so it is NOT known at
//     session-create time. The `orders.tax_cents` value written here is
//     a same-as-before 0 placeholder (never shown as final — the
//     success page and confirmation email read the order row AFTER the
//     webhook updates it); `onPaymentSucceeded` (via the
//     `mark_order_paid_and_grant` RPC) overwrites `tax_cents` +
//     `total_cents` with the authoritative
//     `session.total_details.amount_tax` once `checkout.session.completed`
//     fires, so paid orders always reflect Stripe's real calculation.
//     ponytail: Stripe Tax must be enabled + a tax registration added
//     in the Stripe Dashboard (Settings → Tax) before `automatic_tax`
//     will actually compute non-zero tax — until that dashboard step is
//     done, Stripe returns `amount_tax: 0` for every session, which is
//     functionally identical to the old hardcoded-0 behavior but now
//     driven by Stripe's own (not-yet-configured) calculation instead
//     of a client-side constant.
//   - Total = subtotal - subscriber_discount - coupon_discount + tax
//
// Royalty snapshot for each order_item is computed against the product's
// `partner.royalty_pct_bps` (or the global default from
// `platform_settings.default_royalty_pct_bps`). Snapshot is stored on
// the order_items row at session-create time, so future royalty % changes
// don't rewrite history.
//
// Stripe Checkout config (P4.10):
//   - `payment_method_types` is intentionally not set; the Stripe
//     Dashboard's "Payment methods" config is the source of truth so ops
//     can enable Card / Apple Pay / Google Pay / Link without code
//     changes. Hard-coding `['card']` would block Apple Pay on
//     Safari/iOS even when the Dashboard has it enabled.
//   - `customer` is passed when we have a prior `stripe_customer_id` for
//     this user so Stripe Checkout surfaces saved cards (P4.10 "saved
//     methods for returning buyers"). `customer_email` is the first-time
//     fallback; Stripe creates a Customer on payment success and
//     `onPaymentSucceeded` writes the ID back to `orders`, so subsequent
//     checkouts attach via `customer`.
//
// Auth-only. The action is callable only from a logged-in session.

'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { getServerSupabase, getServiceSupabase } from '@foundations/data/supabase'
import { getSessionUser } from '@foundations/auth/guards'
import {
  isStripeConfigured,
  getStripe,
  withStripeErrorHandling,
  idempotencyKey,
} from '@foundations/money/stripe'
import {
  addMoney,
  applyDiscountBps,
  calculateRoyalty,
  multiplyCents,
  subtractMoney,
} from '@foundations/money/cents'
import { getEnv } from '@foundations/env'
import {
  calculateCartSubscriberDiscount,
  getSubscriberDiscountContext,
} from '@features/subscriptions'
import { loggerFor } from '@foundations/log/pino'

const log = loggerFor({ component: 'checkout.createCheckoutSession' })

const CreateSessionSchema = z.object({
  affiliate_handle: z.string().min(1).max(80).optional(),
})

export type CreateCheckoutResult =
  | { ok: true; url: string; session_id: string; order_id: number }
  | { ok: false; error: string; code?: 'not_authed' | 'empty_cart' | 'stripe_unconfigured' | 'price_changed' | 'unknown' }

// STUB-006: this is the order-row PLACEHOLDER written before Stripe
// has calculated real tax (Stripe Tax needs the buyer's billing
// address, which is only known once they reach the hosted Checkout
// page — see the `automatic_tax` session param below). It is NOT the
// final tax charged. `onPaymentSucceeded` overwrites `orders.tax_cents`
// with the authoritative `session.total_details.amount_tax` once
// `checkout.session.completed` fires.
const DEFAULT_TAX_BPS = 0

export async function createCheckoutSessionAction(
  raw: FormData | Record<string, unknown> = {},
): Promise<CreateCheckoutResult> {
  const obj = raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw
  const parsed = CreateSessionSchema.safeParse({ affiliate_handle: obj.affiliate_handle })
  if (!parsed.success) return { ok: false, error: 'Invalid request.', code: 'unknown' }

  // 1. Auth.
  const user = await getSessionUser()
  if (!user) return { ok: false, error: 'Sign in to check out.', code: 'not_authed' }

  // 2. Stripe configured?
  if (!isStripeConfigured()) {
    return {
      ok: false,
      error:
        'Payments are temporarily disabled. Add STRIPE_SECRET_KEY to enable checkout (see STUB-002).',
      code: 'stripe_unconfigured',
    }
  }

  const env = getEnv()
  const supabase = await getServerSupabase()

  // 3. Load cart with live pricing.
  const { data: cartRows, error: cartErr } = await supabase
    .from('cart_items')
    .select(
      `
      id, product_id, license, quantity, status, coupon_id,
      product:products!inner (
        id, slug, title, status, partner_id,
        partner:partners ( royalty_pct_bps ),
        pricing:product_pricing ( license, price_cents, is_active, subscriber_discount_bps )
      )
    `,
    )
    .eq('user_id', user.id)
    .eq('status', 'active')
    .eq('product.status', 'published')
  if (cartErr) {
    log.warn({ code: 'load_cart_failed', msg: cartErr.message }, 'load cart failed')
    return { ok: false, error: 'Could not load cart.', code: 'unknown' }
  }
  if (!cartRows || cartRows.length === 0) {
    return { ok: false, error: 'Your cart is empty.', code: 'empty_cart' }
  }

  // 4. Build a CartLine-shaped intermediate so the shared helper can
  //    compute the subscriber discount for us. The action then layers
  //    royalty + coupon on top.
  type ActionLine = {
    cart_item_id: number
    product_id: number
    partner_id: number
    license: 'plr' | 'mrr' | 'rr' | 'personal'
    quantity: number
    unit_price_cents: number
    royalty_pct_bps: number
    product_title: string
    product_slug: string
    subscriber_discount_bps: number | null
  }
  type LineItem = ActionLine & {
    /** Per-unit price AFTER the subscriber discount (if any). */
    unit_price_after_discount_cents: number
    line_total_cents: number
    subscriber_discount_cents: number
    royalty_cents: number
  }
  const draftLines: ActionLine[] = []
  const lineItems: LineItem[] = []
  // Bigint throughout — converted to number only at the DB write boundary.
  // Uthena's lifetime catalog will not exceed the safe-integer range, but
  // bigint-native math means we never have to think about it.
  let grossSubtotalCents: bigint = 0n

  // Default royalty (fallback) lives in env.
  const defaultRoyaltyBps = env.DEFAULT_ROYALTY_PCT_BPS

  // Subscriber discount — single hot-path read. See
  // 02-features/subscriptions/README.md "Discount engine — load profile".
  const discountCtx = await getSubscriberDiscountContext(user.id)

  for (const row of cartRows) {
    const product = (row as any).product
    if (!product) continue
    const tier = (product.pricing ?? []).find(
      (p: any) => p.license === row.license && p.is_active,
    )
    if (!tier) {
      return {
        ok: false,
        error: `Pricing for ${product.title} is no longer available. Remove it from your cart and try again.`,
        code: 'price_changed',
      }
    }
    const partnerRoyalty = product.partner?.royalty_pct_bps ?? null
    const royaltyBps =
      typeof partnerRoyalty === 'number' && partnerRoyalty > 0 ? partnerRoyalty : defaultRoyaltyBps
    draftLines.push({
      cart_item_id: row.id,
      product_id: product.id,
      partner_id: product.partner_id,
      license: row.license,
      quantity: row.quantity,
      unit_price_cents: tier.price_cents,
      royalty_pct_bps: royaltyBps,
      product_title: product.title,
      product_slug: product.slug,
      subscriber_discount_bps:
        typeof tier.subscriber_discount_bps === 'number' ? tier.subscriber_discount_bps : null,
    })
  }

  // P5.9 — Single source of truth for subscriber-discount math.
  // The same helper powers the ReviewStep totals row, so the UI
  // cannot disagree with what we charge here.
  const subscriberDiscountResult = calculateCartSubscriberDiscount(
    draftLines.map((dl) => ({
      id: dl.cart_item_id,
      product_id: dl.product_id,
      slug: dl.product_slug,
      title: dl.product_title,
      thumbnail_url: null,
      category_slug: null,
      category_name: null,
      license: dl.license,
      quantity: dl.quantity,
      unit_price_cents: dl.unit_price_cents,
      line_total_cents: dl.unit_price_cents * dl.quantity,
      compare_at_cents: null,
      subscriber_discount_bps: dl.subscriber_discount_bps,
      added_at: '',
    })),
    discountCtx,
  )
  const subscriberDiscountByLineId = new Map(
    subscriberDiscountResult.lines.map((d) => [d.line_id, d]),
  )
  const subscriberDiscountCents = subscriberDiscountResult.total_cents

  for (const dl of draftLines) {
    const d = subscriberDiscountByLineId.get(dl.cart_item_id)
    const lineSubscriberDiscount = d?.discount_cents ?? 0n
    const unitAfter = subtractMoney(dl.unit_price_cents, lineSubscriberDiscount / BigInt(dl.quantity || 1))
    const lineTotal = multiplyCents(unitAfter, dl.quantity)
    // Royalty is on the post-discount line total (so the partner doesn't
    // get credit on the discounted portion). Floor — never over-pay a partner.
    const royalty = calculateRoyalty(lineTotal, dl.royalty_pct_bps)
    grossSubtotalCents = addMoney(grossSubtotalCents, multiplyCents(dl.unit_price_cents, dl.quantity))
    lineItems.push({
      ...dl,
      unit_price_after_discount_cents: Number(unitAfter),
      line_total_cents: Number(lineTotal),
      subscriber_discount_cents: Number(lineSubscriberDiscount),
      royalty_cents: Number(royalty),
    })
  }

  // 5. Discount — recompute from coupon_id if present.
  let discountCents: bigint = 0n
  let couponId: number | null = null
  const firstCouponId = (cartRows.find((r) => (r as any).coupon_id) as any)?.coupon_id ?? null
  if (firstCouponId) {
    const { data: coupon } = await supabase
      .from('coupons')
      .select('id, discount_bps, starts_at, ends_at, max_redemptions, redemptions_count, is_active')
      .eq('id', firstCouponId)
      .eq('is_active', true)
      .maybeSingle()
    if (coupon) {
      const now = Date.now()
      const validFrom = coupon.starts_at ? new Date(coupon.starts_at).getTime() : 0
      const validUntil = coupon.ends_at ? new Date(coupon.ends_at).getTime() : Infinity
      const remaining = coupon.max_redemptions
        ? coupon.max_redemptions - coupon.redemptions_count
        : Infinity
      if (now >= validFrom && now <= validUntil && remaining > 0) {
        couponId = coupon.id
        // discount_bps is always basis points; percent and fixed are
        // represented as bps and a separate "is_fixed" flag (or by
        // convention: bps <= 10000 is percent; bps > 10000 is fixed
        // cents). v1 stores bps only — we always treat as percent.
        discountCents = applyDiscountBps(grossSubtotalCents, coupon.discount_bps)
      }
    }
  }
  // Spec OQ: subscriber and coupon do NOT stack — the larger wins.
  // We compute the post-subscriber base and then either the coupon
  // (if larger) or zero (if subscriber is larger).
  const postSubscriberBase = subtractMoney(grossSubtotalCents, subscriberDiscountCents)
  if (discountCents > 0n) {
    if (subscriberDiscountCents >= discountCents) {
      discountCents = 0n
    } else {
      // Reduce the coupon discount by the amount the subscriber discount
      // already took off, so the total discount doesn't exceed gross.
      discountCents = subtractMoney(discountCents, subscriberDiscountCents)
    }
  }
  const postDiscountBase = subtractMoney(postSubscriberBase, discountCents)
  const taxCents = calculateRoyalty(postDiscountBase, DEFAULT_TAX_BPS)
  const totalCents = addMoney(postDiscountBase, taxCents)

  // 6. Affiliate attribution (optional).
  let affiliateId: number | null = null
  let affiliateHandle: string | null = null
  if (parsed.data.affiliate_handle) {
    const { data: aff } = await supabase
      .from('affiliates')
      .select('id, handle')
      .eq('handle', parsed.data.affiliate_handle)
      .eq('status', 'approved')
      .maybeSingle()
    if (aff) {
      affiliateId = aff.id
      affiliateHandle = aff.handle
    }
  }

  // 6a. P4.10 — Saved payment methods for returning buyers.
  //     Look up the user's most-recent paid order's `stripe_customer_id`
  //     so we can pass `customer` to the Stripe session — Stripe Checkout
  //     will then surface the buyer's saved cards. First-time buyers
  //     fall back to `customer_email`, which creates a Customer on
  //     payment success (the same row gets `stripe_customer_id` written
  //     by `onPaymentSucceeded`, so the NEXT checkout has a customer to
  //     attach to). Fail-soft: a missing customer row should never block
  //     a first-time buyer.
  const { data: priorOrder } = await supabase
    .from('orders')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .not('stripe_customer_id', 'is', null)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const stripeCustomerId: string | null = priorOrder?.stripe_customer_id ?? null

  // 7. Create the order row in `pending` state via service role (bypasses RLS).
  //    The webhook later flips it to `paid` and writes library_grants.
  const service = getServiceSupabase()
  const origin = (await headers()).get('origin') ?? env.NEXT_PUBLIC_APP_URL
  const successUrl = `${origin}/checkout/success?order={ORDER_ID}`
  const cancelUrl = `${origin}/checkout/canceled`

  const { data: order, error: orderErr } = await service
    .from('orders')
    .insert({
      user_id: user.id,
      email: user.email ?? '',
      status: 'awaiting_payment',
      subtotal_cents: Number(grossSubtotalCents),
      discount_cents: Number(discountCents),
      subscriber_discount_cents: Number(subscriberDiscountCents),
      tax_cents: Number(taxCents),
      total_cents: Number(totalCents),
      currency: 'USD',
      affiliate_id: affiliateId,
      affiliate_handle: affiliateHandle,
      coupon_id: couponId,
      metadata: { source: 'web', is_subscriber: discountCtx.isActive },
    })
    .select('id')
    .single()
  if (orderErr || !order) {
    log.error({ code: 'order_create_failed', msg: orderErr?.message }, 'order create failed')
    return { ok: false, error: 'Could not start checkout.', code: 'unknown' }
  }

  // 8. Insert order_items in the same transaction (we don't have a
  //    single-statement upsert for parent+children here, but the
  //    webhook verifies the totals anyway, so a partial write is OK
  //    for v1 — orphan order_items are cleaned by the webhook
  //    failure path).
  const { error: itemsErr } = await service.from('order_items').insert(
    lineItems.map((li) => ({
      order_id: order.id,
      product_id: li.product_id,
      partner_id: li.partner_id,
      license: li.license,
      quantity: li.quantity,
      unit_price_cents: li.unit_price_after_discount_cents,
      line_total_cents: li.line_total_cents,
      subscriber_discount_cents: li.subscriber_discount_cents,
      royalty_pct_bps: li.royalty_pct_bps,
      royalty_cents: li.royalty_cents,
    })),
  )
  if (itemsErr) {
    log.error({ code: 'order_items_create_failed', msg: itemsErr.message }, 'order items create failed')
    // Best-effort cleanup of the orphan order; the webhook will see
    // a payment for an order it doesn't recognize and ignore.
    await service.from('orders').delete().eq('id', order.id)
    return { ok: false, error: 'Could not start checkout.', code: 'unknown' }
  }

  // 9. Build the Stripe session.
  const stripe = getStripe()
  // v1: discount is baked into unit_amount for each line. PH18 will
  // switch to a real Stripe coupon when the discount engine moves server-side.
  // Build params conditionally so we don't pass `discounts: undefined`
  // (which exactOptionalPropertyTypes rejects).
  //
  // P4.10 — Payment method picker:
  //   - `payment_method_types` is intentionally NOT set. Stripe Checkout
  //     defaults to the Dashboard's "Payment methods" config, which
  //     lets ops enable Card / Apple Pay / Google Pay / Link from the
  //     Dashboard without code changes. Hard-coding `['card']` would
  //     block Apple Pay on Safari/iOS even when it's enabled in the
  //     Dashboard.
  //   - `customer` is passed when we have a prior `stripe_customer_id`
  //     for this user; Stripe Checkout then surfaces the buyer's saved
  //     cards on the hosted page (P4.10 "saved methods for returning
  //     buyers"). `customer_email` remains the fallback for first-time
  //     buyers — Stripe creates a new Customer on payment success and
  //     `onPaymentSucceeded` writes the ID back to `orders`, so the next
  //     checkout attaches via `customer`.
  const sessionParams: import('stripe').Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    // STUB-006 — Stripe Tax. `automatic_tax.enabled` turns on Stripe's
    // tax calculation for this session; `billing_address_collection:
    // 'required'` forces the buyer to enter a billing address on the
    // hosted page, which is the location Stripe Tax calculates
    // against (there's no shipping address for digital goods to fall
    // back on). Requires Stripe Tax to be enabled + a tax registration
    // configured in the Stripe Dashboard (Settings → Tax) — see the
    // `ponytail:` note above. Without that dashboard step, Stripe
    // still accepts these params but returns `amount_tax: 0`.
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    line_items: lineItems.map((li) => ({
      quantity: li.quantity,
      price_data: {
        currency: 'usd',
        product_data: {
          name: li.product_title,
          description: `${li.license.toUpperCase()} license${
            li.subscriber_discount_cents > 0 ? ' (subscriber 15% off)' : ''
          }`,
          metadata: {
            product_id: String(li.product_id),
            slug: li.product_slug,
            subscriber_discount_cents: String(li.subscriber_discount_cents),
          },
        },
        // Use the post-discount unit amount so Stripe charges the
        // correct total. Royalty is computed on the post-discount line
        // so the partner doesn't get credit on the discounted portion.
        unit_amount: li.unit_price_after_discount_cents,
      },
    })),
    success_url: successUrl.replace('{ORDER_ID}', String(order.id)),
    cancel_url: cancelUrl,
    metadata: {
      order_id: String(order.id),
      user_id: user.id,
    },
    payment_intent_data: {
      metadata: {
        order_id: String(order.id),
        user_id: user.id,
      },
    },
  }
  if (stripeCustomerId) {
    sessionParams.customer = stripeCustomerId
  } else if (user.email) {
    sessionParams.customer_email = user.email
  }

  // Idempotency: keyed on order.id so a retry of THIS specific create-
  // checkout call returns Stripe's cached response. Each order is its own
  // attempt — this does NOT collapse distinct user attempts.
  const idempotencyKeyValue = idempotencyKey('checkout_session', order.id)

  const sessionResult = await withStripeErrorHandling(
    () => stripe.checkout.sessions.create(sessionParams, { idempotencyKey: idempotencyKeyValue }),
    { surface: 'checkout.createCheckoutSession' },
  )
  if (!sessionResult.ok) {
    return { ok: false, error: sessionResult.message, code: 'unknown' }
  }
  const session = sessionResult.data

  // 10. Persist the session ID on the order (best-effort; the webhook
  //     also updates this from the event).
  await service
    .from('orders')
    .update({ stripe_checkout_session_id: session.id })
    .eq('id', order.id)

  log.info(
    {
      user_id: user.id,
      order_id: order.id,
      session_id: session.id,
      gross_subtotal_cents: grossSubtotalCents,
      subscriber_discount_cents: subscriberDiscountCents,
      coupon_discount_cents: discountCents,
      total_cents: totalCents,
      is_subscriber: discountCtx.isActive,
      // P4.10 — track whether we attached to a prior customer (returning
      // buyer) or sent `customer_email` (first-time buyer). Never log
      // the customer ID itself; the presence/absence is enough to debug.
      attached_to_prior_customer: Boolean(stripeCustomerId),
    },
    'checkout session created',
  )

  if (!session.url) {
    return { ok: false, error: 'Stripe did not return a redirect URL.', code: 'unknown' }
  }
  return { ok: true, url: session.url, session_id: session.id, order_id: order.id }
}
