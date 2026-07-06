// `00-foundations/metadata` — single source of truth for Next.js
// page metadata. Pages import `buildPageMetadata` (or
// `sensitivePageMetadata` for authenticated / sensitive surfaces)
// and pass a small object with the page's title, description,
// path, and optional image. The helper emits the full Metadata
// shape including canonical URL, OpenGraph, and Twitter Card
// fields so every page renders a correct social-share preview
// without hand-rolling the same boilerplate 30+ times.

export {
  buildPageMetadata,
  sensitivePageMetadata,
  SITE_NAME,
  SITE_ORIGIN,
  SITE_LOCALE,
  OG_IMAGE_GENERATOR_PATH,
  DEFAULT_OG_IMAGE,
  type PageMetadataInput,
} from './buildPageMetadata'