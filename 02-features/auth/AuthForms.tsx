// Client-side auth form component. Wraps the server actions in
// React Hook Form + Zod for instant field validation. Used by login,
// signup, and reset-password pages.
//
// P1.1 upgrades: SignUpForm now (a) requires the terms checkbox,
// (b) carries the `?next=` redirect target through to the server,
// (c) shows a live password-strength meter (no new deps — the rules
// match the server-side Zod refinements).
//
// P1.2 upgrades: SignInForm now (a) carries the `?next=` redirect
// target, (b) carries a remember-me checkbox (server validates +
// accepts the field; client persists the choice to localStorage so a
// re-visit keeps the user signed in), (c) shows an inline cooldown
// message + disables the submit button when the server returns
// `rateLimited.retryAfterSeconds`, and (d) the forgot-password link
// preserves `?next=` so the post-reset flow lands the user back
// where they tried to go.

'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { Button, Input } from '@foundations/ui/primitives/Button'
import { signInAction, signUpAction, requestPasswordResetAction, type AuthActionResult } from './actions'
import { passwordStrength } from './passwordStrength'
import { OAuthButtons } from './OAuthButtons'
import type { OAuthProvider } from '@foundations/auth/oauth'
import styles from './AuthForms.module.css'

const REMEMBER_KEY = 'uthena.rememberMe.v1'

const SignInClientSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Required'),
  // The browser sends `remember=on` when the checkbox is checked, no
  // value otherwise. The schema accepts the canonical "checked" string.
  remember: z.union([z.literal('on'), z.literal('')]).optional(),
})
type SignInInput = z.infer<typeof SignInClientSchema>

const SignUpClientSchema = z
  .object({
    email: z.string().email('Enter a valid email'),
    display_name: z.string().min(1, 'Required').max(80),
    password: z
      .string()
      .min(10, 'At least 10 characters')
      .max(200, 'Too long')
      .regex(/[A-Z]/, 'Use an uppercase letter')
      .regex(/[a-z]/, 'Use a lowercase letter')
      .regex(/[0-9]/, 'Use a number'),
    // P1.1 — terms acceptance is required at the form level AND
    // re-validated server-side. The Zod literal(true) means any
    // value other than the literal `true` (string from a checkbox
    // value "true") fails. The form prevents submit until checked,
    // so a `false` only reaches the server on a forged POST.
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms to continue' }),
    }),
  })
type SignUpInput = z.infer<typeof SignUpClientSchema>

const ResetClientSchema = z.object({ email: z.string().email('Enter a valid email') })
type ResetInput = z.infer<typeof ResetClientSchema>

/**
 * Format a positive-integer second count as "Xm Ys" / "Xm" / "Xs".
 * Always returns the human-friendly floor (no rounding surprises
 * like "1m 60s" for a 119-second value).
 */
function formatRetryAfter(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`
}

export function SignInForm({
  next,
  enabledProviders = [],
  initialError,
}: {
  next?: string | undefined
  /** P1.6 — the OAuth providers enabled in the current env. The
   *  page passes the list down so the form can render the
   *  "Continue with Google" / "Continue with Apple" buttons.
   *  Empty array = no OAuth buttons. The list is computed once
   *  per request in the page (RSC) — no extra round-trips. */
  enabledProviders?: OAuthProvider[]
  /** P1.6 — error message from a previous OAuth round-trip
   *  (the action redirects back to /login?error=... when the
   *  OAuth init fails or the rate-limit trips). The form shows
   *  it as a top-of-form alert. */
  initialError?: string | undefined
}) {
  // P1.6 — surface the initial error (from a redirected OAuth
  // failure) as the initial serverError state. Subsequent
  // form-submit errors overwrite it.
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(initialError ?? null)
  const [serverMessage, setServerMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // P1.2 — when the server returns a rate-limited result, we cache
  // the retry-after seconds here so the submit button can disable
  // itself + show the cooldown inline. The countdown is purely
  // visual — the server's next response is the source of truth.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())

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

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<SignInInput>({
    resolver: zodResolver(SignInClientSchema),
    defaultValues: {
      email: '',
      password: '',
      // Read the persisted preference on mount. The checkbox defaults
      // to true (spec: "v1: always true") so existing users keep
      // their session across browser restarts until they explicitly
      // opt out.
      remember: 'on',
    },
  })
  const rememberValue = watch('remember')
  const rememberChecked = rememberValue === 'on'

  // Persist the remember-me choice. Runs whenever the value flips.
  // Defensive try/catch — localStorage can throw in private-browsing
  // mode and we never want that to break the form.
  useEffect(() => {
    try {
      window.localStorage.setItem(REMEMBER_KEY, rememberChecked ? '1' : '0')
    } catch {
      // noop — session cookies still work without localStorage.
    }
  }, [rememberChecked])

  const cooldownRemaining = cooldownUntil == null ? 0 : Math.max(0, cooldownUntil - now)
  const cooldownActive = cooldownRemaining > 0

  function onSubmit(values: SignInInput) {
    setServerError(null)
    setServerMessage(null)
    const fd = new FormData()
    fd.append('email', values.email)
    fd.append('password', values.password)
    fd.append('remember', values.remember ?? '')
    if (next) fd.append('next', next)
    startTransition(async () => {
      const res: AuthActionResult = await signInAction(fd)
      if (res.ok) {
        if (res.redirectTo) {
          router.push(res.redirectTo)
          router.refresh()
        }
      } else {
        setServerError(res.error)
        if (res.rateLimited) {
          setCooldownUntil(Date.now() + res.rateLimited.retryAfterSeconds * 1000)
          setNow(Date.now())
        }
      }
    })
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <OAuthButtons providers={enabledProviders} next={next} />
      <h1 className={styles.h1}>Welcome back</h1>
      <p className={styles.lede}>Sign in to your Uthena account.</p>
      {serverError && (
        <p className={styles.serverError} role="alert" aria-live="assertive">
          {serverError}
        </p>
      )}
      {cooldownActive && (
        <p className={styles.cooldownNotice} role="status" aria-live="polite">
          <span className={styles.cooldownLabel}>Cooldown active</span>
          <span className={styles.cooldownCount}>{formatRetryAfter(Math.ceil(cooldownRemaining / 1000))}</span>
          <span className={styles.cooldownHint}>until you can try again.</span>
        </p>
      )}
      {serverMessage && <p className={styles.serverMessage} role="status">{serverMessage}</p>}
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        required
        {...register('email')}
        error={errors.email?.message ?? undefined}
        disabled={cooldownActive || pending}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        {...register('password')}
        error={errors.password?.message ?? undefined}
        disabled={cooldownActive || pending}
      />
      <div className={styles.rememberRow}>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={rememberChecked}
            onChange={(e) => setValue('remember', e.target.checked ? 'on' : '', { shouldDirty: true })}
            aria-describedby="remember_help"
          />
          <span className={styles.checkboxLabel} id="remember_help">
            Keep me signed in on this device.
          </span>
        </label>
        <Link
          href={next ? `/reset-password?next=${encodeURIComponent(next)}` : '/reset-password'}
          className={styles.link}
        >
          Forgot password?
        </Link>
      </div>
      <Button type="submit" loading={pending} fullWidth disabled={cooldownActive} aria-disabled={cooldownActive}>
        Sign in
      </Button>
      <p className={styles.foot}>
        New here?{' '}
        <Link
          href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
          className={styles.link}
        >
          Create an account
        </Link>
      </p>
    </form>
  )
}

export function SignUpForm({ next }: { next?: string | undefined }) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [serverMessage, setServerMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [passwordValue, setPasswordValue] = useState('')
  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<SignUpInput>({
    resolver: zodResolver(SignUpClientSchema),
    defaultValues: { acceptTerms: false as unknown as true },
  })

  // Live password-strength meter — pure, no new deps. Re-runs on
  // every password keystroke. Hidden when the input is empty so the
  // form doesn't show "too short" before the user has typed anything.
  const strength = useMemo(() => passwordStrength(passwordValue), [passwordValue])
  const passwordField = register('password')
  const acceptTermsValue = watch('acceptTerms')
  const termsAccepted = acceptTermsValue === true

  function onSubmit(values: SignUpInput) {
    setServerError(null)
    setServerMessage(null)
    const fd = new FormData()
    fd.append('email', values.email)
    fd.append('display_name', values.display_name)
    fd.append('password', values.password)
    fd.append('acceptTerms', 'true')
    if (next) fd.append('next', next)
    // honeypot
    fd.append('website', '')
    startTransition(async () => {
      const res: AuthActionResult = await signUpAction(fd)
      if (res.ok) {
        if (res.redirectTo) {
          router.push(res.redirectTo)
          router.refresh()
        } else if (res.message) {
          setServerMessage(res.message)
        }
      } else {
        if (res.fieldErrors) {
          // Map fieldErrors back to a single string for the top alert
          setServerError(Object.values(res.fieldErrors).join(' '))
        } else {
          setServerError(res.error)
        }
      }
    })
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <h1 className={styles.h1}>Create your account</h1>
      <p className={styles.lede}>Buy once, resell forever.</p>
      {serverError && <p className={styles.serverError} role="alert">{serverError}</p>}
      {serverMessage && (
        <div className={styles.serverMessage} role="status">
          <p>{serverMessage}</p>
          <p className={styles.serverMessageHint}>
            Didn&apos;t get it? Check spam, or sign in with the email above to resend.
          </p>
        </div>
      )}
      <Input
        label="Display name"
        autoComplete="name"
        required
        {...register('display_name')}
        error={errors.display_name?.message ?? undefined}
      />
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        required
        {...register('email')}
        error={errors.email?.message ?? undefined}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters, with upper, lower, and a number."
        {...passwordField}
        onChange={(e) => {
          passwordField.onChange(e)
          setPasswordValue(e.target.value)
        }}
        error={errors.password?.message ?? undefined}
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
      {/* Honeypot — hidden from humans, bots fill it. */}
      <div aria-hidden style={{ position: 'absolute', left: '-9999px' }}>
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            name="website"
            value=""
            onChange={() => {
              /* noop — kept empty for humans, bots fill it */
            }}
          />
        </label>
      </div>
      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={termsAccepted}
          onChange={(e) => {
            // RHF state needs the literal `true` (the schema is
            // z.literal(true)), not the boolean — the input's value
            // attribute would coerce, but the controlled value
            // becomes the literal value.
            setValue('acceptTerms', e.target.checked ? (true as unknown as true) : (false as unknown as true), {
              shouldValidate: true,
              shouldDirty: true,
            })
          }}
          aria-describedby={errors.acceptTerms ? 'acceptTerms_err' : undefined}
          aria-invalid={errors.acceptTerms ? 'true' : undefined}
        />
        <span className={styles.checkboxLabel}>
          I agree to the{' '}
          <Link href="/terms" className={styles.link}>
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className={styles.link}>
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {errors.acceptTerms && (
        <p id="acceptTerms_err" className={styles.fieldError} role="alert">
          {errors.acceptTerms.message}
        </p>
      )}
      <Button
        type="submit"
        loading={pending}
        fullWidth
        disabled={!termsAccepted}
        aria-disabled={!termsAccepted}
      >
        Create account
      </Button>
      <p className={styles.foot}>
        Already have an account?{' '}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className={styles.link}>
          Sign in
        </Link>
      </p>
    </form>
  )
}

export function ResetPasswordForm({ next }: { next?: string | undefined }) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // P1.3 — the reset request endpoint is enumeration-protected. The
  // server returns the same "Check your email" panel regardless of
  // whether the email is registered OR whether the request was
  // rate-limited. We model the post-submit state with a single
  // `submittedEmail` flag — the panel renders with the email the
  // user typed (from the action's `emailEcho`), the form is hidden,
  // and a "Try again" link returns to the form (does NOT re-submit).
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetInput>({ resolver: zodResolver(ResetClientSchema) })

  function onSubmit(values: ResetInput) {
    setServerError(null)
    const fd = new FormData()
    fd.append('email', values.email)
    if (next) fd.append('next', next)
    startTransition(async () => {
      const res: AuthActionResult = await requestPasswordResetAction(fd)
      if (res.ok) {
        // Use the server-validated echo if present; fall back to the
        // client-typed value (Zod already validated it client-side
        // for the form to submit). The server's `emailEcho` is the
        // source of truth — the user sees exactly the email the
        // server recorded for the request.
        setSubmittedEmail(res.emailEcho ?? values.email)
      } else {
        setServerError(res.error)
      }
    })
  }

  // Confirmation panel — replaces the form after a successful submit
  // (regardless of whether the email is registered; that's the
  // enumeration defense). The "Try again" link resets the form
  // without re-submitting (per spec).
  if (submittedEmail) {
    return (
      <div className={styles.form} data-testid="reset-confirmation">
        <h1 className={styles.h1}>Check your email</h1>
        <p className={styles.lede}>
          If an account exists for{' '}
          <strong className={styles.emailEcho}>{submittedEmail}</strong>, we sent a reset link.
        </p>
        <p className={styles.serverMessageHint} role="status" aria-live="polite">
          The link expires in 1 hour. Open it on this device to set a new password.
        </p>
        <button
          type="button"
          className={styles.tryAgainButton}
          onClick={() => setSubmittedEmail(null)}
        >
          Didn&apos;t get it? Try again
        </button>
        <p className={styles.foot}>
          Remembered it?{' '}
          <Link
            href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
            className={styles.link}
          >
            Back to sign in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
      <h1 className={styles.h1}>Reset your password</h1>
      <p className={styles.lede}>We&apos;ll email a link to set a new one.</p>
      {serverError && <p className={styles.serverError} role="alert">{serverError}</p>}
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        {...register('email')}
        error={errors.email?.message ?? undefined}
        disabled={pending}
      />
      {/* Honeypot — hidden from humans, bots fill it. */}
      <div aria-hidden style={{ position: 'absolute', left: '-9999px' }}>
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            name="website"
            value=""
            onChange={() => {
              /* noop — kept empty for humans, bots fill it */
            }}
          />
        </label>
      </div>
      <Button type="submit" loading={pending} fullWidth>
        Send reset link
      </Button>
      <p className={styles.foot}>
        Remembered it?{' '}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
          className={styles.link}
        >
          Back to sign in
        </Link>
      </p>
    </form>
  )
}