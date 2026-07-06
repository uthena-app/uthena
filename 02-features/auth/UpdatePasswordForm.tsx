'use client'

// P1.3 — the set-new page (where the reset email link lands). Renders
// a "Set a new password" form with a live strength meter, ?next=
// pass-through, and a brief "Password updated — redirecting..." state
// before the action's redirect fires.
//
// Spec contract (`01-specs/pages/update-password.md`):
//   - Min 12 chars, at least 1 number, at least 1 symbol (stricter than
//     signup's "min 10 + upper/lower/digit" — the update flow is a
//     "we know you have access to the inbox" moment, so we can require
//     a stronger secret).
//   - 5-level strength meter driven by the SAME rules as the server
//     Zod refinement.
//   - Submit disabled until both password fields are non-empty AND
//     the two passwords match AND the strength is "ok" (score ≥ 2,
//     which roughly maps to "Fair or better" per the spec's open
//     question; the helper uses the existing P1.1 labels so the UX
//     is consistent with the signup form).
//   - `?next=` pass-through — the post-reset flow returns the user to
//     where they originally tried to go (typically the URL they were
//     sent from `/login?next=…` to access).
//
// The expired/used/wrong-link state is rendered by the page itself
// (not this form) — the form is only mounted when a valid Supabase
// session is present.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { Button, Input } from '@foundations/ui/primitives/Button'
import { updatePasswordAction, type AuthActionResult } from './actions'
import { passwordStrength } from './passwordStrength'
import styles from './AuthForms.module.css'

// P1.3 — stricter than the signup form: min 12 + digit + symbol.
// (Signup uses min 10 + upper/lower/digit per `01-specs/pages/signup.md`;
// the update flow has a higher assurance bar because the user just
// proved they own the inbox via the reset link.)
const Schema = z
  .object({
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

export function UpdatePasswordForm({ next }: { next?: string | undefined }) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // P1.3 — the "Password updated" success state. Shows for 1.2s so
  // screen readers + sighted users both perceive the confirmation
  // before the redirect navigates away (the spec wants a clear
  // "you're signed in" beat). The state is purely visual — the
  // actual navigation is driven by the action's `redirectTo`.
  const [justUpdated, setJustUpdated] = useState(false)
  const [passwordValue, setPasswordValue] = useState('')
  const [confirmValue, setConfirmValue] = useState('')
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(Schema) })

  // Live password-strength meter. Re-uses the same `passwordStrength`
  // helper as SignUpForm so the two stay consistent. Hidden when the
  // input is empty.
  const strength = useMemo(() => passwordStrength(passwordValue), [passwordValue])
  const passwordField = register('password')
  const confirmField = register('confirm')

  // Per spec: "Update password is disabled until both password fields
  // are non-empty AND the two passwords match AND the strength meter
  // is 'Fair' or better". We map "Fair or better" to score ≥ 2 in
  // the existing helper (label "ok"). The Zod refinement catches
  // "passwords don't match" too, but we surface it as a disabled
  // button before the user clicks submit.
  const canSubmit =
    passwordValue.length > 0 &&
    confirmValue.length > 0 &&
    passwordValue === confirmValue &&
    (strength?.score ?? 0) >= 2

  function onSubmit(values: FormValues) {
    setServerError(null)
    const fd = new FormData()
    fd.append('password', values.password)
    if (next) fd.append('next', next)
    startTransition(async () => {
      const res: AuthActionResult = await updatePasswordAction(fd)
      if (res.ok) {
        setJustUpdated(true)
        // Brief beat so the user perceives the success before the
        // page navigates. The action returns a `redirectTo`, but
        // we use a timed push so the success state has a chance
        // to render (router.push is sync from the caller's POV but
        // the navigation is async — without a delay, the new page
        // often wins the race).
        const target = res.redirectTo ?? '/library'
        setTimeout(() => {
          router.push(target)
          router.refresh()
        }, 1200)
      } else {
        setServerError(res.error)
      }
    })
  }

  if (justUpdated) {
    return (
      <div className={styles.form} role="status" aria-live="polite">
        <h1 className={styles.h1}>Password updated</h1>
        <p className={styles.lede}>
          You&apos;re signed in. Redirecting to your library…
        </p>
        <p className={styles.serverMessage}>
          If you&apos;re not redirected automatically,{' '}
          <Link href={next ?? '/library'} className={styles.link}>
            continue to your library
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <h1 className={styles.h1}>Set a new password</h1>
      <p className={styles.lede}>Choose a strong password you don&apos;t use elsewhere.</p>
      {serverError && <p className={styles.serverError} role="alert">{serverError}</p>}
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
        disabled={pending}
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
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        required
        {...confirmField}
        onChange={(e) => {
          confirmField.onChange(e)
          setConfirmValue(e.target.value)
        }}
        error={errors.confirm?.message ?? undefined}
        disabled={pending}
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
    </form>
  )
}
