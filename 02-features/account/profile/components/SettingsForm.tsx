'use client'

import { useCallback, useState, useTransition } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import {
  updateNotificationPrefsAction,
  updateLocaleAndTimezoneAction,
} from '../actions/updateSettings'
import { SUPPORTED_LOCALES } from '../types'
import styles from './SettingsForm.module.css'

type EmailDigestFreq = 'off' | 'daily' | 'weekly' | 'monthly'

type SettingsFormProps = {
  initial: {
    email_digest_freq: EmailDigestFreq
    marketing_opt_in: boolean
    newsletter_opt_in: boolean
    partner_updates_opt_in: boolean
    affiliate_updates_opt_in: boolean
    locale: string
    timezone: string
  }
  /** When true, both per-list marketing toggles are rendered. When false,
   *  only the master + the newsletter opt-in are shown (the spec's role
   *  gating for partner/affiliate is "render for everyone" by default;
   *  pass false to suppress the partner/affiliate rows in narrower
   *  surfaces). Defaults to true (over-deliver, let the user mute). */
  showPartnerAffiliateToggles?: boolean
}

const DIGEST_FREQ_OPTIONS: ReadonlyArray<{ value: EmailDigestFreq; label: string; help: string }> = [
  { value: 'off', label: 'Off', help: "Don't send a digest." },
  { value: 'daily', label: 'Daily', help: 'A roundup of new products + platform news, every morning.' },
  { value: 'weekly', label: 'Weekly', help: 'A roundup of new products + platform news, once a week.' },
  {
    value: 'monthly',
    label: 'Monthly',
    help: 'A roundup of new products + platform news, once a month.',
  },
]

export function SettingsForm({ initial, showPartnerAffiliateToggles = true }: SettingsFormProps) {
  const [prefs, setPrefs] = useState({
    email_digest_freq: initial.email_digest_freq,
    marketing_opt_in: initial.marketing_opt_in,
    newsletter_opt_in: initial.newsletter_opt_in,
    partner_updates_opt_in: initial.partner_updates_opt_in,
    affiliate_updates_opt_in: initial.affiliate_updates_opt_in,
  })
  const [localeTz, setLocaleTz] = useState({
    locale: initial.locale,
    timezone: initial.timezone,
  })
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  const showToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg })
    setTimeout(() => setToast(null), 3000)
  }

  /** Patch a single preference field. Optimistic update + revert on
   *  failure (per the spec's "within 300ms; on failure the toggle
   *  reverts and a toast shows the error" requirement). */
  const patchPref = useCallback(
    (patch: Partial<typeof prefs>) => {
      const next = { ...prefs, ...patch }
      setPrefs(next)
      setToast(null)
      startTransition(async () => {
        const result = await updateNotificationPrefsAction(patch)
        if (!result.ok) {
          setPrefs(prefs)
          showToast('err', result.error)
          return
        }
        showToast('ok', 'Saved.')
      })
    },
    [prefs],
  )

  const onFreqChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      patchPref({ email_digest_freq: e.target.value as EmailDigestFreq })
    },
    [patchPref],
  )

  const onMasterToggle = useCallback(() => {
    const next = !prefs.marketing_opt_in
    // When the master turns on, the per-list defaults follow. When the
    // master turns off, all per-lists explicitly off (one-click
    // unsubscribe per the spec).
    patchPref({
      marketing_opt_in: next,
      newsletter_opt_in: next,
      partner_updates_opt_in: next ? prefs.partner_updates_opt_in : false,
      affiliate_updates_opt_in: next ? prefs.affiliate_updates_opt_in : false,
    })
  }, [prefs, patchPref])

  const onLocaleTzChange = useCallback(
    (key: 'locale' | 'timezone', value: string) => {
      const next = { ...localeTz, [key]: value }
      setLocaleTz(next)
      setToast(null)
      startTransition(async () => {
        const result = await updateLocaleAndTimezoneAction(next)
        if (!result.ok) {
          setLocaleTz(localeTz)
          showToast('err', result.error)
          return
        }
        showToast('ok', 'Saved.')
      })
    },
    [localeTz],
  )

  // Whether the per-list marketing toggles are currently suppressed by
  // the master switch — visually muted, click does nothing (the master
  // is the only thing they need to flip).
  const marketingDisabled = !prefs.marketing_opt_in

  return (
    <div className={styles.wrap}>
      {toast && (
        <p
          className={toast.kind === 'ok' ? styles.toastOk : styles.toastErr}
          role="status"
          aria-live="polite"
        >
          {toast.msg}
        </p>
      )}

      <section className={styles.section}>
        <h2 className={styles.h2}>Notifications</h2>
        <p className={styles.lede}>
          Choose how often we email you about platform news and product updates.
        </p>

        <div className={styles.fieldRow}>
          <div>
            <label htmlFor="settings_email_digest_freq" className={styles.rowLabel}>
              Email digest frequency
            </label>
            <p className={styles.rowHelp}>
              A roundup of new products, sales, and platform news. Pick a cadence or turn it off.
            </p>
          </div>
          <select
            id="settings_email_digest_freq"
            className={styles.select}
            value={prefs.email_digest_freq}
            onChange={onFreqChange}
            disabled={isPending}
            aria-describedby="settings_email_digest_freq_help"
          >
            {DIGEST_FREQ_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} — {o.help}
              </option>
            ))}
          </select>
        </div>
        <p id="settings_email_digest_freq_help" className={styles.visuallyHidden}>
          Pick how often we send a digest email. Off disables digest emails entirely.
        </p>

        <div className={styles.lockedRow}>
          <div>
            <p className={styles.rowLabel}>
              Transactional emails <span className={styles.lockedBadge}>Required</span>
            </p>
            <p className={styles.rowHelp}>
              Order receipts, password resets, payout notifications, security alerts. These
              are required for the service to function and cannot be turned off.
            </p>
          </div>
          <span className={styles.lockedSwitch} aria-label="Always on" />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Marketing emails</h2>
        <p className={styles.lede}>
          Pick the marketing lists you want to hear from. The master switch turns everything off
          in one click.
        </p>

        <div className={styles.row}>
          <div>
            <p className={styles.rowLabel}>Marketing emails</p>
            <p className={styles.rowHelp}>
              Master switch. Off suppresses every marketing email, regardless of the per-list
              toggles below.
            </p>
          </div>
          <Toggle
            checked={prefs.marketing_opt_in}
            disabled={isPending}
            onChange={onMasterToggle}
            label="Marketing emails"
          />
        </div>

        <div className={`${styles.row} ${marketingDisabled ? styles.mutedRow : ''}`}>
          <div>
            <p className={styles.rowLabel}>Newsletter</p>
            <p className={styles.rowHelp}>
              General platform news, new product highlights, and feature updates.
            </p>
          </div>
          <Toggle
            checked={prefs.newsletter_opt_in && prefs.marketing_opt_in}
            disabled={isPending || marketingDisabled}
            onChange={() => patchPref({ newsletter_opt_in: !prefs.newsletter_opt_in })}
            label="Newsletter"
          />
        </div>

        {showPartnerAffiliateToggles ? (
          <>
            <div className={`${styles.row} ${marketingDisabled ? styles.mutedRow : ''}`}>
              <div>
                <p className={styles.rowLabel}>Partner program updates</p>
                <p className={styles.rowHelp}>
                  For current and aspiring partners — payouts, product reviews, program changes.
                </p>
              </div>
              <Toggle
                checked={prefs.partner_updates_opt_in && prefs.marketing_opt_in}
                disabled={isPending || marketingDisabled}
                onChange={() =>
                  patchPref({ partner_updates_opt_in: !prefs.partner_updates_opt_in })
                }
                label="Partner program updates"
              />
            </div>

            <div className={`${styles.row} ${marketingDisabled ? styles.mutedRow : ''}`}>
              <div>
                <p className={styles.rowLabel}>Affiliate program updates</p>
                <p className={styles.rowHelp}>
                  For current and aspiring affiliates — commission changes, payout schedules,
                  promotional tips.
                </p>
              </div>
              <Toggle
                checked={prefs.affiliate_updates_opt_in && prefs.marketing_opt_in}
                disabled={isPending || marketingDisabled}
                onChange={() =>
                  patchPref({ affiliate_updates_opt_in: !prefs.affiliate_updates_opt_in })
                }
                label="Affiliate program updates"
              />
            </div>
          </>
        ) : null}
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Language & region</h2>
        <p className={styles.lede}>
          Controls the language we email you in and the timezone we use for delivery dates.
        </p>

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label htmlFor="settings_locale" className={styles.label}>
              Language
            </label>
            <select
              id="settings_locale"
              className={styles.select}
              value={localeTz.locale}
              onChange={(e) => onLocaleTzChange('locale', e.target.value)}
              disabled={isPending}
            >
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="settings_timezone" className={styles.label}>
              Timezone
            </label>
            <select
              id="settings_timezone"
              className={styles.select}
              value={localeTz.timezone}
              onChange={(e) => onLocaleTzChange('timezone', e.target.value)}
              disabled={isPending}
            >
              {Intl.supportedValuesOf('timeZone').map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Privacy</h2>
        <p className={styles.lede}>
          Take your data with you or close your account. Both are irreversible from your side.
        </p>
        <div className={styles.privacyRow}>
          <Button type="button" variant="secondary" disabled>
            Download my data
          </Button>
          <p className={styles.privacyHelp}>
            We&apos;ll email you a link to a JSON export of your account within 10 minutes.
            (Available in a follow-up release.)
          </p>
        </div>
        <div className={styles.privacyRow}>
          <a className={styles.linkBtn} href="/account/profile#danger">
            Delete account →
          </a>
          <p className={styles.privacyHelp}>
            Opens the danger zone on your profile page. Requires typing your email to confirm.
          </p>
        </div>
      </section>
    </div>
  )
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`${styles.switch} ${checked ? styles.switchOn : ''} ${disabled ? styles.switchDisabled : ''}`}
    >
      <span className={styles.knob} />
    </button>
  )
}