# Data Sharing Opt-Out — `/data-sharing-opt-out`

## What this page does

The public privacy opt-out page for users who want to opt out of data sale, sharing, targeted advertising, or similar privacy choices where applicable. It replaces the current Shopify page URL `/pages/data-sharing-opt-out` with the clean canonical URL `/data-sharing-opt-out`.

The page explains the available privacy choices in plain language, links to `/privacy`, and gives users a clear email or authenticated settings path to make the request. It does not create a full privacy-preference center in v1.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | title, short explanation | legal/privacy markdown | H1 + prose |
| Choices | opt-out categories, what they mean, how to request | legal/privacy markdown | list |
| Request CTA | privacy contact email and authenticated account-settings link | config | buttons/links |
| SEO metadata | title, description, canonical | route metadata | `<head>` |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open opt-out page | Navigate to `/data-sharing-opt-out` | Renders the opt-out instructions | public |
| Open legacy Shopify page | Navigate to `/pages/data-sharing-opt-out` | Permanent redirect to `/data-sharing-opt-out` | public |
| Email privacy | Click privacy email link | Opens `mailto:privacy@uthena.com` with a safe subject | public |
| Manage account privacy | Click account settings CTA | Navigate to `/login?next=/account/settings` if anon, `/account/settings` if auth | public CTA, account action requires auth |
| Open privacy policy | Click `/privacy` link | Navigate to `/privacy` | public |

## What this page does NOT do

- No sale or sharing toggle stored directly on this public page
- No collection of sensitive identifiers from anonymous visitors
- No third-party privacy widget
- No cookie-consent manager replacement
- No legal drafting by the agent

## Acceptance criteria

- [ ] `/data-sharing-opt-out` is public and indexable unless legal counsel marks it noindex
- [ ] `/pages/data-sharing-opt-out` permanently redirects to `/data-sharing-opt-out`
- [ ] The page links to `/privacy` and `/account/settings`
- [ ] The page gives a fixed `privacy@uthena.com` contact path and tells users what information to include without asking for passwords, card numbers, or sensitive files
- [ ] Canonical tag, Open Graph URL, sitemap entry, and footer/legal links use `/data-sharing-opt-out`, never `/pages/data-sharing-opt-out`
- [ ] No user-provided content is submitted from this public page in v1
- [ ] Page renders in < 150ms p95
- [ ] No placeholder markers in the diff

## Design reference

- Reuse the legal-page shell from `/privacy`, with compact action rows.

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** N/A
- **PII displayed:** NO
- **PII in URLs:** NO
- **Audit logged:** NO for page views; account-settings privacy actions are logged in `account-settings.md`
- **Third-party scripts:** none
- **Legacy redirect safety:** `/pages/data-sharing-opt-out` has a fixed target and accepts no user-controlled destination params

## Performance

- **Target p95:** < 150ms
- **Render strategy:** RSC + ISR with `revalidate = 86400`
- **Bundle size budget:** 0 KB

## Out of scope for v1

- Full privacy-preference center
- Anonymous web form for privacy requests
- Region-specific dynamic copy
- Privacy request status tracking

## Open questions for human

1. **Legal wording ownership:** this spec defines the page behavior and route. The actual opt-out legal text should be provided or approved by the human/legal owner before launch.

---

## Implementation notes

- (2026-06-30, build-uthena) P10.6 review pass — Slice 2. The
  previous tick (2026-06-29) was a verification + content-polish
  pass that shipped the page skeleton, the legacy `/pages/data-sharing-opt-out`
  → `/data-sharing-opt-out` 308 redirect (in `next.config.mjs:37`),
  the `/privacy` + `/account/settings` CTA row, the canonical + OG
  + Article JSON-LD via `buildPageMetadata` with
  `path: '/data-sharing-opt-out'`, the sitemap entry in
  `app/sitemap-pages.xml/route.ts:53`, the `privacy@uthena.com`
  contact path, and the first cut of the `see_also` frontmatter.
  This tick (Slice 2 / review pass) extends the surface to cover
  the CCPA / GDPR Art. 21 / GPC / response-windows / identity /
  authorized-agent topics that were called out in the task brief:

  (1) **Markdown rewrite** at `04-platform/emails/legal/data-sharing-opt-out.md`:
      `last_updated` bumped to 2026-06-30; `og_description` extended
      to mention CCPA / GDPR Art. 21; new sections in body order:
      `## How to submit a request` (with the explicit field list —
      first name, last name, email, request type, optional reason —
      that the form below captures), `## Your California rights
      (CCPA / CPRA)` (Know / Delete / Correct / Limit Sensitive PI /
      Opt Out of Sale or Sharing / Non-Discrimination, with the
      15-business-day CCPA §1798.135 response window), `## Your GDPR
      rights — Art. 21 right to object` (legitimate-interests
      objection + direct-marketing objection, 30-day GDPR Art. 12
      (3) response window), `## Global Privacy Control (GPC)` (explicit
      `Sec-GPC: 1` header statement + AB-302 compliance, mirrored
      from privacy.md §Cookies), `## Other U.S. state privacy laws`
      (Virginia CDPA / Colorado CPA / Connecticut CTDPA / Utah UCPA /
      Texas TDPSA / Oregon OCPA / Montana MCDPA / Iowa SF 262),
      `## Identity verification` (email match for non-sensitive +
      ID-for-sensitive), `## Authorized agents` (CCPA authorized-
      agent flow + per-CA Probate Code §4121), `## Response windows`
      (table: CCPA 15 business days / 45 days Know+Delete / GDPR
      30 days / state-by-state). GPC section rewritten to match the
      privacy.md §Cookies verbatim language.

  (2) **OptOutForm client island** at
      `02-features/legal/components/OptOutForm.tsx` +
      `OptOutForm.module.css`. Disabled-submit per the task brief's
      option B ("Available in a follow-up release" hint). Form fields
      match the markdown spec: first name, last name, email,
      request-type radio (Do Not Sell or Share / Limit Use of
      Sensitive PI / Object to Processing / Other), optional reason
      textarea. Honest banner copy directs users to email
      `privacy@uthena.com` until the in-product submission pipeline
      ships. Exported from `02-features/legal/index.ts` alongside
      `ContactForm` + `DmcaAgentCard`.

  (3) **Page wiring** at `app/data-sharing-opt-out/page.tsx`:
      `OptOutForm` is rendered via `ProsePage`'s `beforeBody` slot
      (the DMCA pattern) so the most-actionable surface sits at the
      top of the article. Added CSS at
      `app/data-sharing-opt-out/data-sharing-opt-out.module.css`
      for `.formSection` / `.formHeading` / `.formIntro` /
      `.formLink` (token-only, matches the page family's palette).

  (4) **Form wiring note (per task brief §4):** The submit button
      is intentionally disabled with an honest "coming soon" label
      and a redirect to `mailto:privacy@uthena.com` until the
      `data_subject_requests` table lands (P9.9 / Phase 17
      territory) and the `02-features/account/profile/actions/`
      pipeline can write the request + send a notification email.
      No `/api/data-subject-request` route was added in this tick —
      that lands with P9.9 alongside the schema + RLS + audit log.

  (5) **STUB-012** (data-controller email `projects@dantwah.com` vs
      the future `privacy@uthena.com` inbox) remains open; the
      markdown Contact section now documents the routing honestly
      so users know that both addresses reach the same data-
      controller team until `privacy@uthena.com` is fully
      provisioned.

  (6) **All 6 checks green** + `pnpm build` clean + no `TODO`/
      `FIXME`/`XXX`/`HACK` in the diff.

- (2026-06-29, build-uthena) P10.6 verification tick (Slice 1).
  The page, the legacy `/pages/data-sharing-opt-out` → `/data-sharing-opt-out`
  308 redirect (in `next.config.mjs:37`), the `/privacy` + `/account/settings`
  CTA row, the canonical + OG + Article JSON-LD via `buildPageMetadata`
  with `path: '/data-sharing-opt-out'`, the sitemap entry in
  `app/sitemap-pages.xml/route.ts:53`, and the `privacy@uthena.com`
  contact path were all already shipped in earlier phases. This tick:
  (1) bumped markdown `last_updated` to 2026-06-29; (2) added a
  `see_also` frontmatter block (Privacy Policy + Terms of Service) so
  the cross-link trio renders at the bottom of the page (depends on
  the P10.1 `parseSeeAlsoBlock` fix that makes list-form `see_also:`
  work on the one-line-gap frontmatter format). Body content reviewed
  against acceptance criteria — "never ask for password / card /
  sensitive files" already in body; GPC section already present;
  California / Virginia / Colorado / Connecticut / Utah state privacy
  law coverage already in body. STUB-012 (data-controller email
  `projects@dantwah.com` vs the future `privacy@uthena.com` inbox)
  remains open; ASK carried forward.
