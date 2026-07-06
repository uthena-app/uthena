# `/submit-new-course` — public URL alias for the partner upload wizard

This route is a thin auth-gated dispatch page that lands approved
partners at `/partner/upload`. The canonical wizard spec lives at
[`instructor-upload.md`](./instructor-upload.md) — read that file
for the full contract (steps, validation, security, performance,
etc.).

## Why this alias exists

The Shopify-era sitemap exposed `/pages/submit-new-course`. The
clean v2 replacement is `/submit-new-course` (this page) which
redirects to `/partner/upload` after auth + partner-state checks.
The legacy URL `/pages/submit-new-course` is permanently redirected
to `/submit-new-course` via `next.config.mjs`, so both URLs work
forever for partner muscle memory + any external backlinks.

## Dispatch matrix

| Visitor | Lands on |
|---|---|
| anon | `/signup?next=/partner/upload` (sign up first; the signup form preserves `?next=`) |
| signed-in, no `partners` row | `/partner/onboarding` (start the partner application) |
| signed-in, `partners.status IN ('pending', 'suspended')` | `/partner/onboarding` (continue / restart the application) |
| signed-in, `partners.status = 'approved'` | `/partner/upload` (the wizard — see instructor-upload.md) |

The 4-state dispatch mirrors the `/partner/onboarding` branch logic
(P12.1) so a partner visiting either entry point lands in the
correct surface with no extra clicks.

## Implementation notes

- See `app/submit-new-course/page.tsx` for the dispatch.
- See `next.config.mjs` `redirects()` for the legacy `/pages/...`
  permanent redirect.
- See `instructor-upload.md` for the wizard's full contract.
