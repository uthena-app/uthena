// PartnerActionRail.tsx — the right-rail action panel on
// /admin/partners/[id]. Renders the status-aware CTA for the
// partner's current `status` value:
//
//   pending   → "Approve partner" (opens ApprovePartnerModal)
//   approved  → "Suspend partner" (opens SuspendPartnerModal)
//   suspended → "Unsuspend partner" (opens UnsuspendPartnerModal)
//
// The rail is a 'use client' island because the modals it hosts are
// client-only. The page renders the rail inline so the right-rail
// stays sticky on desktop (≥ 1024px) and stacks below the main
// column on mobile.
//
// Spec: admin-partner-detail.md lines 5, 38-40, 71, 99. The
// right-rail pattern matches the design brief ("sticky on desktop,
// drawer on mobile").

'use client'

import { useState } from 'react'
import type { PartnerStatus } from '../types'
import { PARTNER_STATUS_LABEL } from '../types'
import { ApprovePartnerModal } from './ApprovePartnerModal'
import { SuspendPartnerModal } from './SuspendPartnerModal'
import { UnsuspendPartnerModal } from './UnsuspendPartnerModal'
import styles from './PartnerActionRail.module.css'

type ActiveModal = null | 'approve' | 'suspend' | 'unsuspend'

export function PartnerActionRail({
  partnerId,
  partnerDisplayName,
  status,
}: {
  partnerId: number
  partnerDisplayName: string
  status: PartnerStatus
}) {
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)

  return (
    <aside className={styles.rail} aria-label="Partner actions">
      <div className={styles.railInner}>
        <h2 className={styles.heading}>Status</h2>
        <p className={styles.status}>
          Current status:{' '}
          <span className={styles.statusValue}>
            {PARTNER_STATUS_LABEL[status]}
          </span>
        </p>

        <hr className={styles.divider} />

        <h2 className={styles.heading}>Actions</h2>

        {status === 'pending' ? (
          <button
            type="button"
            onClick={() => setActiveModal('approve')}
            className={`${styles.cta} ${styles.ctaApprove}`}
          >
            Approve partner
          </button>
        ) : null}

        {status === 'approved' ? (
          <button
            type="button"
            onClick={() => setActiveModal('suspend')}
            className={`${styles.cta} ${styles.ctaSuspend}`}
          >
            Suspend partner
          </button>
        ) : null}

        {status === 'suspended' ? (
          <button
            type="button"
            onClick={() => setActiveModal('unsuspend')}
            className={`${styles.cta} ${styles.ctaUnsuspend}`}
          >
            Unsuspend partner
          </button>
        ) : null}

        <hr className={styles.divider} />

        <p className={styles.helpText}>
          Each action requires a typed confirmation. Approval email
          notifications to the partner are queued automatically (when
          the email pipeline ships in Phase 17).
        </p>
      </div>

      {activeModal === 'approve' ? (
        <ApprovePartnerModal
          partnerId={partnerId}
          partnerDisplayName={partnerDisplayName}
          onClose={() => setActiveModal(null)}
        />
      ) : null}

      {activeModal === 'suspend' ? (
        <SuspendPartnerModal
          partnerId={partnerId}
          partnerDisplayName={partnerDisplayName}
          onClose={() => setActiveModal(null)}
        />
      ) : null}

      {activeModal === 'unsuspend' ? (
        <UnsuspendPartnerModal
          partnerId={partnerId}
          partnerDisplayName={partnerDisplayName}
          onClose={() => setActiveModal(null)}
        />
      ) : null}
    </aside>
  )
}