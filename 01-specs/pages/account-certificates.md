# My Certificates — `/account/certificates`

## What this page does

The user's earned certificate gallery. One card per certificate. Each card shows the product thumbnail and title, the issue date, a short alphanumeric **certificate code** (for public verification), a "Download PDF" button, and a "Verify" link to the public verification page (`/verify/certificate/[code]` — see Open Questions; that page is a separate spec).

A certificate is **auto-issued** when the user has a `library_grant` for a product AND every lesson in that product has a `progress` row with `completed = true` (per the `library.md` spec: "all lessons completed" is the trigger). The issue happens via a server action called from the lesson-complete handler, or a nightly cron backfill — both must be idempotent (a user can finish their last lesson at 11:59 PM and the cron can fire at midnight; only one row must result).

The page has a year filter (chips for years with at least one certificate) and a default sort of `issued_at desc` (most recent first). Empty state: "Complete a course to earn your first certificate." with a CTA to `/library`.

> **Schema status:** `certificates` is a **new table** — it does not exist in `_data-model.md` yet. The proposed schema lives in Open Questions §1. This spec assumes the table exists by the time the feature is built.

## Reconciliation with library.md

`library.md` (L14, L19, L32, L44, L97) already references a `certificates` table, `certificate_id`, and the download route `/library/certificates/[id].pdf`. This spec deliberately extends that model rather than replacing it. The reconciliation is:

- **Two identifiers on the same row.** A certificate has:
  - `id` — the internal `bigint` primary key (per `_data-model.md` conventions). This is the `certificate_id` referenced in `library.md` L19 and used in the existing download route `/library/certificates/[id].pdf` (library.md L32). It is the **buyer-side identifier** — only the owner and admin ever see it.
  - `certificate_code` — a URL-safe, ~8-character base-32 public code (e.g. `7F2K9P4QX`). This is **new in this spec**. It is used in the new public verify route `/verify/certificate/[code]` (added in v1 by this spec; not present in `library.md`). It is the **public identifier** — the one that goes on the PDF, the share link, the verification QR.
  - The two coexist: `id` for the buyer's own library, `code` for the public verify link. The owner sees both on this page; the public sees only `code`.

- **Routes.** Three routes, three jobs:
  - `/library/certificates/[id].pdf` (per `library.md` L32) — the existing download endpoint, uses the internal `id`. Unchanged by this spec.
  - `/account/certificates` (this spec) — the per-user gallery view, the focus of this document.
  - `/verify/certificate/[code]` (new in this spec) — the public verification page. Returns public fields only. This page is a follow-up spec; see Open Questions §3.

- **Issuance model — deliberate deviation from `library.md`.** `library.md` L44 says "certificates are issued by a cron job on course completion" and L97 reiterates "auto-issue certificates (cron-based only in v1)". This spec supersedes that with a **better-UX model**:
  - **Primary path:** a server action fires in the lesson-complete handler. The instant the user finishes their last lesson, the certificate is issued. The user sees "Certificate earned" on the same screen.
  - **Safety net:** a nightly cron job backfills any certificates that should have been issued but weren't (e.g. server-action failure, race condition, manual fix-up). Idempotency on `(user_id, product_id)` guarantees no duplicates.
  - This is a deliberate deviation that **needs human approval** — `library.md` is the existing contract and we are now superseding its issuance model. The deviation is the better one, but it changes the spec. See Open Questions §5 for the follow-up decision: update `library.md` in this PR, or file a follow-up spec.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "My certificates" + count | certificates aggregate | H1 + count pill |
| Year filter | distinct `issued_at` years with at least 1 cert | certificates aggregate | chip row |
| Card | `product.thumbnail_url`, `product.title`, `product.slug` | products | thumbnail + linked title |
| Card | `partner.display_name` (or partner business name) | partners | "by {partner}" subtitle |
| Card | `certificates.issued_at` | certificates | "Issued March 4, 2026" |
| Card | `certificates.certificate_code` (8-char base-32, e.g. `7F2K9P4QX`) | certificates | monospace, copyable on hover |
| Card | "Download PDF" button | action | primary button → signed PDF download |
| Card | "Verify" link | action | text link → `/verify/certificate/[code]` |
| Card | `certificates.pdf_storage_path` (for download) | certificates (private Bunny path) | resolved at click time via signed URL |
| Empty state | illustration + "Complete a course to earn your first certificate." + CTA | hard-coded | centered card |
| Footer | Total count, last issued date | certificates aggregate | small text |

**Queries:** `02-features/account/queries/getMyCertificates.ts`, `getCertificateByCode.ts` (for the verify follow-up).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Navigate to `/account/certificates` | Renders certificate list filtered by year (or all years) | self |
| Filter by year | Click a year chip | URL updates with `?year=YYYY`; the list re-renders | self |
| Clear filter | Click "All" chip | URL drops the `?year=` param | self |
| Sort | (not in v1 — fixed at issued_at desc) | — | — |
| Download PDF | Click "Download PDF" on a card | Server action mints a 5-minute signed URL on the private Bunny bucket, returns it to the client, browser auto-downloads via `Content-Disposition: attachment`. No `file_downloads` row (this is a certificate, not a licensed file) | self + owns certificate |
| Copy certificate code | Click the code | Copies to clipboard, toast confirms | self |
| Open public verify page | Click "Verify" | Navigate to `/verify/certificate/[code]` (separate spec) | self |
| Open product page | Click product thumbnail or title | Navigate to `/products/[slug]` | self |
| Open library | Click "Complete a course" CTA in empty state | Navigate to `/library` | self |
| Share certificate | (not in v1 — see Open Questions §3 for a v2 social-share follow-up) | — | — |

## What this page does NOT do

- No manual certificate issuance by the user (certificates are earned, not requested)
- No certificate revocation by the user (if a refund is processed, the library_grant is revoked and the corresponding certificate is marked `status='revoked'` — see Security; it disappears from this page)
- No re-issue of certificates (if the underlying product is updated, the certificate still points to the original product version — historical record)
- No social sharing in v1 (LinkedIn / Twitter share buttons are a v2 follow-up — see Open Questions §3)
- No certificate for a partially-completed product (must be 100% lesson completion)
- No certificate customization (name, color, etc. — the cert is generated from the user's `profiles.display_name` and that's it)
- No certificate for non-video products in v1 (ebooks, template packs, audio courses do not have lessons; the `library.md` cert trigger is video-course specific — see Open Questions §2)
- No admin revocation UI in this spec (admin revocation is a separate admin tool, not in v1)

## Acceptance criteria

- [ ] Page is auth-gated; unauth users redirect to `/login?next=/account/certificates`
- [ ] Only certificates where `user_id = auth.uid() AND status = 'active'` are shown, default sort `issued_at desc` (most recent first)
- [ ] Each card displays: product thumbnail, title, "by {partner}", issued date (human format), and the certificate code in monospace (`7F2K9P4QX`-style 8-char base-32 format)
- [ ] Year filter chips reflect only the years the user has at least one certificate for; "All" is the default; clicking a year updates the URL with `?year=YYYY`
- [ ] "Download PDF" mints a 5-minute signed URL on the private Bunny bucket via server action and triggers a browser download via `Content-Disposition: attachment`; no `file_downloads` row is created (certificates are not licensed files)
- [ ] Certificate code uniqueness is enforced by a DB `unique` constraint; codes are generated with a CSPRNG (collision retry max 5); the code is the **only** identifier in the public verify URL — no `user_id`, no email, no name
- [ ] "Verify" link opens `/verify/certificate/[code]` in a new tab (the verify page itself is a separate spec — see Open Questions §3)
- [ ] Refund-revoked grants cause the corresponding certificate's `status` to become `'revoked'`; revoked certs do not appear on this page
- [ ] Empty state appears when the user has zero certificates and links to `/library`
- [ ] Page renders in < 300ms p95; no `TODO` / `FIXME` in the diff

## Design reference

- Mockup: `mockups/library.html` (the certificates section is part of that mockup; needs a focused mockup follow-up — flag in Open Questions)
- Components: `00-foundations/ui/CertificateCard.tsx`, `00-foundations/ui/YearFilterChips.tsx`
- Design tokens: `00-foundations/design/tokens.css`
- Theme: dark (primary) + light (secondary)

## Security

- **Auth required:** YES
- **Allowed roles:** any authenticated user
- **RLS policies that apply:**
  - `certificates`: see proposed policies in Open Questions §1 (self read own; admin all; public read by code for the verify endpoint).
  - `products`: `products_public_read_published` — to load product metadata for each card.
  - `library_grants`: `library_grants_self_read` — to detect grant state on issue.
  - `progress`: `progress_self_all` — to read completion state on issue.
- **PII displayed:** only the user's own `profiles.display_name` (which they set). No other users' data.
- **PII in URLs:** **NO** — the public verify URL is `/verify/certificate/[code]` and contains only the short alphanumeric code. **Actual entropy at 8 base-32 chars is ~40 bits; brute-force resistance comes from the 30/IP/min rate limit on /verify/[code], not the entropy alone.** The verify page returns: product title, partner name, issue date, and the user's `display_name` (which is already public per `profiles` RLS). It **does not** return the user's email, real name, or any other PII.
- **Certificate code uniqueness:** enforced by a `unique` constraint on `certificates.certificate_code`. Code generation uses a cryptographically-secure RNG (not `Math.random()`) with collision retry (max 5 attempts). Codes are stored cleartext (they're meant to be human-shareable) and brute-force is mitigated by the verify endpoint's rate limit (see below).
- **Idempotency on issue:** the issue server action checks for an existing cert with `(user_id, product_id)` and short-circuits if one exists. The unique constraint is the belt-and-suspenders guarantee. The cron backfill is `INSERT ... ON CONFLICT (user_id, product_id) DO NOTHING`.
- **Rate limiting:** max 60 downloads per user per hour (shared budget with `file_downloads` per `_data-model.md`). Verify endpoint: max 30 requests per IP per minute.
- **Audit logged:** certificate issuance writes a row to `admin_audit_log` with `action='issue_certificate'`, `after={user_id, product_id, issued_at, certificate_code}`. Issuance is a system action, not a user action.
- **Revocation on refund:** if a `library_grant` is revoked (refund processed), the cert's `status` is set to `'revoked'`. Revoked certs do not appear on this page and return 410 Gone from the public verify endpoint.
- **PDF storage:** all certificate PDFs live in a **private** Bunny bucket. Signed URLs are generated on demand with a 5-minute TTL.
- **CSRF:** all server actions are CSRF-protected.
- **Third-party scripts:** none.

## Performance

- **Target p95:** < 300ms (page is auth-gated, RSC + SSR, no public caching)
- **Render strategy:** RSC + SSR. The certificate list is fetched server-side; the signed-URL download happens client-side only on click.
- **Cache:** none on this page — user-specific.
- **DB indexes used:** `certificates (user_id, issued_at desc)`, `certificates (user_id, product_id)` (via the unique constraint), `certificates (certificate_code)` (via the unique constraint, for the verify endpoint).
- **Bundle size budget:** < 15 KB added to client bundle (year filter chips, copy-to-clipboard). Cards are RSC and ship as HTML.
- **Image loading:** product thumbnails use `next/image` with standard lazy + blur placeholder.

## Out of scope for v1

- Manual certificate issuance
- Certificate revocation UI (admin-side, not user-side)
- Certificate re-issue (e.g. for a renamed product)
- Social sharing (LinkedIn / Twitter / etc.) — v2
- Certificate for non-video products (ebooks, audio, templates) — depends on a content-completion model we don't have yet
- Multiple certificates per product ("completed with honors") — v2
- Per-certificate "shareable image" generation (OG-card-style) — v2

## Open questions for human

- **§1 — Proposed `certificates` schema (NEW TABLE — not in `_data-model.md` yet).**

  ```sql
  create type certificate_status as enum ('active', 'revoked');

  create table certificates (
    id bigserial primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    product_id bigint not null references products(id) on delete cascade,
    issued_at timestamptz not null default now(),
    certificate_code text not null unique,           -- 8-char base-32, e.g. '7F2K9P4QX'
    pdf_storage_path text not null,                 -- Bunny private bucket key
    status certificate_status not null default 'active',
    revoked_at timestamptz,
    revoked_reason text,                            -- 'refund', 'admin_action', etc.
    created_at timestamptz not null default now(),
    unique (user_id, product_id)                    -- one cert per (user, product)
  );

  create index on certificates (user_id, issued_at desc);
  create index on certificates (certificate_code);

  alter table certificates enable row level security;
  create policy "certificates_self_read" on certificates for select using (user_id = auth.uid());
  create policy "certificates_admin_all" on certificates for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
  -- No user-side insert/update policy: issuance is a system action via service role.
  ```

  **My recommendation: approve as-is.** The minimum needed is `id, user_id, product_id, issued_at, certificate_code, pdf_storage_path`; the `status` / `revoked_at` / `revoked_reason` columns are added for the refund-revocation flow. Migration filename: `00XX_certificates.sql` (next available number — check `04-platform/migrations/`).

- **§2 — Trigger for non-video products.** The trigger (all `progress.completed = true` for every lesson in the product) only works for `product_kind = 'video_course'`. For ebooks, template packs, and audio courses, we don't have a `progress` equivalent. **My recommendation:** ship v1 with video courses only. Add the other kinds in v2 when we have a `download_complete` or `audio_finished` signal. This is a product decision, not a technical one — please confirm.

- **§3 — Public verify page scope.** This spec links to `/verify/certificate/[code]` but does not spec it. **My recommendation:** separate spec for the verify page (public route, unauth, RLS-bypassed via service role, returns product title + partner name + issue date + user's public `display_name` + status). Flag as a follow-up.
- **§4 — PDF template.** **My recommendation:** Uthena-branded in v1 (one template, faster to ship). Per-partner branding is a v2 follow-up — requires partner-uploaded brand assets + a template-renderer abstraction.

- **§5 — Reconciling with `library.md` (the "should I update it now" question).** This spec deliberately supersedes `library.md` L44/L97's "cron-only in v1" model with a server-action-on-lesson-complete + nightly-cron-backfill model (better UX; the cron is the safety net, not the primary path). The supersession is documented in the Reconciliation section above. `library.md`'s certificate spec needs an update to match this model — should I update `library.md` in this same PR, or file a follow-up spec? **My recommendation: update `library.md` in this PR** — both changes are about the certificate issuance model and they need to land together so the implementer doesn't see a contradiction. The "two identifiers" model and the new `/account/certificates` page are not contradicted by `library.md`, so they can also go in the same PR.

---

## Implementation notes

- (filled by the building agent)
