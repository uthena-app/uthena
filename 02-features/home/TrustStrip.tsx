// TrustStrip — the 3 numbered "how it works" cells below the hero.
// Mockup-faithful to `mockups/home.html` lines 85–89. The id
// `how-it-works` makes the Hero's "How it works" CTA a real anchor
// (instead of a dead link) without needing client-side JS.

import { TRUST_STRIP } from './copy'
import styles from './TrustStrip.module.css'

export function TrustStrip() {
  return (
    <section
      id="how-it-works"
      className={styles.trust}
      aria-labelledby="how-it-works-h"
    >
      <h2 id="how-it-works-h" className="srOnly">
        How it works
      </h2>
      {TRUST_STRIP.map((step) => (
        <div key={step.num} className={styles.cell}>
          <div className={styles.num}>{step.num}</div>
          <div>
            <h4 className={styles.title}>{step.title}</h4>
            <p className={styles.body}>{step.body}</p>
          </div>
        </div>
      ))}
    </section>
  )
}
