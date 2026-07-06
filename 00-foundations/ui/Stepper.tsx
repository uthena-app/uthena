// Stepper — multi-step wizard navigation. Token-only. RSC.
//
// Pure presentation. No business logic, no state — the parent owns the
// current-step state (URL param, cookie, server-side session) and
// passes `currentStep` in. This keeps the component dumb and reusable
// across the checkout wizard (P4.7), partner onboarding (P12.1), and
// any future surface that needs a step indicator.
//
// Accessibility: rendered as an `<ol>` so screen readers announce the
// ordered list + position. The active step carries `aria-current="step"`
//; the step circles also expose the state via a visually-hidden
// " (current)" / " (done)" suffix on their text labels so non-visual
// users hear the same context sighted users see. The whole bar is
// `aria-label="Checkout progress"`-able via the `ariaLabel` prop.

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import styles from './Stepper.module.css'

export type StepperStep = {
  /** Stable id used to identify the step in the parent's state. */
  id: string
  /** Short, plain-language step label (1–4 words). */
  label: string
  /** Optional one-line description rendered under the label. */
  description?: string
}

export type StepperProps = HTMLAttributes<HTMLOListElement> & {
  /** The ordered list of steps. */
  steps: readonly StepperStep[]
  /** The id of the active step. Must match one of `steps`. */
  currentStep: string
  /** Steps marked as already completed. Defaults to all steps before
   *  `currentStep`. Pass explicitly when a step can be skipped. */
  completedSteps?: readonly string[]
  /** Layout orientation. Default: 'horizontal' (the checkout / wizard
   *  pattern). Use 'vertical' for narrow sidebars. */
  orientation?: 'horizontal' | 'vertical'
  /** ARIA label override for the `<ol>`. */
  ariaLabel?: string
  /** Optional slot to render between the stepper and the page body —
   *  e.g. a "Save and continue" toolbar on the right edge of a
   *  horizontal stepper. */
  trailing?: ReactNode
}

export const Stepper = forwardRef<HTMLOListElement, StepperProps>(function Stepper(
  {
    steps,
    currentStep,
    completedSteps,
    orientation = 'horizontal',
    ariaLabel = 'Progress',
    trailing,
    className,
    ...rest
  },
  ref,
) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep)
  const completedSet = new Set(
    completedSteps ?? steps.slice(0, currentIndex < 0 ? 0 : currentIndex).map((s) => s.id),
  )
  const cls = [
    styles.list,
    styles[`o_${orientation}`],
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={styles.shell}>
      <ol ref={ref} className={cls} aria-label={ariaLabel} {...rest}>
        {steps.map((step, idx) => {
          const isCurrent = step.id === currentStep
          const isCompleted = completedSet.has(step.id)
          const isUpcoming = !isCurrent && !isCompleted
          const stateLabel = isCurrent ? 'current' : isCompleted ? 'done' : 'upcoming'
          const itemCls = [
            styles.item,
            isCurrent ? styles.itemCurrent : '',
            isCompleted ? styles.itemDone : '',
            isUpcoming ? styles.itemUpcoming : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <li
              key={step.id}
              className={itemCls}
              aria-current={isCurrent ? 'step' : undefined}
              data-state={stateLabel}
            >
              <span className={styles.bubble} aria-hidden="true">
                {isCompleted ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 8 7 12 13 4" />
                  </svg>
                ) : (
                  <span className={styles.bubbleNum}>{idx + 1}</span>
                )}
              </span>
              <span className={styles.text}>
                <span className={styles.label}>{step.label}</span>
                <span className={styles.srOnly}> ({stateLabel})</span>
                {step.description && <span className={styles.desc}>{step.description}</span>}
              </span>
              {idx < steps.length - 1 && (
                <span className={styles.connector} aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
      {trailing && <div className={styles.trailing}>{trailing}</div>}
    </div>
  )
})