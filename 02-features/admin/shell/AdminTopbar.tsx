// AdminTopbar — server component. Shows the page title (slot prop), the
// environment badge, and the current admin's display_name. Environment
// is read from NEXT_PUBLIC_ENV with a 'dev' default.

import { getSessionUser } from '@foundations/auth/guards'
import styles from './AdminShell.module.css'

type EnvName = 'dev' | 'staging' | 'prod' | string

function normalizeEnv(raw: string | undefined): EnvName {
  const v = (raw ?? 'dev').toLowerCase()
  if (v === 'production' || v === 'prod') return 'prod'
  if (v === 'staging' || v === 'stage') return 'staging'
  return 'dev'
}

function envBadgeClass(env: EnvName): string {
  if (env === 'prod') return styles.envBadgeProd ?? ''
  if (env === 'staging') return styles.envBadgeStaging ?? ''
  return styles.envBadgeDev ?? ''
}

export function AdminTopbar({ title }: { title: string }) {
  const env = normalizeEnv(process.env.NEXT_PUBLIC_ENV)
  // User is guaranteed by the layout's requireRole() call. Defensive null.
  // We resolve the user async-aware: getSessionUser() returns a promise.
  // AdminTopbar is a server component, so we can await.
  return <AdminTopbarInner title={title} env={env} />
}

async function AdminTopbarInner({ title, env }: { title: string; env: EnvName }) {
  const user = await getSessionUser()
  return (
    <div className={styles.topbar}>
      <h1 className={styles.topbarTitle}>{title}</h1>
      <div className={styles.topbarRight}>
        <span
          className={[styles.envBadge, envBadgeClass(env)].join(' ')}
          aria-label={`Environment: ${env}`}
          data-testid="admin-env-badge"
        >
          {env}
        </span>
        {user && (
          <span className={styles.topbarUser}>
            Signed in as <span className={styles.topbarUserName}>{user.display_name}</span>
          </span>
        )}
      </div>
    </div>
  )
}
