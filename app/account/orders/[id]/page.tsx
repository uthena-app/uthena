// /account/orders/[id] — RSC. Single order detail.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireUser } from '@foundations/auth/guards'
import { getMyOrderDetail } from '@features/account/profile/queries/getMyOrderDetail'
import { getHostedInvoiceForOrder } from '@features/account/profile/queries/getHostedInvoiceForOrder'
import { OrderDetail } from '@features/account/profile/components/OrderDetail'
import { sensitivePageMetadata } from '@foundations/metadata'

// P0.21 — `noindex` so order detail isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Order',
  description: 'Order detail on Uthena.',
  path: '/account/orders/[id]',
})

type Props = { params: Promise<{ id: string }> }

export default async function AccountOrderDetailPage({ params }: Props) {
  await requireUser('/account/orders')
  const { id } = await params
  const orderId = parseInt(id, 10)
  if (!Number.isFinite(orderId) || orderId <= 0) {
    notFound()
  }
  const order = await getMyOrderDetail(orderId)
  if (!order) {
    notFound()
  }
  // Stripe hosted-invoice lookup. Fail-soft — null when Stripe is
  // unconfigured, the order has no payment_intent yet, or the lookup
  // fails. The OrderDetail component renders the "Download invoice"
  // CTA only when this resolves to a value.
  const hostedInvoice = await getHostedInvoiceForOrder(orderId)
  return <OrderDetail order={order} hostedInvoice={hostedInvoice} />
}