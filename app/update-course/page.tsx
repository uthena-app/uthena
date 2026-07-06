// /update-course — auth-gated URL alias for /partner/courses.
//
// P12.7 Slice 1 — spec line 9 + 49: "Approved partners who visit
// either clean or legacy URL must land in the relevant v2 partner
// upload or course-edit flow instead of seeing a 404."
//
// The chain:
//   /pages/update-course (legacy Shopify URL)
//     → 308 permanent redirect to /update-course (next.config.mjs)
//   /update-course (clean top-level URL — this page)
//     → auth-gated dispatch:
//         - anon → /login?next=/partner/courses (preserving eventual
//           landing page)
//         - signed-in, no partner row → /partner/onboarding
//         - signed-in, partners.status IN ('pending', 'suspended') →
//           /partner/onboarding
//         - signed-in, partners.status='approved' → /partner/courses
//           (the courses list — partners click into a course to edit)
//
// Why a separate RSC page: the auth gate + partner-state branch need
// server-side reads, which only an RSC page can do.

import { redirect } from 'next/navigation'
import { getSessionUser } from '@foundations/auth/guards'
import { getMyPartnerApplicationStatus } from '@features/partner-onboarding/queries/getMyPartnerApplicationStatus'

export const dynamic = 'force-dynamic'

export default async function UpdateCourseAlias() {
  const user = await getSessionUser()
  if (!user) {
    redirect(`/login?next=${encodeURIComponent('/partner/courses')}`)
  }

  const state = await getMyPartnerApplicationStatus()
  if (state.kind === 'none' || state.kind === 'suspended') {
    redirect('/partner/onboarding')
  }

  // approved + pending → /partner/courses (the courses list, which
  // is partner-gated). Pending partners see the list but their
  // existing drafts / courses still render.
  redirect('/partner/courses')
}
