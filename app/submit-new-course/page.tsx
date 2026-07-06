// /submit-new-course — auth-gated URL alias for /partner/upload.
//
// P12.7 Slice 1 — spec line 9 + 49: "Approved partners who visit
// either clean or legacy URL must land in the relevant v2 partner
// upload or course-edit flow instead of seeing a 404."
//
// The chain:
//   /pages/submit-new-course (legacy Shopify URL)
//     → 308 permanent redirect to /submit-new-course (next.config.mjs)
//   /submit-new-course (clean top-level URL — this page)
//     → auth-gated dispatch:
//         - anon → /signup?next=/partner/upload (spec line 35-36's
//           "signup is the canonical entry for new partners")
//         - signed-in, no partner row → /partner/onboarding (start the
//           partner application so they can become a partner first)
//         - signed-in, partners.status IN ('pending', 'suspended') →
//           /partner/onboarding (continue or restart the application)
//         - signed-in, partners.status='approved' → /partner/upload
//
// Why this is a separate RSC page and not a `next.config.mjs`
// redirect: the auth gate + partner-state branch need server-side
// reads, which only an RSC page can do. The legacy `/pages/...` URL
// redirects to THIS page; this page redirects to the partner flow.

import { redirect } from 'next/navigation'
import { getSessionUser } from '@foundations/auth/guards'
import { getMyPartnerApplicationStatus } from '@features/partner-onboarding/queries/getMyPartnerApplicationStatus'

export const dynamic = 'force-dynamic'

export default async function SubmitNewCourseAlias() {
  const user = await getSessionUser()
  if (!user) {
    // Anon → signup with next= preserving the eventual landing page.
    // The /signup page reads ?next= and forwards after email confirm.
    redirect(`/signup?next=${encodeURIComponent('/partner/upload')}`)
  }

  // Check partner status. RLS on `partners` allows self-select;
  // we never use the service-role client. The 4-state shape mirrors
  // /partner/onboarding's branch logic (P12.1).
  const state = await getMyPartnerApplicationStatus()
  if (state.kind === 'none' || state.kind === 'suspended') {
    // No partner row yet (or previously suspended) → start (or restart)
    // the onboarding wizard. The wizard handles both.
    redirect('/partner/onboarding')
  }

  // approved + pending both land in the upload wizard. Pending partners
  // can start a draft (the wizard itself accepts any partner role via
  // `requirePartner()`); admin review waits until they're approved.
  // The wizard's spec line 104 is explicit: "even pending partners can
  // upload, but their upload won't be reviewed until they're approved".
  redirect('/partner/upload')
}
