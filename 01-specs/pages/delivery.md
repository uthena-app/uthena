# Delivery Policy — `/delivery`

## What this page does

The public digital delivery page. It replaces the current Shopify footer policy URL `/policies/shipping-policy`, which is a poor fit for digital PLR products. It explains instant digital access, library access, file vault downloads, signed download links, and why there is no physical shipping.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | title, last updated | markdown frontmatter | H1 + date |
| Body | delivery policy markdown | legal/content markdown | prose |
| CTA | "Go to your library" | hard-coded | link |
| SEO metadata | title, description, canonical | frontmatter | `<head>` |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open delivery | Navigate to `/delivery` | Renders policy | public |
| Open Shopify shipping policy | Navigate to `/policies/shipping-policy` | Permanent redirect to `/delivery` | public |
| Go to library | Click CTA | Navigate to `/login?next=/library` if anon, `/library` if auth | public CTA, auth for library |

## What this page does NOT do

- No shipment tracking
- No physical delivery estimate
- No file download links in the public policy
- No signed URLs in emails or on this page

## Acceptance criteria

- [ ] `/delivery` is public and indexable
- [ ] `/policies/shipping-policy` permanently redirects to `/delivery`
- [ ] The page clearly states that Uthena products are digital and delivered through `/library` and `/library/vault`
- [ ] The page states that download links are signed, expiring, and generated after login
- [ ] The page links to `/library`, `/library/vault`, `/refunds`, and `/contact`
- [ ] Schema.org `WebPage` + `Article` JSON-LD is present
- [ ] Page renders in < 100ms p95
- [ ] No placeholder markers in the diff

## Design reference

- Reuse `LegalPage` from privacy/terms.

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** N/A
- **PII displayed:** NO
- **PII in URLs:** NO
- **Audit logged:** NO
- **File access:** no files are served from this page

## Performance

- **Target p95:** < 100ms
- **Render strategy:** RSC + ISR with `revalidate = 86400`
- **Bundle size budget:** 0 KB

## Out of scope for v1

- Shipment tracking
- Public download links
- Order-specific delivery status

## Open questions for human

1. **Route label:** should the canonical public route be `/delivery` or `/shipping-policy`? My recommendation is `/delivery` because the product is digital, with `/policies/shipping-policy` redirecting to it.

---

## Implementation notes

- **P10.5 (2026-06-29) — content + canonical-render pass.** Updated
  `04-platform/emails/legal/delivery.md` to make the digital-delivery
  semantics explicit and to bring the page in line with the P10.1
  canonical-render pattern.
- **Drift vs. live `https://uthena.com/policies/shipping-policy`** —
  the live Shopify page is titled "Shipping Policy", uses imprecise
  "Last updated: September 2025", has no cross-links to other
  policies, and never mentions the library or the no-delivery-address
  fact. The v2 page fixes all of these.
- **Semantic claims added to the body**:
  - **"Instant digital access"** — explicit statement that the new
    product appears in `/library` within seconds of payment
    confirmation. The library is named as the source of truth; the
    confirmation email is reframed as a courtesy receipt.
  - **"No physical shipment"** — explicit, three-line treatment:
    no physical delivery, no shipping / handling / customs fees,
    and **no delivery address required** at checkout. The last
    bullet was previously implicit and was the most-missing piece
    for a digital-only product.
  - **Refunds** — body now cross-links to `/refund-policy` for the
    full window, EU 14-day cooling-off period, and non-refundable
    items list. (The page does not redefine the window — the live
    page is currently 7 days per `04-platform/emails/legal/refund-policy.md`;
    the 14-day figure is the EU statutory right, mentioned for
    context.)
  - **Support** — body keeps the `support@uthena.com` mailto and
    adds the request that customers include their order number and
    the checkout email to speed up resolution.
- **Render pattern mirrored from P10.1** (canonical-render checks
  for `/terms`, applied here):
  - Anchor IDs on every heading — emitted by the shared markdown
    renderer via `slugifyHeading` / `dedupeHeadingSlug` /
    `renderInlineToText`. No new code in the page.
  - Last-updated date — `<time dateTime="2026-06-29">` rendered by
    `ProsePage` from frontmatter.
  - OG + Twitter Card meta — emitted by `buildPageMetadata` in
    `app/delivery/page.tsx`. `path: '/delivery'` produces the
    canonical URL `https://uthena.com/delivery` via
    `alternates.canonical`.
  - Article JSON-LD — `Article` + `mainEntityOfPage: WebPage` in
    `app/delivery/page.tsx`, identical shape to `/terms`.
  - See-also cross-links — added to delivery.md frontmatter:
    `/terms`, `/privacy`, `/refund-policy`.
  - ISR 24h — `export const revalidate = 86400` in
    `app/delivery/page.tsx`.
- **Page-level CTA row kept** — `/login?next=/library`, `/refund-policy`,
  `/contact` buttons remain under the prose. `/terms` and `/privacy`
  cross-links are now also visible via the see-also block at the
  bottom of the prose, so the CTA row does not need to duplicate
  them.
- **Last-updated bump** — frontmatter `last_updated` advanced from
  `2025-09-08` to `2026-06-29` to match the content refresh.
- **Live URL note** — the live Shopify URL is `/policies/shipping-policy`
  (not `/policies/delivery`); `next.config.mjs` redirects
  `/policies/shipping-policy` → `/delivery` with HTTP 308.
- **No code outside `04-platform/emails/legal/delivery.md` and
  `01-specs/pages/delivery.md` needed to be changed** for the
  content + pattern pass. The existing `app/delivery/page.tsx`
  already renders all of the P10.1 metadata and the new
  frontmatter will flow through `getLegalDoc` automatically.
