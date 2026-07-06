'use client'

// P1.4 — change password while logged in. Mirrors `UpdatePasswordForm`
// (P1.3) with one extra field at the top: the current password, which
// the action verifies server-side before rotating the secret.
//
// Spec contract (`01-specs/pages/account-password.md`):
//   - Auth-gated; the layout redirects anonymous visitors to /login.
//   - Three fields: Current password, New password, Confirm new password.
//   - New password requirements match the P1.3 update schema
//     (min 12 + digit + symbol — stricter than signup's min 10).
//   - Live strength meter driven by the SAME rules as the server Zod.
//   - Submit disabled until all three fields are non-empty AND new =
//     confirm AND strength score ≥ 2 (Fair or better).
//   - On success: brief "Password updated" state (1.2s) → router.push
//     to /account/profile. The user stays signed in on the same session.
//   - On rate-limit hit: inline cooldown notice + submit disabled
//     (same pattern as the login form).
//   - On wrong-current-password: server returns
//     "Current password is incorrect." (single friendly error).
//   - On OAuth-only user: server returns a "use the reset flow" message;
//     we render it verbatim in the serverError slot.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { Button, Input } from '@foundations/ui/primitives/Button'
import { changePasswordAction, type AuthActionResult } from './actions'
import { passwordStrength } from './passwordStrength'
import styles from './AuthForms.module.css'

// P1.4 — stricter than the signup form (min 10 + upper/lower/digit)
// and identical to the P1.3 update-password schema (min 12 + digit +
// symbol). The change-password flow is a "we know you have a current
// password" moment, so we can require a stronger new secret.
const Schema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    password: z
      .string()
      .min(12, 'At least 12 characters')
      .max(200, 'Too long')
      .regex(/[0-9]/, 'Use a number')
      .regex(/[^A-Za-z0-9]/, 'Use a symbol'),
    confirm: z.string().min(1, 'Required'),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })
type FormValues = z.infer<typeof Schema>

/**
 * Format a positive-integer second count as "Xm Ys" / "Xm" / "Xs".
 * Mirrors the helper in AuthForms.tsx — kept inline here to avoid
 * an unnecessary shared module for two callers that want the same
 * shape.
 */
function formatRetryAfter(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`
}

export function ChangePasswordForm() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [justUpdated, setJustUpdated] = useState(false)
  const [passwordValue, setPasswordValue] = useState('')
  // We track the confirm field's value in local state so canSubmit
  // can mirror it without re-rendering on every keystroke through
  // the watch() path (same pattern as UpdatePasswordForm).
  const [confirmValue, setConfirmValue] = useState('')
  // P1.4 — same cooldown pattern as the login form. The action
  // returns `rateLimited.retryAfterSeconds`; we cache the
  // deadline locally so the submit button can disable itself
  // and the inline notice can count down.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { currentPassword: '', password: '', confirm: '' },
  })

  // P1.4 — live strength meter. Re-uses the same `passwordStrength`
  // helper as the signup + reset-completion forms so the three
  // stay consistent. Hidden when the input is empty so the form
  // doesn't show "too short" before the user has typed anything.
  const strength = useMemo(() => passwordStrength(passwordValue), [passwordValue])
  const currentPasswordField = register('currentPassword')
  const passwordField = register('password')
  const confirmField = register('confirm')

  // Tick `now` once a second while a cooldown is active so the
  // countdown label updates without a re-render churn.
  useEffect(() => {
    if (cooldownUntil == null) return
    const remaining = cooldownUntil - now
    if (remaining <= 0) {
      setCooldownUntil(null)
      return
    }
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [cooldownUntil, now])

  const cooldownRemaining = cooldownUntil == null ? 0 : Math.max(0, cooldownUntil - now)
  const cooldownActive = cooldownRemaining > 0

  // P1.4 — submit disabled until all three fields are non-empty
  // AND new = confirm AND strength score ≥ 2 (Fair or better).
  // Same `canSubmit` shape as UpdatePasswordForm, with the
  // current-password field layered in. The `strength?.score ?? 0`
  // guard handles the case where the helper returns null (empty
  // password input).
  const canSubmit =
    passwordValue.length > 0 &&
    confirmValue.length > 0 &&
    !cooldownActive &&
    !pending &&
    (strength?.score ?? 0) >= 2

  function onSubmit(values: FormValues) {
    setServerError(null)
    const fd = new FormData()
    fd.append('currentPassword', values.currentPassword)
    fd.append('password', values.password)
    fd.append('confirm', values.confirm)
    startTransition(async () => {
      const res: AuthActionResult = await changePasswordAction(fd)
      if (res.ok) {
        setJustUpdated(true)
        // Brief beat so the user perceives the success before the
        // page navigates. The destination is always
        // /account/profile — the spec deliberately doesn't accept
        // a `?next=` parameter on this page.
        setTimeout(() => {
          router.push('/account/profile')
          router.refresh()
        }, 1200)
      } else {
        setServerError(res.error)
        if (res.rateLimited) {
          setCooldownUntil(Date.now() + res.rateLimited.retryAfterSeconds * 1000)
          setNow(Date.now())
        }
        // P1.4 — if the current password was wrong, the form
        // remains filled so the user can correct the typo without
        // re-typing the new password. Reset only the current
        // password field on this branch (so a retry doesn't
        // require re-typing the new password). react-hook-form's
        // `reset` is the canonical way to do this — we re-set
        // the new + confirm fields to the values the user just
        // typed, and clear currentPassword.
        if (res.error === 'Current password is incorrect.') {
          reset(
            {
              currentPassword: '',
              password: values.password,
              confirm: values.confirm,
            },
            { keepDirty: false, keepValues: false },
          )
          setPasswordValue(values.password)
          setConfirmValue(values.confirm)
        }
      }
    })
  }

  if (justUpdated) {
    return (
      <div className={styles.form} role="status" aria-live="polite">
        <h1 className={styles.h1}>Password updated</h1>
        <p className={styles.lede}>
          You&apos;re still signed in. Returning to your profile…
        </p>
        <p className={styles.serverMessageHint}>
          If you&apos;re not redirected automatically,{' '}
          <Link href="/account/profile" className={styles.link}>
            go to your profile
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <h1 className={styles.h1}>Change password</h1>
      <p className={styles.lede}>
        Verify your identity, then choose a new password.
      </p>
      {serverError && (
        <p className={styles.serverError} role="alert" aria-live="assertive">
          {serverError}
        </p>
      )}
      {cooldownActive && (
        <p className={styles.cooldownNotice} role="status" aria-live="polite">
          <span className={styles.cooldownLabel}>Cooldown active</span>
          <span className={styles.cooldownCount}>
            {formatRetryAfter(Math.ceil(cooldownRemaining / 1000))}
          </span>
          <span className={styles.cooldownHint}>until you can try again.</span>
        </p>
      )}
      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
        {...currentPasswordField}
        error={errors.currentPassword?.message ?? undefined}
        disabled={cooldownActive || pending}
      />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        autoFocus
        hint="At least 12 characters, with a number and a symbol."
        {...passwordField}
        onChange={(e) => {
          passwordField.onChange(e)
          setPasswordValue(e.target.value)
        }}
        error={errors.password?.message ?? undefined}
        disabled={cooldownActive || pending}
      />
      {strength && (
        <div
          className={styles.strengthMeter}
          aria-live="polite"
          aria-label={`Password strength: ${strength.label}`}
        >
          <div className={styles.strengthBarRow}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={[
                  styles.strengthBar,
                  i <= strength.score ? styles[`strengthBarOn_${strength.score}`] : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
            ))}
          </div>
          <span className={styles.strengthLabel}>{strength.label}</span>
        </div>
      )}
      <Input
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        {...confirmField}
        onChange={(e) => {
          confirmField.onChange(e)
          setConfirmValue(e.target.value)
        }}
        error={errors.confirm?.message ?? undefined}
        disabled={cooldownActive || pending}
      />
      <Button
        type="submit"
        loading={pending}
        fullWidth
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
      >
        Update password
      </Button>
      <p className={styles.foot}>
        <Link href="/account/profile" className={styles.link}>
          Back to profile
        </Link>
      </p>
    </form>
  )
}