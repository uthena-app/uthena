// /account/orders — RSC. List of the user's orders with filters.
import type { Metadata } from 'next'
import { requireUser } from '@foundations/auth/guards'
import { getMyOrders, type OrderStatus } from '@features/account/profile/queries/getMyOrders'
import { OrdersList } from '@features/account/profile/components/OrdersList'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './orders.module.css'

// P0.21 — `noindex` so the orders list isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Orders',
  description: 'Your Uthena order history.',
  path: '/account/orders',
})

type Props = {
  searchParams: Promise<{
    status?: string | string[]
    from?: string
    to?: string
    page?: string
    pageSize?: string
  }>
}

const VALID_STATUSES: OrderStatus[] = [
  'paid',
  'pending',
  'awaiting_payment',
  'fulfilled',
  'refunded',
  'partially_refunded',
  'failed',
  'canceled',
  'fraudulent',
]

export default async function AccountOrdersPage({ searchParams }: Props) {
  await requireUser('/account/orders')
  const sp = await searchParams

  const statusParam = sp.status
    ? Array.isArray(sp.status)
      ? sp.status
      : sp.status.split(',')
    : []
  const selectedStatuses = statusParam.filter((s): s is OrderStatus =>
    (VALID_STATUSES as string[]).includes(s),
  )

  const from = sp.from ?? ''
  const to = sp.to ?? ''
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.pageSize ?? '20', 10) || 20))

  const result = await getMyOrders({ status: selectedStatuses, from, to, page, pageSize })

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Orders</h1>
        <p className={styles.lede}>Your purchase history. Newest first.</p>
      </header>
      <OrdersList
        result={result}
        selectedStatuses={selectedStatuses}
        from={from}
        to={to}
      />
    </div>
  )
}
