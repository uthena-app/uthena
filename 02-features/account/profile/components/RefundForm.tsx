'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@foundations/ui/primitives/Button'
import { createRefundRequestAction } from '../actions/createRefundRequest'
import type { RefundEligibility } from '../queries/getOrderForRefund'
import {
  RefundProofUploader,
  type RefundProofUploadResult,
} from './RefundProofUploader'
import styles from './RefundForm.module.css'

const REASON_LABELS: Record<string, string> = {
  duplicate: 'Duplicate purchase',
  fraudulent: 'Fraudulent / unauthorized',
  requested_by_customer: "Changed my mind / don't need it",
  product_not_received: 'Product not received',
  product_unacceptable: 'Quality issues',
  other: 'Other',
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

/** UUID v4 generator that works without depending on
 *  `crypto.randomUUID` (which is available in modern browsers but
 *  absent in older Safari). We use it ONLY for the
 *  `client_request_id` idempotency key — the value doesn't need to
 *  be a true v4, it just needs to be unique enough that two
 *  separate submissions in the same browser session don't collide.
 *  `crypto.randomUUID` is preferred when available; the fallback
 *  uses `getRandomValues` (also widely available). */
function generateClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    // RFC 4122 v4 layout — set version + variant bits so the value
    // parses cleanly on the server (some log parsers reject UUIDs
    // that aren't version-marked).
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  // Last-resort fallback: timestamp + random suffix. Not a real
  // UUID, but still unique per submission.
  return `crid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function RefundForm({ eligibility }: { eligibility: RefundEligibility }) {
  const { order, remainingRefundableCents, windowEndAt, daysRemaining } = eligibility

  // Idempotency key — generated ONCE on mount and reused on every
  // retry. A network failure mid-submit (user double-clicks Submit,
  // browser reconnects, etc.) re-submits with the SAME key, so the
  // server's idempotency check returns the existing refund row
  // instead of creating a duplicate. The server's unique partial
  // index on `refunds.client_request_id` is the safety net for race
  // conditions.
  const clientRequestId = useMemo(() => generateClientRequestId(), [])

  const [refundType, setRefundType] = useState<'full' | 'partial'>('full')
  const [partialAmount, setPartialAmount] = useState(
    (remainingRefundableCents / 100).toFixed(2),
  )
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // The currently-uploaded proof (if any). When set, the form passes
  // `proof_path` + `proof_filename` to the action; when null, the
  // action omits both fields and the refund row is created without
  // a proof attachment.
  const [proof, setProof] = useState<RefundProofUploadResult | null>(null)

  const partialCents = Math.round(parseFloat(partialAmount || '0') * 100)
  const amountCents = refundType === 'full' ? remainingRefundableCents : partialCents
  const amountValid = amountCents > 0 && amountCents <= remainingRefundableCents

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrors({})
    setSubmitError(null)
    if (!reason) {
      setErrors({ reason: 'Please pick a reason.' })
      return
    }
    if (!amountValid) {
      setErrors({ amount: 'Enter a valid amount between $0.01 and the remaining balance.' })
      return
    }
    startTransition(async () => {
      const result = await createRefundRequestAction({
        orderId: order.id,
        reason,
        notes,
        amountCents,
        clientRequestId,
        proofPath: proof?.storagePath,
        proofFilename: proof?.sanitizedFilename,
      })
      if (!result.ok) {
        setSubmitError(result.error)
        if (result.fieldErrors) setErrors(result.fieldErrors)
        return
      }
      window.location.href = `/account/orders/${order.id}/refund/sent?refundId=${result.refundId}`
    })
  }

  const windowEnd = new Date(windowEndAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const windowAmber = daysRemaining <= 2

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <section className={`${styles.banner} ${windowAmber ? styles.bannerAmber : ''}`}>
        <p className={styles.bannerText}>
          Refund window: eligible until <strong>{windowEnd}</strong> ({daysRemaining} day
          {daysRemaining === 1 ? '' : 's'} remaining).
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>What you&apos;re refunding</h2>
        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span>Order</span>
            <span className={styles.numCol}>#{order.id}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>Date</span>
            <span className={styles.muted}>
              {new Date(order.created_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
          <ul className={styles.items}>
            {order.items.map((it) => (
              <li key={it.id} className={styles.itemRow}>
                <span>
                  {it.product_title}
                  <span className={styles.itemLicense}> · {it.license}</span>
                </span>
                <span className={styles.numCol}>{formatMoney(it.line_total_cents, order.currency)}</span>
              </li>
            ))}
          </ul>
          <div className={`${styles.summaryRow} ${styles.totalRow}`}>
            <span>Total paid</span>
            <span className={styles.numCol}>{formatMoney(order.total_cents, order.currency)}</span>
          </div>
          {eligibility.alreadyRefundedCents > 0 && (
            <div className={styles.summaryRow}>
              <span>Already refunded</span>
              <span className={styles.numCol}>
                −{formatMoney(eligibility.alreadyRefundedCents, order.currency)}
              </span>
            </div>
          )}
          <div className={`${styles.summaryRow} ${styles.totalRow}`}>
            <span>Remaining refundable</span>
            <span className={styles.numCol}>
              {formatMoney(remainingRefundableCents, order.currency)}
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Reason</h2>
        <div className={styles.field}>
          <label htmlFor="reason" className={styles.label}>
            Why are you requesting a refund?
          </label>
          <select
            id="reason"
            className={styles.select}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          >
            <option value="">Pick a reason…</option>
            {Object.entries(REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {errors.reason && (
            <p className={styles.error} role="alert">
              {errors.reason}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="notes" className={styles.label}>
            Details <span className={styles.optional}>(optional, helps us review faster)</span>
          </label>
          <textarea
            id="notes"
            className={styles.textarea}
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={4}
          />
          <p className={styles.counter}>{notes.length} / 500</p>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Refund amount</h2>
        <div className={styles.radioGroup}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="refundType"
              value="full"
              checked={refundType === 'full'}
              onChange={() => setRefundType('full')}
            />
            <span>Full refund ({formatMoney(remainingRefundableCents, order.currency)})</span>
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="refundType"
              value="partial"
              checked={refundType === 'partial'}
              onChange={() => setRefundType('partial')}
            />
            <span>Partial refund</span>
          </label>
        </div>
        {refundType === 'partial' && (
          <div className={styles.field}>
            <label htmlFor="partial_amount" className={styles.label}>
              Amount (USD)
            </label>
            <input
              id="partial_amount"
              type="number"
              min="0.01"
              max={(remainingRefundableCents / 100).toFixed(2)}
              step="0.01"
              className={styles.input}
              value={partialAmount}
              onChange={(e) => setPartialAmount(e.target.value)}
            />
            <p className={styles.help}>
              Up to {formatMoney(remainingRefundableCents, order.currency)}.
            </p>
            {errors.amount && (
              <p className={styles.error} role="alert">
                {errors.amount}
              </p>
            )}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>
          Proof <span className={styles.optional}>(optional)</span>
        </h2>
        <p className={styles.help}>
          Attach a screenshot, receipt, or PDF that helps us understand the issue. Helps us
          review faster.
        </p>
        <RefundProofUploader
          uploaded={proof}
          onUploaded={setProof}
          onCleared={() => setProof(null)}
        />
      </section>

      {submitError && (
        <p className={styles.submitError} role="alert">
          {submitError}
        </p>
      )}

      <div className={styles.actions}>
        <Link href={`/account/orders/${order.id}`} className={styles.cancelLink}>
          Cancel — back to order
        </Link>
        <Button
          type="submit"
          variant="primary"
          disabled={!reason || !amountValid || isPending}
          loading={isPending}
        >
          Submit refund request
        </Button>
      </div>
    </form>
  )
}