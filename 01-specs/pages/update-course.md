# `/update-course` — public URL alias for the partner courses list

This route is a thin auth-gated dispatch page that lands approved
partners at `/partner/courses` (the courses list — partners click
into a specific course to edit). The canonical wizard spec lives at
[`instructor-upload.md`](./instructor-upload.md) — read that file
for the wizard context (this alias is the "edit existing course"
entry point, not "create new course").

## Why this alias exists

The Shopify-era sitemap exposed `/pages/update-course`. The clean
v2 replacement is `/update-course` (this page) which redirects to
`/partner/courses` after auth + partner-state checks. The legacy
URL `/pages/update-course` is permanently redirected to
`/update-course` via `next.config.mjs`, so both URLs work forever
for partner muscle memory + any external backlinks.

## Dispatch matrix

| Visitor | Lands on |
|---|---|
| anon | `/login?next=/partner/courses` |
| signed-in, no `partners` row | `/partner/onboarding` |
| signed-in, `partners.status IN ('pending', 'suspended')` | `/partner/onboarding` |
| signed-in, `partners.status = 'approved'` | `/partner/courses` |

## Implementation notes

- See `app/update-course/page.tsx` for the dispatch.
- See `next.config.mjs` `redirects()` for the legacy `/pages/...`
  permanent redirect.
- The `/partner/courses` list + per-course 5-tab editor live under
  P12.5 + P12.6 territory.
