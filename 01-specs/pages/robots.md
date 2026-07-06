# Robots — `/robots.txt`

> **Public crawl rules + sitemap pointer.** Companion to the sitemap
> spec at [`sitemap.md`](./sitemap.md). The cross-cutting launch
> contract (sitemap INDEX, robots.txt, legacy redirects, launch crawl)
> lives in [`seo-url-migration.md`](./seo-url-migration.md).

## What this page does

Returns the standard `robots.txt` text format that crawlers fetch
first. Contains:

1. **Allow rules** — `User-agent: *` `Allow: /` so the entire public
   surface is crawlable by default.
2. **Disallow rules** — every authenticated, private, or
   non-canonical surface.
3. **Sitemap pointer** — `Sitemap: https://uthena.com/sitemap.xml` so
   compliant crawlers fetch the INDEX and discover the child sitemaps
   automatically.

## Data this page shows

| Field | Source | Format | Notes |
|---|---|---|---|
| `User-agent` | constant `*` | literal | One rule set — no per-bot overrides for v1 |
| `Allow` | constant `/` | literal | Allow all by default |
| `Disallow` | static list of path prefixes | path string | See acceptance criteria below |
| `Sitemap` | constant `https://uthena.com/sitemap.xml` | absolute URL | Required by Google + Bing |

## User actions

This page has no UI. The "user" is a search-engine crawler.

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Fetch robots | `GET /robots.txt` | Returns text/plain crawl rules + sitemap pointer | public |

## What this page does NOT do

- **No per-bot rules.** No separate `User-agent: Googlebot` block.
  v1 is one rule set; per-bot carve-outs are deferred.
- **No crawl-delay.** We don't artificially throttle crawlers;
  rate-limiting is enforced at the edge (DDoS protection) and in
  the application layer (Supabase RLS + auth).
- **No `Host` directive.** Deprecated by Google in 2023 and ignored
  by Bing. Omitted.
- **No noindex for individual surfaces.** The robots.txt `Disallow`
  rule is the single source of truth for crawler exclusion; pages
  don't also carry `<meta name="robots" content="noindex">` — the
  duplicate would be confusing.

## Acceptance criteria

- [ ] `GET /robots.txt` returns 200 with `Content-Type: text/plain; charset=utf-8`
- [ ] Body contains `User-agent: *`
- [ ] Body contains `Allow: /`
- [ ] Body contains a `Disallow` line for every one of: `/admin`, `/account`, `/api`, `/affiliate`, `/cart`, `/checkout`, `/library`, `/login`, `/partner`, `/reset-password`, `/signup`, `/update-password`, `/verify-email`
- [ ] Body contains `Sitemap: https://uthena.com/sitemap.xml`
- [ ] No auth required; no PII; no secrets
- [ ] Body uses LF line endings (no CRLF) — `next/robots` handles this

## Design reference

N/A — infrastructure route returns plain text.

## Security

- **Auth required:** NO.
- **Allowed roles:** public (crawlers).
- **RLS policies that apply:** N/A — no DB read.
- **PII displayed:** NO.
- **PII in URLs:** N/A — `Disallow` paths are not PII.
- **Open redirect protection:** N/A — no redirect targets.
- **Audit logged:** NO.

## Performance

- **Target p95:** < 50 ms.
- **Render strategy:** static (no DB read, no auth, no fetch).
- **Cache:** `Cache-Control: public, max-age=3600, s-maxage=3600` (matches the sitemap cadence so crawlers see a consistent snapshot).
- **Bundle size budget:** N/A — no client JS.

## Out of scope for v1

- Per-bot rules (Googlebot, Bingbot, AhrefsBot, GPTBot carve-outs)
- `Crawl-delay` directives
- `Host` directive (deprecated; ignored)
- AI-bot opt-out (`GPTBot`, `CCBot`, etc.) — to be evaluated in Phase 18
  alongside PostHog + Gorse consent posture

## Open questions for human

1. **AI-bot opt-out posture.** Some operators disallow `GPTBot`,
   `CCBot`, and `anthropic-ai` outright; others allow them for
   training-data inclusion. Defer to Phase 18 unless you want to
   set the posture now.

---

## Implementation notes

- (filled by the building agent)