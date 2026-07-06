// /account/orders/[id]/refund — RSC. Eligibility check + form.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireUser } from '@foundations/auth/guards'
import { getOrderForRefund } from '@features/account/profile/queries/getOrderForRefund'
import { RefundForm } from '@features/account/profile/components/RefundForm'
import { sensitivePageMetadata } from '@foundations/metadata'

// P0.21 — `noindex` so the refund-form surface isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Request refund',
  description: 'Request a refund on an Uthena order.',
  path: '/account/orders/[id]/refund',
})

type Props = { params: Promise<{ id: string }> }

export default async function AccountRefundPage({ params }: Props) {
  await requireUser('/account/orders')
  const { id } = await params
  const orderId = parseInt(id, 10)
  if (!Number.isFinite(orderId) || orderId <= 0) notFound()

  const eligibility = await getOrderForRefund(orderId)
  if (!eligibility) notFound()

  return <RefundForm eligibility={eligibility} />
}
