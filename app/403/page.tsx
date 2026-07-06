// 403 — shown when a user is logged in but the role doesn't match.
// Distinct from 401 (logged out) and 404 (route doesn't exist).
import Link from 'next/link'
import type { Metadata } from 'next'
import { Button } from '@foundations/ui/primitives/Button'
import { sensitivePageMetadata } from '@foundations/metadata'

// P0.21 — `noindex` (403 isn't canonical content).
export const metadata: Metadata = sensitivePageMetadata({
  title: 'Forbidden',
  description: 'You do not have access to this page.',
  path: '/403',
})

export default function ForbiddenPage() {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        padding: '48px 24px',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontSize: 12,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-3)',
          marginBottom: 8,
        }}
      >
        403
      </p>
      <h1 style={{ fontSize: 32, color: 'var(--heading)', marginBottom: 12 }}>
        You don&apos;t have access to this page.
      </h1>
      <p style={{ color: 'var(--text-2)', maxWidth: 480, marginBottom: 24 }}>
        If you think this is a mistake, contact us at <Link href="/contact">/contact</Link>.
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <Link href="/">
          <Button variant="secondary">Go home</Button>
        </Link>
        <Link href="/account">
          <Button>My account</Button>
        </Link>
      </div>
    </main>
  )
}
