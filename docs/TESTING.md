# Uthena v2 — Local Testing Walkthrough

The local stack is fully running. You can log in as any of the 5 seeded users
and click through every surface that doesn't require third-party creds
(Stripe, PayPal, Bunny, OAuth providers).

> **Live surfaces:**
> - App: <http://localhost:3100>
> - Supabase API gateway (auth + REST): <http://127.0.0.1:54421>
> - Supabase Studio (DB + auth UI): <http://127.0.0.1:54423>
> - Postgres direct: `127.0.0.1:54422`, DB=`postgres`, user/pw=`postgres`
> - Mailpit (catch-all SMTP): <http://127.0.0.1:54424>

> **Verified working end-to-end via browser (Playwright):**
> - `/` (home), `/browse`, `/products/ai-for-entrepreneurs`
> - `/login` → email+password → `/library` (with seeded library grant + progress)
> - `/learn/ai-for-entrepreneurs/lessons/101` — full LMS watch page with video,
>   sidebar of 5 lessons (1 marked complete, "4:00 watched"), next-lesson link,
>   tabs (Overview / Notes / Resources / Q&A), Certificate CTA.

---

## The 5 test users

All users share their **email as their password**. So `buyer@uthena.com` /
`buyer@uthena.com` is the credential.

| Email | Role | What to test |
|---|---|---|
| `klaas+admin@uthena.com` | `super_admin` | `/admin/*` everything |
| `admin@uthena.com` | `admin` | `/admin/*` everything |
| `klaas+partner@uthena.com` | `partner` (Klaas) | `/partner/*` dashboard + earnings |
| `buyer@uthena.com` | `customer` | `/library`, `/learn/*`, checkout |
| `buyer2@uthena.com` | `customer` | Empty library; tests the empty state |

> Jane Doe (`jane@uthena.com`) is referenced as a partner by the Cold Email
> course in the seed, but is **not** a real login — she has no credentials
> in the test seed.

---

## Suggested click path (30 min)

### 1. Catalog + product detail (no login)
- `/` — home with 3 categories + 3 featured products + lifetime deal ribbon
- `/browse` — full catalog grid, filters by category
- `/products/ai-for-entrepreneurs` — product detail page (video preview, curriculum, reviews, price)

### 2. Log in as a buyer
- `/login` — sign in as `buyer@uthena.com` / `buyer@uthena.com`
- After login → land on `/library` (has 1 enrolled course: AI for Entrepreneurs with 5 lessons, 1 marked complete)

### 3. Library + Continue watching rail
- `/library` — shows the AI course with a progress bar (1/5 lessons = 20%)
- Continue watching rail at the top — click to resume

### 4. Watch page (the LMS)
- `/learn/ai-for-entrepreneurs/lessons/101` — first lesson
  - **No real video file needed**: the page falls back to Mux's public Big Buck Bunny HLS stream when `file_id` is null on the seeded lesson
  - Sidebar shows all 5 lessons with completion ticks
  - Tabs: Overview · Notes · Resources · Q&A
  - Bookmark icon on the player
  - "Mark complete" button → updates `public.progress` row → re-renders

### 5. Log out, log in as partner
- `/login` → `klaas+partner@uthena.com`
- `/partner` — dashboard with:
  - Total sales, royalty owed, royalty paid (from payout_ledger)
  - Linked product (AI for Entrepreneurs)
  - Recent payout requests (1 in `available`, 1 `paid`, 1 `locked`)

### 6. Log out, log in as admin
- `/login` → `klaas+admin@uthena.com`
- `/admin` — admin landing page
- `/admin/payouts` — payout queue (3 requests, can approve/deny/mark paid)
- `/admin/moderation` — review moderation queue (1 unreviewed review to approve)
- `/admin/audit-log` — search UI with URL-driven filters (try `?actor_email=klaas+admin@uthena.com`)

### 7. Try a marketing page
- `/about`, `/press`, `/careers`, `/affiliate-program` — all 4 shipped
- `/browse?category=marketing` — filtered catalog

### 8. Buyer who has nothing (empty state)
- `/login` → `buyer2@uthena.com`
- `/library` — should show the empty library state with CTA to `/browse`

---

## What's **not** testable yet

These need creds in Doppler before they work end-to-end:

| Surface | What it needs |
|---|---|
| Real Stripe checkout | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` |
| Real PayPal Mass Payout (admin → partner payout) | `PAYPAL_CLIENT_ID` + `PAYPAL_SECRET` |
| Real Bunny HLS playback | `BUNNY_STORAGE_KEY` + `BUNNY_STREAM_KEY` + actual uploaded files |
| Google / Apple OAuth | `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET` |
| Real email delivery (currently goes to Mailpit at :54424) | `SES_*` keys (Mailpit is fine for local dev) |
| Sentry error tracking | `SENTRY_DSN` |

When any of these are missing, the code paths exist and are wired but the
3rd-party call fails gracefully with a console warning. No page crash.

---

## Resetting the seed

If you mess up the data:

```bash
pnpm db:seed
```

This is fully idempotent — clears all 5 users + their profiles + library
grants + progress + payout_ledger + reviews + platform_settings, then
re-creates the same canonical state.

---

## DB access

Direct Postgres connection (use psql / TablePlus / DBeaver):

- Host: `127.0.0.1`
- Port: `54422`
- DB: `uthena`
- User: `postgres`
- Password: `postgres`

Or use the Studio GUI at <http://127.0.0.1:54423> (no auth in dev mode).

---

## Useful queries for poking around

```sql
-- All orders
SELECT id, user_id, amount_cents, status, created_at FROM public.orders ORDER BY created_at DESC;

-- Library grants for a buyer
SELECT * FROM public.library_grants WHERE user_id = '<user_id>';

-- Payout ledger for Klaas (the partner)
SELECT id, partner_id, amount_cents, status, available_at
FROM public.payout_ledger
WHERE partner_id = (SELECT id FROM public.partners WHERE public_slug = 'klaas');

-- Audit log
SELECT actor_email, action, target_table, target_id, created_at
FROM public.admin_audit_log ORDER BY created_at DESC LIMIT 20;
```