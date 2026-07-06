// Public surface for the `legal` feature. Pages import from here.

export { ProsePage } from './components/ProsePage'
export { ContactForm } from './components/ContactForm'
export { OptOutForm } from './components/OptOutForm'
export { FaqAccordion } from './components/FaqAccordion'
export { DmcaAgentCard } from './components/DmcaAgentCard'

export {
  getLegalDoc,
  readLegalFile,
  parseFrontmatter,
  renderMarkdown,
  slugifyHeading,
  renderInlineToText,
  dedupeHeadingSlug,
} from './queries/getLegalMarkdown'
export type { LegalDoc, LegalFrontmatter } from './queries/getLegalMarkdown'

export { getDmcaAgent } from './queries/getDmcaAgent'
export type { DmcaAgentContact } from './queries/getDmcaAgent'

export { listFaqs } from './queries/listFaqs'
export type { FaqEntry, FaqGroup } from './queries/listFaqs'

export { CONTACT_OPTIONS, COMPANY_INFO } from './queries/getContactOptions'
export type { ContactOption } from './queries/getContactOptions'