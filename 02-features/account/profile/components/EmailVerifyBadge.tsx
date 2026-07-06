// EmailVerifyBadge — server component. Renders a "Verified" or
// "Unverified" chip. The unverified state shows a "Resend" button
// rendered as a client island (EmailVerifyButton). The button reads
// the user's email from the session inside the server action
// (resendVerificationEmailAction), so we don't pass the email down
// as a prop — the user's own email is the only safe source and
// it's already in the session.
import { EmailVerifyButton } from './EmailVerifyButton'
import styles from './EmailVerifyBadge.module.css'

export function EmailVerifyBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <span className={`${styles.chip} ${styles.verified}`} aria-label="Email verified">
        <span className={styles.dot} aria-hidden />
        Verified
      </span>
    )
  }
  return (
    <span className={`${styles.chip} ${styles.unverified}`} aria-label="Email not verified">
      <span className={styles.dot} aria-hidden />
      <span className={styles.unverifiedText}>Unverified</span>
      <EmailVerifyButton />
    </span>
  )
}
