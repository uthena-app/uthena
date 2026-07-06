// FaqAccordion.tsx — client-side accordion for the FAQ page. One
// question per row. Keyboard accessible (aria-expanded,
// aria-controls, Enter / Space toggles). The list is rendered from
// the grouped FAQ source (see `queries/listFaqs.ts`).
//
// We use the native <details> / <summary> pattern underneath. It
// is keyboard-accessible by default, no JS required to expand a row.
// This component's job is to wrap a richer <details> with our
// design-system styles and a smooth disclosure affordance.

'use client'

import { useId, useState, type KeyboardEvent } from 'react'
import type { FaqGroup } from '../queries/listFaqs'
import styles from './FaqAccordion.module.css'

type Props = {
  groups: FaqGroup[]
  /** Allow multiple rows open at once (default true). */
  allowMultiple?: boolean
}

/**
 * Renders groups of FAQs as accordions. Uses native <details> for
 * accessibility (keyboard support, focus styles, screen-reader
 * announcement) and applies our visual style on top.
 */
export function FaqAccordion({ groups, allowMultiple = true }: Props) {
  if (groups.length === 0) {
    return (
      <p className={styles.empty}>
        No FAQs yet. Check back soon, or <a href="/contact">contact us</a> with your question.
      </p>
    )
  }
  return (
    <div className={styles.wrap}>
      {groups.map((g) => (
        <FaqGroup key={g.group} group={g} allowMultiple={allowMultiple} />
      ))}
    </div>
  )
}

function FaqGroup({ group, allowMultiple }: { group: FaqGroup; allowMultiple: boolean }) {
  return (
    <section className={styles.group} aria-labelledby={`faq-group-${group.group}`}>
      <h2 id={`faq-group-${group.group}`} className={styles.groupH}>
        {group.group}
      </h2>
      <div className={styles.items}>
        {group.entries.map((entry, i) => (
          <FaqItem
            key={entry.slug}
            slug={entry.slug}
            indexInGroup={i}
            question={entry.question}
            allowMultiple={allowMultiple}
          >
            {entry.answer}
          </FaqItem>
        ))}
      </div>
    </section>
  )
}

type ItemProps = {
  slug: string
  indexInGroup: number
  question: string
  children: React.ReactNode
  allowMultiple: boolean
}

function FaqItem({ slug, question, children, allowMultiple }: ItemProps) {
  const [open, setOpen] = useState(false)
  const reactId = useId()
  const panelId = `${reactId}-panel`
  const buttonId = `${reactId}-button`

  const onKeyDown = (ev: KeyboardEvent<HTMLButtonElement>) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      if (allowMultiple) setOpen((v) => !v)
      else setOpen(true)
    }
  }

  return (
    <div className={styles.item} data-open={open || undefined}>
      <button
        type="button"
        id={buttonId}
        className={styles.q}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className={styles.qText}>{question}</span>
        <span className={styles.qChevron} aria-hidden>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        className={styles.a}
        hidden={!open}
      >
        <div className={styles.aInner}>{children}</div>
      </div>
    </div>
  )
}
