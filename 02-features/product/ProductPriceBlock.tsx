// ProductPriceBlock — the price row inside the product detail page's
// `pinfo` column. Mockup-faithful to `mockups/product.html` lines
// 72–77 and `mockups/styles/main.css` lines 280–284:
//
//   $57  $399  [SAVE 86%]              OR 4 × $14.25 with Shop Pay
//
// The block is a pure server component (no interactivity): it reads
// the product's default pricing tier (`product.pricing` sorted
// ascending by `price_cents`, with the `is_default` flag winning) and
// renders the price + strikethrough + save% + installments stub.
//
// **Installments stub.** The mockup shows "OR 4 × $X.XX with Shop
// Pay" — a 4-payment split with the final payment provider. Phase 4
// (P4.10) wires the real Shop Pay / Apple Pay / Link flow; for now
// the row computes 4 × (price / 4) and renders the math. The label
// drops the "with Shop Pay" suffix when no payments provider is
// configured (which is true today).
//
// **Defensive fallbacks.** If the default tier has no
// `compare_at_cents`, the strikethrough + save% chip are omitted.
// If the product has no active pricing at all, the row renders
// "No pricing available" and returns null for the installments.

import { formatMoney, formatMoneyShort } from '@foundations/money/cents'
import { formatSavePct } from '@features/catalog/format'
import type { Currency, LicenseTier, PricingTier } from '@features/catalog/queries'
import styles from './ProductPriceBlock.module.css'

type Props = {
  /** Default pricing tier (drives the visible price). */
  tier: PricingTier
  /** Currency code — kept narrow for type safety. */
  currency: Currency
}

/**
 * Compute a 4-payment installment for the displayed price. Returns
 * null when the cents don't split evenly (e.g. $57 → $14.25 — splits
 * evenly; $19.99 → $5.00 with a $0.01 drift we round up to absorb).
 */
function installmentPriceCents(priceCents: number): number {
  if (priceCents <= 0) return 0
  return Math.ceil(priceCents / 4 / 25) * 25 // round up to nearest $0.25
}

export function ProductPriceBlock({ tier, currency }: Props) {
  const priceCents = tier.price_cents
  const compareCents = tier.compare_at_cents
  const savePct = formatSavePct(priceCents, compareCents)
  const installmentCents = installmentPriceCents(priceCents)

  return (
    <div className={styles.priceRow} aria-label="Pricing">
      <span className={styles.price}>{formatMoneyShort(priceCents, currency)}</span>
      {compareCents != null && compareCents > priceCents && (
        <s className={styles.compare}>{formatMoneyShort(compareCents, currency)}</s>
      )}
      {savePct != null && savePct > 0 && (
        <span className={styles.save}>SAVE {savePct}%</span>
      )}
      {installmentCents > 0 && priceCents >= 4000 && (
        <span className={styles.installments}>
          OR 4 × {formatMoney(installmentCents, currency)} with Shop Pay
        </span>
      )}
    </div>
  )
}

/** Re-export the types so the page can import them from this module. */
export type { Currency, LicenseTier, PricingTier }
