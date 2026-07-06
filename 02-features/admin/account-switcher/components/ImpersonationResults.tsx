// ImpersonationResults — server component. Renders the search results
// list for the impersonation search. Reads `searchParams.q` (set by
// the search form's GET) and calls `searchUsersForImpersonation`.
// Each result row has a Switch-to-this-user button which is a tiny
// client island that calls startImpersonationAction then opens the
// returned magic link in a new tab.

import { searchUsersForImpersonation, type ImpersonatableUser } from '../queries/searchUsersForImpersonation'
import { SwitchToUserButton } from './SwitchToUserButton'
import styles from './AccountSwitcher.module.css'

export async function ImpersonationResults({ query }: { query: string }) {
  if (!query) {
    return (
      <section className={styles.resultsSection} aria-label="Search results">
        <p className={styles.muted}>
          Search by email or display name above to find a user.
        </p>
      </section>
    )
  }

  const { rows, error } = await searchUsersForImpersonation(query)

  if (error) {
    return (
      <section className={styles.resultsSection} aria-label="Search results">
        <p className={styles.errorMsg} role="alert">
          {error}
        </p>
      </section>
    )
  }

  if (rows.length === 0) {
    return (
      <section className={styles.resultsSection} aria-label="Search results">
        <p className={styles.muted}>
          No users match <strong>{query}</strong>.
        </p>
        <p className={styles.muted}>
          Try a different search, or check the spelling.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.resultsSection} aria-label="Search results">
      <p className={styles.resultsMeta}>
        {rows.length} result{rows.length === 1 ? '' : 's'}
      </p>
      <ul className={styles.resultList}>
        {rows.map((u) => (
          <li key={u.user_id} className={styles.resultRow}>
            <ResultRow user={u} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ResultRow({ user }: { user: ImpersonatableUser }) {
  return (
    <div className={styles.resultRowInner}>
      <div className={styles.resultMeta}>
        <span className={styles.resultName}>{user.display_name}</span>
        <span className={styles.resultEmail}>{user.email}</span>
        <span className={styles.resultRole} data-role={user.role}>
          {user.role}
          {user.status !== 'active' ? <> · {user.status}</> : null}
        </span>
      </div>
      <SwitchToUserButton targetUserId={user.user_id} targetLabel={user.display_name} />
    </div>
  )
}
