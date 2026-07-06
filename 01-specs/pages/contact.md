# Contact — `/contact`

## What this page does

The public contact/support page. It replaces current Shopify `/pages/contact` with the clean canonical URL `/contact` and gives users clear routes for sales, support, privacy, legal, affiliate, and partner inquiries without exposing private account data or creating a support-ticket system in v1.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | title, intro | hard-coded | H1 + prose |
| Contact options | label, description, email/link, response time | config | list/cards |
| Office/company info | legal company name, address if approved | config/legal markdown | prose |
| SEO metadata | title, description, canonical | route metadata | `<head>` |

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open contact | Navigate to `/contact` | Renders contact options | public |
| Open legacy contact | Navigate to `/pages/contact` | Permanent redirect to `/contact` | public |
| Email support | Click mailto | Opens email client | public |
| Go to account help | Click account CTA | Navigate to `/login?next=/account/orders` or `/library` depending on CTA | public |

## What this page does NOT do

- No contact form in v1
- No file upload
- No order lookup
- No live chat widget
- No third-party helpdesk script

## Acceptance criteria

- [x] `/contact` is public and indexable
- [x] `/pages/contact` permanently redirects to `/contact`
- [x] Internal links, sitemap entries, canonical tags, and Open Graph URLs use `/contact`, never `/pages/contact`
- [x] Contact options include support, sales, privacy, legal, affiliate program, and partner/instructor inquiries
- [x] Email links use fixed addresses and safe subject lines
- [x] The page tells users what to include next, without asking for passwords, card numbers, or sensitive files
- [x] No user-provided content is submitted from this page
- [x] Page renders in < 150ms p95
- [x] No placeholder markers in the diff

## Design reference

- Use the legal-page shell with compact option rows. No large marketing hero.

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** N/A
- **PII displayed:** NO
- **PII in URLs:** NO
- **Audit logged:** NO
- **Third-party scripts:** none

## Performance

- **Target p95:** < 150ms
- **Render strategy:** RSC + static/ISR
- **Bundle size budget:** 0 KB

## Out of scope for v1

- Support ticket form
- Chat widget
- Attachment upload

## Open questions for human

1. **Company address:** should the public contact page show a legal mailing address, or only email contacts? My recommendation: show the legal address only if it is already public in the Terms/Privacy docs.

---

## Implementation notes

- Shipped via P10.7 verification tick (2026-06-29 17:30, session `mvs_a1a67806510c48e49b12f3e4f7808913`). All 9 acceptance criteria met. Page is RSC at `519 B / 113 kB` first-load JS. The 6 contact options live in `02-features/legal/queries/getContactOptions.ts` (`CONTACT_OPTIONS` constant) and are consumed by both the public option rows and the `<ContactForm>` client island (single source of truth so the two never drift). Mailing address per `COMPANY_INFO` constant (sourced from live uthena.com Privacy Policy). Subject lines are URL-encoded (`Subject%20request` etc.) for safe mailto hrefs. Open question #1 (company address visibility) was answered affirmatively — the address is shown in the About Uthena section.
