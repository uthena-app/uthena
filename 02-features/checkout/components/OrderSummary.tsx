// OrderSummary.tsx — read-only summary used on the success page.
// Mirrors the /cart summary panel but is purely informational.

import { formatMoney } from '@foundations/money/cents'
import { LICENSE_SHORT, formatOrderDate } from '@features/checkout/format'
import styles from './OrderSummary.module.css'

type Item = {
  id: number
  product_id: number
  license: 'plr' | 'mrr' | 'rr' | 'personal'
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  title: string
  thumbnail_url: string | null
  slug: string
}

export function OrderSummary({
  order,
}: {
  order: {
    id: number
    subtotal_cents: number
    discount_cents: number
    tax_cents: number
    total_cents: number
    currency: string
    created_at: string
    items: Item[]
  }
}) {
  return (
    <section className={styles.wrap} aria-label="Order summary">
      <header className={styles.header}>
        <h2 className={styles.h2}>Order #{order.id}</h2>
        <p className={styles.date}>{formatOrderDate(order.created_at)}</p>
      </header>
      <ul className={styles.items}>
        {order.items.map((it) => (
          <li key={it.id} className={styles.item}>
            {it.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.thumbnail_url} alt="" className={styles.thumb} />
            ) : (
              <div className={styles.thumbPlaceholder} aria-hidden />
            )}
            <div className={styles.body}>
              <p className={styles.title}>{it.title}</p>
              <p className={styles.meta}>
                {LICENSE_SHORT[it.license] ?? it.license} · Qty {it.quantity}
              </p>
            </div>
            <p className={styles.price}>{formatMoney(it.line_total_cents, 'USD')}</p>
          </li>
        ))}
      </ul>
      <dl className={styles.totals}>
        <div className={styles.totalRow}>
          <dt>Subtotal</dt>
          <dd>{formatMoney(order.subtotal_cents, 'USD')}</dd>
        </div>
        {order.discount_cents > 0 && (
          <div className={styles.totalRow}>
            <dt>Discount</dt>
            <dd>−{formatMoney(order.discount_cents, 'USD')}</dd>
          </div>
        )}
        {order.tax_cents > 0 && (
          <div className={styles.totalRow}>
            <dt>Tax</dt>
            <dd>{formatMoney(order.tax_cents, 'USD')}</dd>
          </div>
        )}
        <div className={`${styles.totalRow} ${styles.totalGrand}`}>
          <dt>Total</dt>
          <dd>{formatMoney(order.total_cents, 'USD')}</dd>
        </div>
      </dl>
    </section>
  )
}
