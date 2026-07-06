// UI primitives — minimal, all use design tokens. No third-party
// component library (per AGENTS.md ADR-0006). Add a new primitive here
// only when 2+ features need it.

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import styles from './primitives.module.css'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, iconLeft, iconRight, fullWidth, className, children, disabled, ...rest },
  ref,
) {
  const cls = [
    styles.btn,
    styles[`btn_${variant}`],
    styles[`size_${size}`],
    fullWidth ? styles.fullWidth : '',
    loading ? styles.loading : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button ref={ref} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {iconLeft && <span className={styles.icon}>{iconLeft}</span>}
      <span className={styles.btnLabel}>{children}</span>
      {iconRight && <span className={styles.icon}>{iconRight}</span>}
    </button>
  )
})

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  hint?: string | undefined
  error?: string | undefined
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const inputId = id ?? `inp_${Math.random().toString(36).slice(2, 9)}`
  return (
    <div className={styles.field}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={[styles.input, error ? styles.inputError : '', className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${inputId}_err` : hint ? `${inputId}_hint` : undefined}
        {...rest}
      />
      {error && (
        <p id={`${inputId}_err`} className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${inputId}_hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  )
})
