// /admin landing — sends admin to the most useful page (payouts queue)
// by default. Admins can still navigate to other admin sections via the
// nav in the admin layout. This page exists so /admin has a meaningful
// landing surface instead of falling through to the [handle] catch-all
// (which renders "mini-shop not found").

import { redirect } from 'next/navigation'
import { requireRole } from '@foundations/auth/guards'

export default async function AdminLandingPage() {
  await requireRole(['admin', 'super_admin'])
  redirect('/admin/payouts')
}