// tiptapDocToText — convert a TipTap JSONB doc (the shape stored in
// `products.long_description`) into the plain-text form a partner
// would type into the Settings textarea. Used by:
//   - `updateProductSettingsAction` to compare the existing doc's
//     text against the new input for change detection
//   - `CourseSettingsForm` to hydrate the textarea with the
//     existing content when the page first renders
//
// Inverse of `buildLongDescriptionDoc` (action file): we walk the
// doc tree, extract text nodes, and join paragraphs with `\n\n`.
//
// Defensive: unknown shapes fall back to ''. The mirror of the
// storefront's `parseTipTapDoc` (00-foundations/data/schemas.ts)
// accepts "valid doc" or "empty", not "garbage" — this helper
// mirrors that contract.

export function tiptapDocToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  const root = doc as { type?: string; content?: unknown }
  if (root.type !== 'doc' || !Array.isArray(root.content)) return ''
  const out: string[] = []
  for (const node of root.content) {
    if (!node || typeof node !== 'object') continue
    const n = node as { type?: string; content?: unknown }
    if (n.type === 'paragraph' && Array.isArray(n.content)) {
      const texts: string[] = []
      for (const child of n.content) {
        if (child && typeof child === 'object' && (child as { type?: string }).type === 'text') {
          const t = (child as { text?: unknown }).text
          if (typeof t === 'string') texts.push(t)
        }
      }
      out.push(texts.join(''))
    }
  }
  return out.join('\n\n')
}