// `00-foundations/structured-data` — JSON-LD structured data for SEO.
//
// Three pure schema builders + one render component. Pages compose
// the builders, drop the data into `<JsonLd>`, and the server emits
// `<script type="application/ld+json">` tags in the initial HTML.
//
// Why a separate module from `00-foundations/metadata/`.
//   - `metadata` returns Next.js `Metadata` objects (typed, no
//     React component imports).
//   - `structured-data` returns plain JSON-serializable objects
//     + a `<JsonLd>` React component.
//   - Keeping them separate avoids forcing `metadata` to import
//     a React component, which would break the server-only type
//     contract some pages rely on.
//
// Usage:
//   // Organization — site-wide, in the root layout
//   import { JsonLd, buildOrganizationSchema } from '@foundations/structured-data'
//   <JsonLd data={buildOrganizationSchema()} />
//
//   // BreadcrumbList — per-page
//   import { buildBreadcrumbSchema } from '@foundations/structured-data'
//   <JsonLd data={buildBreadcrumbSchema([
//     { name: 'Home', path: '/' },
//     { name: 'Browse', path: '/browse' },
//     { name: product.category.name, path: `/collections/${product.category.slug}` },
//     { name: product.title, path: `/products/${product.slug}` },
//   ])} />
//
//   // Product — on /products/[slug]
//   import { buildProductSchema } from '@foundations/structured-data'
//   <JsonLd data={buildProductSchema(product)} />

export {
  buildOrganizationSchema,
  type OrganizationSchema,
} from './buildOrganizationSchema'

export {
  buildBreadcrumbSchema,
  type BreadcrumbItem,
  type BreadcrumbListSchema,
} from './buildBreadcrumbSchema'

export {
  buildProductSchema,
  type ProductSchema,
  type ProductSchemaInput,
} from './buildProductSchema'

export {
  buildPersonSchema,
  type PersonSchema,
  type PersonSchemaInput,
} from './buildPersonSchema'

export { JsonLd, type JsonLdInput } from './JsonLd'