// AddCategoryButton.tsx — small client component that opens the
// AddCategoryModal in a controlled way.

'use client'

import { useState } from 'react'
import { Button } from '@foundations/ui/primitives/Button'
import { AddCategoryModal } from './AddCategoryModal'
import type { ParentOption } from '../types'

export function AddCategoryButton({ parents }: { parents: ParentOption[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
        + Add top-level category
      </Button>
      {open && <AddCategoryModal parents={parents} onClose={() => setOpen(false)} />}
    </>
  )
}
