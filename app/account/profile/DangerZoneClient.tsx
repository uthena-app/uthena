// DangerZoneClient — small client island that owns the
// "Delete account" button + DeleteAccountModal open state. Split out
// so the rest of the page stays RSC.
'use client'

import { DeleteAccountModal } from '@features/account/profile/components/DeleteAccountModal'

export function DangerZoneClient({ email }: { email: string }) {
  return <DeleteAccountModal email={email} />
}
