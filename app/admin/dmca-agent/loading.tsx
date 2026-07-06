// /admin/dmca-agent loading — RSC fallback mirroring the page shape.

import { AdminShell } from '@features/admin'

export default function Loading() {
  return (
    <AdminShell title="DMCA designated agent">
      <div
        style={{
          maxWidth: 720,
          color: 'var(--text-2)',
          fontSize: '14px',
          padding: '32px 0',
        }}
        aria-busy="true"
      >
        Loading the current DMCA agent contact…
      </div>
    </AdminShell>
  )
}