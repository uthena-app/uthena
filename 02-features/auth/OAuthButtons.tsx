// OAuth buttons (P1.6 — Google + Apple).
//
// What this renders:
//   - A horizontal "or" divider (rendered above the buttons when
//     at least one provider is enabled).
//   - One form per enabled provider, each with a hidden
//     `provider` field + an optional `next` field. The form
//     action is the P1.6 `signInWithOAuthAction` from
//     `../actions`.
//
// What this does NOT render:
//   - Client-side JavaScript. The buttons are pure server components
//     that emit a plain HTML form per provider. The browser POSTs
//     to the server action, which redirects to the provider's
//     consent screen. Zero client JS, zero bundle cost beyond the
//     HTML itself.
//
// Why a server component (not a client island):
//   - The OAuth init is a one-shot POST that ends in a redirect.
//     There's no state to manage on the client, no input to
//     collect, no validation to show inline. A client component
//     would only add bundle weight.
//   - The form's `action={signInWithOAuthAction}` attribute is a
//     server-rendered React feature — Next.js turns it into a
//     standard HTML `<form action="...">` POST. The browser
//     handles the redirect natively.
//
// Why hidden `provider` + `next` fields (and not URL params):
//   - The action signature is `signInWithOAuthAction(formData)`.
//     Form data is the standard server-action contract.
//   - The `next` field carries the post-auth destination through
//     the entire OAuth round-trip (form → action → provider →
//     callback → final page). Encoding it as a hidden field is
//     the canonical pattern.

import type { OAuthProvider } from '@foundations/auth/oauth'
import { signInWithOAuthAction } from './actions'
import styles from './OAuthButtons.module.css'

export function OAuthButtons({
  providers,
  next,
}: {
  providers: OAuthProvider[]
  next?: string | undefined
}) {
  if (providers.length === 0) return null

  return (
    <div className={styles.wrap}>
      <div className={styles.stack}>
        {providers.map((p) => (
          <form key={p.id} action={signInWithOAuthAction} className={styles.form}>
            <input type="hidden" name="provider" value={p.id} />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <button
              type="submit"
              className={[
                styles.button,
                p.id === 'apple' ? styles.buttonApple : styles.buttonGoogle,
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={p.label}
            >
              <span className={styles.monogram} aria-hidden="true">
                {p.monogram}
              </span>
              <span className={styles.label}>{p.label}</span>
            </button>
          </form>
        ))}
      </div>
      <div className={styles.divider} role="separator" aria-label="or">
        <span className={styles.dividerLabel}>or</span>
      </div>
    </div>
  )
}
