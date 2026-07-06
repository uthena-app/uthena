// FaqSection — the home page's FAQ accordion. Uses the native
// `<details>` / `<summary>` pattern (matches the mockup, keyboard
// accessible by default, no JS required). The home FAQ is a
// hand-picked subset of the canonical FAQ; P10.8 swaps it for the
// live admin-editable list.

import { HOME_FAQ } from './copy'
import styles from './FaqSection.module.css'

export function FaqSection() {
  return (
    <section className={styles.sec} aria-labelledby="faq-h">
      <div className={styles.secHead}>
        <div>
          <div className={styles.eyebrow}>Questions</div>
          <h2 id="faq-h" className={styles.h2}>
            Frequently asked
          </h2>
        </div>
      </div>
      <div className={styles.faq}>
        {HOME_FAQ.map((item, i) => (
          <details key={item.q} className={styles.row} open={i === 0}>
            <summary className={styles.summary}>
              <span>{item.q}</span>
              <span className={styles.marker} aria-hidden="true" />
            </summary>
            <p className={styles.answer}>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
