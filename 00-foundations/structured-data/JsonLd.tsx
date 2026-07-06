// JsonLd — server component that renders a JSON-LD `<script>` tag.
//
// Why a single component for every schema type.
//   - The script tag is the same regardless of payload; the only
//     difference is the JSON. Centralizing the rendering avoids
//     drift between schemas.
//   - The `</` escape is the standard recommendation from
//     Google's docs ("Structure your data > General guidelines >
//     Required properties > Tag your structured data"). Keeping
//     it in one place means a future schema type can't forget
//     it.
//
// Why a server component (no `'use client'`).
//   - The component returns a single `<script>` tag. It has no
//     interactivity, no state, no effects. Server-rendering is
//     the cheapest path.
//   - The `<script type="application/ld+json">` payload is parsed
//     by crawlers, NOT executed by the browser's JS engine.
//     Rendering it on the server means it's part of the initial
//     HTML payload (no client JS overhead).
//
// Usage:
//   import { JsonLd, buildOrganizationSchema } from '@foundations/structured-data'
//
//   export default function Layout({ children }) {
//     return (
//       <html>
//         <body>
//           <JsonLd data={buildOrganizationSchema()} />
//           {children}
//         </body>
//       </html>
//     )
//   }

import type { JSX } from 'react'

/** The component accepts either a single schema object or an
 *  array of schemas. Pages that emit multiple schemas (Product
 *  + BreadcrumbList on the product detail page) pass an array.
 *  Each schema becomes its own `<script>` tag so crawlers can
 *  parse each one independently — combining multiple `@graph`
 *  schemas into a single script tag is allowed by schema.org but
 *  is harder to debug and harder to selectively update later. */
export type JsonLdInput = Record<string, unknown> | Array<Record<string, unknown>>

/** Escape `</` sequences in the JSON payload to prevent script-
 *  tag injection. The escape replaces every literal `</` with
 *  `<\/` so a malicious string can't close the surrounding
 *  `<script>` tag. Defensive — our data is server-controlled,
 *  but the escape is the standard recommendation. */
function escapeScriptClose(json: string): string {
  return json.replace(/<\//g, '<\\/')
}

/** Render a single `<script type="application/ld+json">` tag
 *  containing the JSON-stringified payload. Server component.
 *
 *  The `dangerouslySetInnerHTML` is the standard React pattern
 *  for injecting raw HTML — required here because the JSON-LD
 *  payload is a data island, not parsed or executed by the
 *  browser. The `</` escape above is the only defense against
 *  a malicious payload closing the script tag early. */
export function JsonLd({ data }: { data: JsonLdInput }): JSX.Element {
  const json = escapeScriptClose(JSON.stringify(data))
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}