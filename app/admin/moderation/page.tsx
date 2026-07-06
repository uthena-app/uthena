// /admin/moderation — content moderation queue.
//
// Reads flagged reviews + flagged products via
// `getContentModerationQueue`. Renders the server-component queue
// with per-item action buttons (approve/reject/clear-flag for reviews,
// publish/draft/archive for products).

import { AdminShell } from '@features/admin'
import {
  ContentModerationQueue,
} from '@features/admin/platform-settings/components/ContentModerationQueue'

export const dynamic = 'force-dynamic'

export default async function AdminModerationPage() {
  return (
    <AdminShell title="Content moderation">
      <ContentModerationQueue />
    </AdminShell>
  )
}
