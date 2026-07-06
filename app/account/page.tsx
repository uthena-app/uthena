// Account overview — landing page after login. RSC.

import type { Metadata } from 'next'
import { requireUser } from '@foundations/auth/guards'
import { getServerSupabase } from '@foundations/data/supabase'
import Link from 'next/link'
import { sensitivePageMetadata } from '@foundations/metadata'
import styles from './overview.module.css'

// P0.21 — `noindex` so the account overview isn't indexed.
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Overview',
  description: 'Your Uthena account overview.',
  path: '/account',
})

export default async function AccountOverviewPage() {
  const user = await requireUser('/account')
  const supabase = await getServerSupabase()

  // A few KPIs to make the page useful from day one.
  const [{ count: orderCount }, { count: libraryCount }] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase
      .from('library_grants')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('revoked_at', null),
  ])

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Welcome back, {user.display_name}</h1>
        <p className={styles.lede}>Your account at a glance.</p>
      </header>

      <section className={styles.kpis}>
        <KpiCard label="Orders" value={orderCount ?? 0} href="/account/orders" />
        <KpiCard label="Library items" value={libraryCount ?? 0} href="/account/library" />
        <KpiCard
          label="Role"
          value={user.role.replace('_', ' ')}
          href={
            user.role === 'partner' || user.role === 'admin' || user.role === 'super_admin'
              ? '/partner'
              : user.role === 'affiliate'
                ? '/affiliate'
                : '/account/profile'
          }
        />
      </section>

      <section className={styles.empty}>
        <h2 className={styles.h2}>Get started</h2>
        <p className={styles.body}>
          Browse the catalog to find a course or digital asset. Once you buy, the file lands in
          your <Link href="/account/library" className={styles.link}>Library</Link>.
        </p>
        <p className={styles.body}>
          Want the whole library plus a 15% discount on every PLR license? Subscribe to{' '}
          <Link href="/account/subscription" className={styles.link}>
            Personal Access
          </Link>{' '}
          for $19/mo.
        </p>
      </section>
    </div>
  )
}

function KpiCard({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href} className={styles.kpiCard}>
      <p className={styles.kpiLabel}>{label}</p>
      <p className={styles.kpiValue}>{value}</p>
    </Link>
  )
}
