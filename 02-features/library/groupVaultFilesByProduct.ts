// groupVaultFilesByProduct.ts — pure helper. Takes the flat list of
// VaultFile rows returned by getUserAccessibleFiles() and groups them
// by product so the /library "File vault" section can render an h3
// per product with the file rows underneath.
//
// P7.1 Slice 1: the previous render was a flat <ul> of files in
// product_created order (since the source query sorts by created_at
// desc). When a user owns 10 courses with 3-5 files each, the flat
// list is hard to scan — they have to read the meta line of every row
// to figure out which product it's from. The grouped shape renders
// one h3 per product (sorted by product title ascending — alphabetical
// so the user finds products fast), with the files underneath (kept
// in their original created_at desc order — newest first per product).
//
// Pure: no DB, no I/O. Inputs and outputs are both plain objects;
// callers can serialize this for tests / Storybook without setup.

import type { VaultFile } from './queries/getUserAccessibleFiles'

export type VaultGroup = {
  product_id: number
  product_title: string
  product_slug: string
  files: VaultFile[]
}

export function groupVaultFilesByProduct(files: VaultFile[]): VaultGroup[] {
  // Build an insertion-ordered map keyed by product_id so the first
  // sighting of each product determines the group order in the output.
  const order: number[] = []
  const byId = new Map<number, VaultGroup>()

  for (const file of files) {
    let group = byId.get(file.product_id)
    if (!group) {
      group = {
        product_id: file.product_id,
        product_title: file.product_title,
        product_slug: file.product_slug,
        files: [],
      }
      byId.set(file.product_id, group)
      order.push(file.product_id)
    }
    group.files.push(file)
  }

  // Sort groups by product_title (case-insensitive) for stable scanning.
  // The file list inside each group is intentionally NOT re-sorted —
  // callers get to keep whatever order the source query produced
  // (currently created_at desc from getUserAccessibleFiles).
  return order
    .map((id) => byId.get(id)!)
    .sort((a, b) =>
      a.product_title.localeCompare(b.product_title, 'en', { sensitivity: 'base' }),
    )
}