'use client'

// GeneralSettingsForm — the editor for the 3 PHASES.md-resolves-STUB
// numeric fields on `platform_settings`:
//   - default_royalty_pct_bps
//   - plr_subscriber_discount_pct_bps
//   - default_refund_window_days
//
// Server-side Zod validation is the source of truth. The form surfaces
// errors inline (one per field via the fieldErrors map) and a single
// banner for top-level errors (auth, pre-read failure, etc.).
//
// Display: bps values are shown as percentages to the human (3000 →
// "30%") because that's the mental model — but the wire payload stays
// in bps to keep the round-trip lossless.

import { useId, useState, useTransition } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import { updatePlatformSettingsGeneralAction } from '../actions/updatePlatformSettingsGeneral'
import type { PlatformSettingsGeneral } from '../queries/getPlatformSettingsGeneral'
import styles from './GeneralSettingsForm.module.css'

type GeneralSettingsFormProps = {
  initial: PlatformSettingsGeneral
}

function bpsToPercent(bps: number): string {
  // Display as "15.0%" / "30%" / "0.5%" — trim trailing zero for
  // round percentages so the form reads cleanly.
  const pct = bps / 100
  const fixed = pct.toFixed(1).replace(/\.0$/, '')
  return `${fixed}%`
}

function formatBpsAsPercentInput(bps: number): string {
  // For the <input type="number"> — keep one decimal so the admin can
  // type "15.5" without fighting the input.
  const pct = bps / 100
  return pct.toFixed(1).replace(/\.0$/, '')
}

export function GeneralSettingsForm({ initial }: GeneralSettingsFormProps) {
  const formId = useId()
  const [royaltyPctStr, setRoyaltyPctStr] = useState(
    formatBpsAsPercentInput(initial.default_royalty_pct_bps),
  )
  const [discountPctStr, setDiscountPctStr] = useState(
    formatBpsAsPercentInput(initial.plr_subscriber_discount_pct_bps),
  )
  const [refundDaysStr, setRefundDaysStr] = useState(
    String(initial.default_refund_window_days),
  )
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function pctToBps(pct: number): number {
    return Math.round(pct * 100)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setSuccess(null)

    const royaltyPct = Number(royaltyPctStr)
    const discountPct = Number(discountPctStr)
    const refundDays = Number(refundDaysStr)

    startTransition(async () => {
      const res = await updatePlatformSettingsGeneralAction({
        default_royalty_pct_bps: pctToBps(royaltyPct),
        plr_subscriber_discount_pct_bps: pctToBps(discountPct),
        default_refund_window_days: refundDays,
      })
      if (!res.ok) {
        setError(res.error)
        if (res.fieldErrors) setFieldErrors(res.fieldErrors)
        return
      }
      const stamp = formatUpdatedAt(res.updatedAt)
      if (res.changed) {
        setSuccess(stamp ? `Saved at ${stamp}.` : 'Saved.')
      } else {
        setSuccess('No changes — values match the current settings.')
      }
    })
  }

  function onReset() {
    setRoyaltyPctStr(formatBpsAsPercentInput(initial.default_royalty_pct_bps))
    setDiscountPctStr(formatBpsAsPercentInput(initial.plr_subscriber_discount_pct_bps))
    setRefundDaysStr(String(initial.default_refund_window_days))
    setError(null)
    setFieldErrors({})
    setSuccess(null)
  }

  return (
    <form id={formId} className={styles.form} onSubmit={onSubmit} noValidate>
      <p className={styles.intro}>
        The 3 fields on this page are the platform-wide defaults applied across checkout + the
        refund window. Changes take effect on the next checkout (the read is per-request, no
        long-term cache).
      </p>

      <div className={styles.row}>
        <label htmlFor={`${formId}-royalty`} className={styles.label}>
          Default royalty
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        </label>
        <div className={styles.numberField}>
          <input
            id={`${formId}-royalty`}
            name="default_royalty_pct"
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0}
            max={100}
            className={[
              styles.input,
              fieldErrors.default_royalty_pct_bps ? styles.inputError : '',
            ]
              .filter(Boolean)
              .join(' ')}
            value={royaltyPctStr}
            onChange={(e) => setRoyaltyPctStr(e.target.value)}
            required
            aria-invalid={fieldErrors.default_royalty_pct_bps ? 'true' : undefined}
            aria-describedby={
              fieldErrors.default_royalty_pct_bps ? `${formId}-royalty-err` : `${formId}-royalty-hint`
            }
          />
          <span className={styles.suffix}>%</span>
        </div>
        {fieldErrors.default_royalty_pct_bps ? (
          <p id={`${formId}-royalty-err`} className={styles.fieldError} role="alert">
            {fieldErrors.default_royalty_pct_bps}
          </p>
        ) : (
          <p id={`${formId}-royalty-hint`} className={styles.hint}>
            Applied to new orders when a per-tier override isn&apos;t set. Currently{' '}
            {bpsToPercent(initial.default_royalty_pct_bps)}.
          </p>
        )}
      </div>

      <div className={styles.row}>
        <label htmlFor={`${formId}-discount`} className={styles.label}>
          PLR subscriber discount
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        </label>
        <div className={styles.numberField}>
          <input
            id={`${formId}-discount`}
            name="plr_subscriber_discount_pct"
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0}
            max={100}
            className={[
              styles.input,
              fieldErrors.plr_subscriber_discount_pct_bps ? styles.inputError : '',
            ]
              .filter(Boolean)
              .join(' ')}
            value={discountPctStr}
            onChange={(e) => setDiscountPctStr(e.target.value)}
            required
            aria-invalid={fieldErrors.plr_subscriber_discount_pct_bps ? 'true' : undefined}
            aria-describedby={
              fieldErrors.plr_subscriber_discount_pct_bps
                ? `${formId}-discount-err`
                : `${formId}-discount-hint`
            }
          />
          <span className={styles.suffix}>%</span>
        </div>
        {fieldErrors.plr_subscriber_discount_pct_bps ? (
          <p id={`${formId}-discount-err`} className={styles.fieldError} role="alert">
            {fieldErrors.plr_subscriber_discount_pct_bps}
          </p>
        ) : (
          <p id={`${formId}-discount-hint`} className={styles.hint}>
            Active subscribers get this off every PLR line (per-tier overrides win). Currently{' '}
            {bpsToPercent(initial.plr_subscriber_discount_pct_bps)}.
          </p>
        )}
      </div>

      <div className={styles.row}>
        <label htmlFor={`${formId}-refund`} className={styles.label}>
          Refund window
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        </label>
        <div className={styles.numberField}>
          <input
            id={`${formId}-refund`}
            name="default_refund_window_days"
            type="number"
            inputMode="numeric"
            step="1"
            min={1}
            max={365}
            className={[
              styles.input,
              fieldErrors.default_refund_window_days ? styles.inputError : '',
            ]
              .filter(Boolean)
              .join(' ')}
            value={refundDaysStr}
            onChange={(e) => setRefundDaysStr(e.target.value)}
            required
            aria-invalid={fieldErrors.default_refund_window_days ? 'true' : undefined}
            aria-describedby={
              fieldErrors.default_refund_window_days
                ? `${formId}-refund-err`
                : `${formId}-refund-hint`
            }
          />
          <span className={styles.suffix}>days</span>
        </div>
        {fieldErrors.default_refund_window_days ? (
          <p id={`${formId}-refund-err`} className={styles.fieldError} role="alert">
            {fieldErrors.default_refund_window_days}
          </p>
        ) : (
          <p id={`${formId}-refund-hint`} className={styles.hint}>
            How long payout balances stay locked after a sale (1–365). The daily cron flips
            &quot;locked&quot; → &quot;available&quot; when locked_until &lt; now(). Currently{' '}
            {initial.default_refund_window_days} days.
          </p>
        )}
      </div>

      {error && (
        <p className={styles.alertError} role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className={styles.success} role="status">
          {success}
        </p>
      )}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="md" loading={isPending}>
          {isPending ? 'Saving…' : 'Save changes'}
        </Button>
        <button
          type="button"
          onClick={onReset}
          className={styles.resetBtn}
          disabled={isPending}
        >
          Reset
        </button>
        <span className={styles.meta}>
          Last saved:{' '}
          <span className={styles.metaUpdated}>{formatUpdatedAt(initial.updated_at)}</span>
          {initial.updated_by_display_name && (
            <>
              {' '}
              by <span className={styles.metaBy}>{initial.updated_by_display_name}</span>
            </>
          )}
        </span>
      </div>
    </form>
  )
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`
}