// CartLineRow.tsx — one row in /cart. Server component shell with
// two client forms inside (license select, remove).
// Renders thumbnail, title, license selector, unit price, line
// total, remove button.
//
// P4.2 — `line.id` is `number | string` (DB bigint or anon-cookie
// synthesized id). React keys must be strings; we stringify in the
// /cart page.
//
// P4.4 — **No quantity column.** Per the spec ("No quantity
// selector; PLR is per-license, quantity is always 1") the row
// shows the unit price and line total only. The `quantity` field
// stays in `CartLine` (the schema supports 1-99 and the
// `updateQuantityAction` server action exists for future bundle-
// seats work) but is not surfaced in v1's UI. The "× N" suffix on
// the unit price also stays hidden for the same reason.

import Link from 'next/link'
import { formatMoney } from '@foundations/money/cents'
import {
  LICENSE_LABELS,
  LICENSE_DESCRIPTIONS,
} from '@features/cart/format'
import { CartLineControls } from './CartLineControls'
import styles from './CartLineRow.module.css'

export type CartLineRowProps = {
  line: {
    id: number | string
    product_id: number
    slug: string
    title: string
    thumbnail_url: string | null
    category_name: string | null
    license: 'plr' | 'mrr' | 'rr' | 'personal'
    quantity: number
    unit_price_cents: number
    line_total_cents: number
    compare_at_cents: number | null
  }
  /** Active licenses available for this product (from product_pricing). */
  availableLicenses: Array<'plr' | 'mrr' | 'rr' | 'personal'>
}

export function CartLineRow({ line, availableLicenses }: CartLineRowProps) {
  return (
    <li className={styles.row}>
      <Link href={`/products/${line.slug}`} className={styles.thumbLink} aria-label={line.title}>
        {line.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={line.thumbnail_url} alt="" className={styles.thumb} />
        ) : (
          <div className={styles.thumbPlaceholder} aria-hidden />
        )}
      </Link>
      <div className={styles.body}>
        {line.category_name && <p className={styles.eyebrow}>{line.category_name}</p>}
        <Link href={`/products/${line.slug}`} className={styles.title}>
          {line.title}
        </Link>
        <p className={styles.licenseDesc}>
          {LICENSE_LABELS[line.license] ?? line.license} — {LICENSE_DESCRIPTIONS[line.license] ?? ''}
        </p>
        <CartLineControls
          cartItemId={line.id}
          currentLicense={line.license}
          availableLicenses={availableLicenses}
        />
      </div>
      <div className={styles.priceCol}>
        <p className={styles.unit}>
          {formatMoney(line.unit_price_cents, 'USD')}
          {line.quantity > 1 && <span className={styles.unitEach}> each</span>}
        </p>
        {line.compare_at_cents && line.compare_at_cents > line.unit_price_cents && (
          <p className={styles.compare}>{formatMoney(line.compare_at_cents, 'USD')}</p>
        )}
        <p className={styles.lineTotal}>{formatMoney(line.line_total_cents, 'USD')}</p>
      </div>
    </li>
  )
}
