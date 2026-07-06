# DMCA Notice-and-Takedown — `/dmca`

## What this page does

The public DMCA notice-and-takedown page. Required for a platform that hosts user-uploaded content (partner courses, downloadable assets) per 17 U.S.C. § 512. The page shows:

1. **The DMCA designated agent's contact info** — name, email, mailing address (per the § 512(c) registration requirement with the U.S. Copyright Office).
2. **"How to file a DMCA notice" explainer** — the 6 required elements per § 512(c)(3): (1) a physical or electronic signature, (2) identification of the copyrighted work, (3) identification of the infringing material with enough detail for us to locate it, (4) contact information, (5) a good-faith statement, (6) a statement made under penalty of perjury that the notice is accurate and the sender is authorized.
3. **"Counter-notice" section** — explains the counter-notice process per § 512(g), what the 6 required counter-notice elements are, and what happens after a valid counter-notice (we forward to the original claimant, who has 10–14 business days to file a federal action).
4. **Recent takedowns list** — the last 90 days of resolved takedowns, by date + product title only. NO customer or partner PII is shown. This is a transparency mechanism, not a leaderboard.

The page is public, rendered markdown (for sections 1–3) PLUS a data-driven list (section 4). The DMCA agent contact info is **editable by admin** via the admin settings page (the "Email" tab in `admin-settings.md` — see Open Questions §1 for the cross-reference).

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "DMCA Notice-and-Takedown" title | hard-coded | H1 |
| Designated agent | name, email, mailing address, phone (optional) | `admin_settings.dmca_agent` (key-value, see Open Questions §1) | contact card |
| How to file (markdown body) | the 6 required elements, written in plain English | `04-platform/emails/legal/dmca.md` (the markdown body) | rendered HTML, prose |
| Counter-notice (markdown body) | the counter-notice process + 6 required counter-notice elements | same markdown file (separate H2 section) | rendered HTML, prose |
| Recent takedowns | date (e.g. "April 12, 2026"), product title (linked to `/products/[slug]` if still public, or "Removed" if archived) | `dmca_takedowns` table (see Open Questions §1 for the proposed schema) | table with rows: `Date | Product | Status` |
| Recent takedowns | "No takedowns in the last 90 days" empty state | hard-coded | centered card |
| Footer note | "Counter-notices: dmca-counter@uthena.com" (or the designated-agent email — see Open Questions §2) | hard-coded | small text + `mailto:` |

**Server load:**
- `getLegalMarkdown('dmca')` in `02-features/legal/queries/getLegalMarkdown.ts` — same as `/privacy` and `/terms`, returns the markdown body for sections 1–3.
- `getDmcaAgent()` in `02-features/legal/queries/getDmcaAgent.ts` — reads the agent contact from `admin_settings` (key-value table; see Open Questions §1).
- `getRecentTakedowns(limit: 90 days, maxRows: 100)` in `02-features/legal/queries/getRecentTakedowns.ts` — returns the last 90 days of resolved takedowns, with `product.title` joined. Returns ONLY the date, product_id, product title, and status — no customer or partner PII.

**No client JS, no forms, no interactivity on the page itself.** DMCA submissions happen via email (the designated agent's email), not via a form. (A web form is a v2 follow-up — flag in Open Questions §3.)

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open the page | Navigate to `/dmca` | Renders the markdown + the recent-takedowns list | public |
| Click the designated agent email | Click `mailto:` | Opens the user's mail client pre-filled with `To: <agent email>` | public |
| Click a product title in the recent-takedowns list | Click the linked title | Navigate to `/products/[slug]` if the product is still public, or to a "Removed" placeholder if archived | public |
| Click the counter-notice mailto | Click the footer mailto | Opens the user's mail client pre-filled with `To: dmca-counter@uthena.com` | public |
| Print | Browser print | Renders cleanly | public |

## What this page does NOT do

- No "submit a DMCA notice" web form (notices go to the agent email; a form is a v2 follow-up)
- No "submit a counter-notice" web form (counter-notices go to `dmca-counter@uthena.com`; a form is a v2 follow-up)
- No customer PII in the recent-takedowns list (no claimant name, no email, no IP)
- No partner PII in the recent-takedowns list (no partner name, no partner email)
- No live updates (the recent-takedowns list is a snapshot; it is ISR-cached with a 24h revalidate; a new takedown shows up within 24h)
- No "report an unrelated abuse" form (this is the DMCA page specifically; other abuse channels are on the contact page, TBD)
- No i18n in v1
- No editable copy (the human owns the markdown in git)
- No automatic takedown (every notice is admin-reviewed; we do not auto-takedown based on keyword matching in v1)

## Acceptance criteria

- [ ] Page is public; no auth required
- [ ] The designated agent's name, email, mailing address, and (optional) phone are rendered from `admin_settings.dmca_agent` (not hard-coded in the markdown)
- [ ] The "How to file" section renders the 6 required § 512(c)(3) elements in plain English, plus a link to 17 U.S.C. § 512
- [ ] The "Counter-notice" section renders the 6 required § 512(g)(3) elements in plain English, plus the "10–14 business days to file a federal action" timeline
- [ ] The recent-takedowns list shows at most 100 rows from the last 90 days, sorted by `notice_date` desc
- [ ] Each row in the recent-takedowns list contains ONLY: date (human format), product title (linked to `/products/[slug]` or "Removed" if archived). NO customer name, NO customer email, NO claimant info, NO partner PII
- [ ] The recent-takedowns list is empty-state-aware: "No takedowns in the last 90 days" when zero rows
- [ ] The page is ISR with a 24-hour revalidate; pushing a markdown change or editing the agent contact in admin settings does not require a redeploy to take effect on subsequent requests
- [ ] Open Graph tags: `og:title = "DMCA Notice-and-Takedown — Uthena"`, `og:description = "How to report copyright infringement on Uthena"`, `og:type = "article"`, `og:url = "https://uthena.com/dmca"`
- [ ] Schema.org `WebPage` + `Article` JSON-LD is present
- [ ] `<link rel="canonical" href="https://uthena.com/dmca">` is present
- [ ] No `TODO` / `FIXME` in the rendered output
- [ ] No client-side JS is shipped to render the page (verify via the Next.js bundle analyzer)
- [ ] No PII is collected or logged when this page is rendered (the only DB reads are the agent contact + the recent-takedowns list, both of which are already public data)

## Design reference

- Mockup: not yet built — to be created during the legal-pages feature build
- Components: `00-foundations/ui/LegalPage.tsx` (reused from `/privacy` and `/terms`), `00-foundations/ui/AgentContactCard.tsx`, `00-foundations/ui/TakedownsTable.tsx`
- Tokens: `00-foundations/design/tokens.css` (prose layout, max-width 720px for the markdown sections; full width for the takedowns table)
- Theme: dark (default) + light

## Security

- **Auth required:** NO
- **Allowed roles:** public
- **RLS policies that apply:** `admin_settings` (admin only for write; public read for keys with `public_read=true`, which `dmca_agent` must be — see Open Questions §1); `dmca_takedowns` (public read of the date+product_id columns only; see Open Questions §1 for the proposed policy); `products` (public read on `status='published'`)
- **PII displayed:** the **designated agent's contact info** is on the page by design (required for § 512(c) compliance). NO user, customer, partner, or claimant PII is on the page.
- **PII in URLs:** NO — the path is `/dmca`, static
- **Markdown rendering safety:** same strict allowlist sanitizer as `/privacy` and `/terms`
- **CSP:** standard app CSP
- **File access:** the markdown file is read from the build artifact. The agent contact is read from `admin_settings`. The takedowns list is read from `dmca_takedowns` via a service-role query that returns only the public-safe columns.
- **Audit logged:** NO direct audit log for page renders. (The takedowns themselves, when created by admin, are audit-logged in `admin_audit_log` with `action='dmca_takedown', target_table='dmca_takedowns'` — that's the existing admin-tool path, not the public page.)
- **Rate limiting:** standard edge rate limit; the page is a static document, no abuse vector beyond standard edge-cached fetches
- **Open redirect:** N/A — no redirects
- **CSRF:** N/A — no state-changing actions
- **Email injection / header injection:** N/A — no emails are sent from this page
- **Takedown-list safety:** the recent-takedowns list is filtered to public-safe fields at the query level. Even if a future bug added a `claimant_email` column to `dmca_takedowns`, the query would not return it. The list is a **separate** allowlist from the markdown rendering.
- **Third-party scripts:** none beyond the standard Plausible page-view tag (in the root layout)

## Performance

- **Target p95:** < 150ms (cached; one small DB query for the takedowns list, zero for the agent contact on a warm cache)
- **Render strategy:** RSC + ISR with a 24-hour revalidate
- **Cache:** the rendered HTML is cached at the Next.js data cache (24h TTL) AND at the edge (24h). The agent contact and the takedowns list invalidate together on the 24h cycle.
- **DB indexes used:** `dmca_takedowns (notice_date desc) where notice_date > now() - interval '90 days'`. The query is `select date, product_id from dmca_takedowns where notice_date > now() - interval '90 days' order by notice_date desc limit 100`. No joins on the hot path; the product title is resolved in a separate batched query.
- **DB load:** one indexed query per cache miss (every 24h, the agent contact + the takedowns list refresh). On a hot cache: zero.
- **Bundle size budget:** 0 KB (no client JS for this page; the table is server-rendered HTML)
- **Image loading:** N/A

## Out of scope for v1

- "Submit a DMCA notice" web form (notices go to the agent email)
- "Submit a counter-notice" web form (counter-notices go to `dmca-counter@uthena.com`)
- Public counter-notice tracker (the takedowns list is one-way; counter-notices are private between us and the parties)
- DMCA agent registration lookup (the agent's registration with the U.S. Copyright Office is a separate document we publish separately, e.g. as a PDF)
- Multi-language versions (English only)
- Edit history / previous versions viewer
- "What changed" diff link

## Open questions for human

1. **The `dmca_takedowns` table is NEW (not in `_data-model.md` yet).** Proposed schema:

   ```sql
   create type dmca_takedown_status as enum ('received', 'in_review', 'removed', 'restored', 'counter_noticed', 'dismissed');

   create table dmca_takedowns (
     id bigserial primary key,
     product_id bigint not null references products(id),
     notice_date timestamptz not null default now(),
     removed_at timestamptz,
     restored_at timestamptz,
     counter_notice_at timestamptz,
     counter_notice_deadline timestamptz,             -- notice_date + 14 business days
     status dmca_takedown_status not null default 'received',
     resolution_notes text,                            -- admin-only; never shown publicly
     resolved_by uuid references auth.users(id),       -- admin who closed it
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );

   create index on dmca_takedowns (notice_date desc) where notice_date > now() - interval '90 days';
   create index on dmca_takedowns (status);
   create index on dmca_takedowns (product_id);

   alter table dmca_takedowns enable row level security;
   create policy "dmca_takedowns_public_read_date_product" on dmca_takedowns
     for select using (true);   -- public read; the public read code MUST project only date + product_id
   create policy "dmca_takedowns_admin_all" on dmca_takedowns
     for all using (exists (select 1 from profiles where user_id = auth.uid() and role = 'admin'));
   ```

   The **public read** is broad (RLS allows it) but the **public read code path** is a strict allowlist that returns only `notice_date` and `product_id` (joined with `products.title` if the product is still public, or `'Removed'` if archived). `resolution_notes`, `resolved_by`, the counter-notice dates, and the claimant info are admin-only — they live on the same row but the public query never projects them.

   Confirm the schema, or specify a different one.

2. **`admin_settings` table — confirm shape.** I propose a key-value table for editable platform settings (DMCA agent contact, support email, legal email, etc.):

   ```sql
   create table admin_settings (
     key text primary key,
     value jsonb not null,
     public_read boolean not null default false,
     updated_by uuid references auth.users(id),
     updated_at timestamptz not null default now()
   );

   -- e.g. for DMCA agent:
   -- insert into admin_settings (key, value, public_read) values
   --   ('dmca_agent', '{"name": "...", "email": "...", "mailing_address": "...", "phone": "..."}'::jsonb, true);
   ```

   The `dmca_agent` row has `public_read=true`, so the public query can return it. Admin-only settings (e.g. `maintenance_mode`) have `public_read=false`. **My recommendation: approve the `admin_settings` table as the home for all platform-level settings** (this is the same table that `admin-settings.md` will use for the Email tab and the Maintenance tab — flag for the spec author of `admin-settings.md` to use this same table). Confirm or push back.

   **2026-06-29 — RESOLVED.** The key-value store ships as `app_settings` (see Open Q §2 footnote below — the legacy `platform_settings` table from `0001_initial.sql` already used the originally-proposed name with a different shape; the new key-value store was renamed to `app_settings` to avoid a destructive DROP). P10.4 ships the schema + the dmca_agent row + the admin editor at `/admin/dmca-agent` + the public render on `/dmca`. STUB-009 RESOLVED.

3. **DMCA web form (v2).** The brief says "notices go to the agent email" — i.e. no web form. Confirm: **no web form in v1**? If yes, the form is a v2 follow-up via `01-specs/pages/_followups.md`. Confirm.

4. **Designated agent's email vs counter-notice email.** The agent's email (per § 512(c)) is the official "send DMCA notices here" address. The counter-notice email is a separate inbox. My recommendation: **same email** (the designated agent routes both), but the page lists both labels for clarity. Alternative: use `dmca-counter@uthena.com` as a separate inbox routed to the legal team. Confirm.

5. **Counter-notice deadline calculation.** "10–14 business days to file a federal action" — does the § 512(g)(2)(B) timeline use calendar days or business days? The statute is in **calendar days**; the 10–14 day window is "not less than 10, not more than 14" business days per § 512(g)(2)(B), but most references simplify it. My recommendation: state the timeline as **"10–14 business days"** in plain English and have the actual `counter_notice_deadline` be `notice_date + interval '14 days'` in the schema (a conservative bound). Confirm the wording.

---

## Implementation notes

- 2026-06-29 — P10.4 shipped (resolves STUB-009). The DMCA designated
  agent contact is **admin-editable** at `/admin/dmca-agent`. Schema
  lives in `app_settings` (migration `0036_app_settings.sql`):
  `key='dmca_agent'`, `value` jsonb `{ name, email, mailing_address,
  phone }`, `public_read=true`. Three RLS policies
  (`app_settings_admin_read`, `app_settings_admin_write`,
  `app_settings_public_read`) gate the read paths so anon
  callers see only the 4 public-safe fields, never the admin-internal
  columns (`description`, `updated_by`, `updated_at`).
  - **Naming note.** The data-model spec proposed this table as
    `platform_settings` (key-value shape). Migration `0001_initial.sql`
    already created a table with that name using a different shape
    (singleton, columns-based config for `default_royalty_pct_bps` +
    future maintenance_mode toggle). The legacy table is reserved for
    future feature-flag reads (per P5.9 + P18.7 references in
    checkout.ts and subscriptions.ts). To avoid a name collision +
    destructive `DROP TABLE`, the key-value store ships as
    `app_settings`. When P14.12 retires the legacy single-row table,
    `app_settings` may be renamed to `platform_settings`.
  - **Public read** — `02-features/legal/queries/getDmcaAgent.ts`
    projects only `value` and parses it with a defensive 4-field
    schema; returns null on bad shape / missing fields / DB error.
    13 unit tests.
  - **Public render** — `app/dmca/page.tsx` composes
    `<DmcaAgentCard agent={getDmcaAgent()}>`. The card has a
    fail-soft "not yet configured" fallback that points to
    `/admin/dmca-agent` (no empty container rendered).
  - **Admin read** — `02-features/admin/platform-settings/queries/getPlatformSetting.ts`
    uses service-role so admins see every key (including
    public_read=false ones). Pre-fills the editor with
    `getDmcaAgentForAdmin()`.
  - **Admin write** — `02-features/admin/platform-settings/actions/updateDmcaAgent.ts`
    Zod-validates via `UpdateDmcaAgentInput` (min(2)/email/min(10)/max(40)
    for phone), requires admin role via `requireRole(['admin',
    'super_admin'])`, upserts via service-role with `onConflict:'key'`,
    writes one `admin_audit_log` row with action='admin.settings_update',
    target_kind='platform_settings', target_id='dmca_agent',
    metadata={before, after}, IP + UA. 12 unit tests cover validation,
    happy path, pre-read fail, upsert fail, audit fail (fail-soft),
    non-admin gate, FormData vs object.
  - **Editor** — `02-features/admin/platform-settings/components/DmcaAgentForm.tsx`
    is a client island with 4 inputs + live preview mirroring
    `<DmcaAgentCard>` + reset button + per-field errors + success/
    error states + `aria-busy`/`role="status"`/`role="alert"` wired.
    Token-only CSS via `--accent`/`--danger`/`--success`/`--bg-elev-*`.
  - **Page** — `app/admin/dmca-agent/page.tsx` is RSC + auth-gated
    (`requireRole(['admin', 'super_admin'])`), `dynamic='force-dynamic'`
    so the editor always shows the freshest row, `sensitivePageMetadata`
    for `noindex`. Loading skeleton in `loading.tsx`.
  - **Nav** — added to `02-features/admin/shell/AdminSidebar.tsx` under
    the System section (visible to admins + super_admins).
  - **Markdown** — `04-platform/emails/legal/dmca.md` no longer
    hard-codes the agent contact; the body references the data-driven
    editor and lists see_also cross-links to Terms/Privacy/Refund.
    `last_updated: 2026-06-29`.
  - **Recent takedowns list** (this spec's "Recent takedowns"
    section) is **still v2** — explicitly deferred in STUB-010.
    P10.4 ships only the designated-agent edit surface, which is
    the PHASES.md acceptance criterion. The `dmca_takedowns` table
    is admin-only (RLS) and the public allowlist query + RLS policy
    change is a v2 follow-up.
