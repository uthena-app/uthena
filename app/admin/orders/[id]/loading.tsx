// /admin/orders/[id] — loading skeleton. Mirrors the page shape:
// breadcrumb + order header + tab nav + 6-card overview grid +
// refunds + events. Pure RSC, no client JS.

import { Skeleton } from '@foundations/ui/primitives/Skeleton'

export default function AdminOrderDetailLoading() {
  return (
    <div aria-busy="true" aria-label="Loading…">
      <div style={{ marginBottom: 12 }}>
        <Skeleton width={140} height={14} radius={6} ariaLabel="" />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Skeleton width={240} height={28} radius={8} ariaLabel="" />
        <div style={{ marginTop: 6 }}>
          <Skeleton width={360} height={14} radius={6} ariaLabel="" />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--line, rgba(0, 0, 0, 0.08))',
          marginBottom: 24,
        }}
        aria-hidden="true"
      >
        <Skeleton width={80} height={32} radius={6} ariaLabel="" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 20,
          marginBottom: 24,
        }}
        aria-hidden="true"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            style={{
              border: '1px solid var(--line, rgba(0, 0, 0, 0.08))',
              borderRadius: 8,
              padding: '16px 20px',
            }}
          >
            <Skeleton width="40%" height={18} radius={6} ariaLabel="" />
            <div style={{ marginTop: 12 }}>
              {Array.from({ length: 5 }, (_, j) => (
                <div
                  key={j}
                  style={{ marginBottom: 8, display: 'flex', gap: 12 }}
                >
                  <Skeleton width={120} height={14} radius={6} ariaLabel="" />
                  <Skeleton width="60%" height={14} radius={6} ariaLabel="" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          border: '1px solid var(--line, rgba(0, 0, 0, 0.08))',
          borderRadius: 8,
          padding: '16px 20px',
        }}
        aria-hidden="true"
      >
        <Skeleton width={140} height={18} radius={6} ariaLabel="" />
        <div style={{ marginTop: 12 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              style={{ marginBottom: 8, display: 'flex', gap: 12 }}
            >
              <Skeleton width={80} height={14} radius={6} ariaLabel="" />
              <Skeleton width={180} height={14} radius={6} ariaLabel="" />
              <Skeleton width="40%" height={14} radius={6} ariaLabel="" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
