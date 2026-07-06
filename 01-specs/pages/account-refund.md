# Account Refund Request — `/account/orders/[id]/refund`

## What this page does

The user's refund request form. A user reaches this page from the "Request refund" button on `/account/orders/[id]`. The page shows what they're refunding (order summary at the top), then a form with: reason (select), reason details (textarea), refund amount (full / partial radio, default full), and an optional file upload for proof of issue (max 10MB, jpg/png/pdf only).

On submit, the server creates a `refunds` row with `status='requested'`, sends a confirmation email to the user, and sends an alert email to `admin@uthena.com`. The user is shown a confirmation page that explains what to expect: "We'll respond within 2 business days. You'll get an email when we decide."

The page is gated by THREE conditions, all enforced server-side: (1) the user is authenticated, (2) the order's `customer_id` matches `auth.uid()` (RLS), (3) the order is `status='paid'` AND `now() - order.created_at < REFUND_WINDOW_DAYS` (constant from `00-foundations/money/refund-window.ts`). If any condition fails, the page returns 404 — we do not distinguish "ineligible" from "not found" to the client.

This is the user-side flow only. The admin side (approve, reject, issue Stripe refund) is specced in `admin-refunds.md` (to be written). The partner-side financial impact (the `payout_ledger` debit) is handled automatically when the admin approves.

## Data this page shows

| Section | Field | Source | Format |
|---|---|---|---|
| Header | "Request a refund" title, breadcrumb (`Account / Orders / #12345 / Refund`) | hard-coded + `orders.id` | header |
| Order summary | `id`, `created_at`, `total_cents`, `status` | `orders` | small card, read-only |
| Order summary | line items: `product.title`, `tier`, `unit_price_cents` | `order_items` + `products` | compact list |
| Order summary | "Eligible for refund until Jun 26, 2026 (X days remaining)" | computed from `created_at + REFUND_WINDOW_DAYS` | inline text, amber if ≤ 2 days |
| Form — Reason | select with 4 options: "Didn't work as advertised", "Quality issues", "Accidental purchase", "Other" | hard-coded enum | required |
| Form — Reason details | textarea, 500-char limit, optional but encouraged | form input | optional |
| Form — Refund amount | radio: "Full refund ($497.00)" (default selected) / "Partial refund (you choose the amount, up to $497.00)" | computed from `orders.total_cents` | required |
| Form — Partial amount | number input that appears only if "Partial refund" is selected; min $1, max `orders.total_cents - sum(order_items.refunded_cents)` | form input, validated by Zod | conditional |
| Form — Proof upload | file input, drag-and-drop supported, max 10MB, mime: `image/jpeg | image/png | application/pdf` | form input, client + server validation | optional |
| Submit | "Submit refund request" button | form submit | primary, disabled until form valid |
| Cancel | "Cancel — back to order" link | link to `/account/orders/[id]` | secondary |

**Server action:** `02-features/account/actions/createRefundRequest.ts` — Zod-validates the form, checks the 3 eligibility conditions, inserts a `refunds` row, uploads the proof file to Bunny Storage, enqueues the two emails, and redirects to `/account/orders/[id]/refund/sent?refundId=[id]`.

**Confirmation page (`/account/orders/[id]/refund/sent`):**
- "Refund request submitted" heading
- "Reference: R-12345" (the `refunds.id` formatted as `R-` + id)
- "We'll respond within 2 business days. You'll get an email at [user's email] when we decide."
- "What happens next" — 3-step explainer (we review → we email you with a decision → if approved, the money is back on your card in 5–10 business days)
- "Back to order" CTA → `/account/orders/[id]`
- "Back to all orders" CTA → `/account/orders`

**Queries:**
- `getOrderForRefund(orderId, userId)` in `02-features/account/queries/getOrderForRefund.ts` — single query joining `orders`, `order_items`, `products`. Returns 404 if the order is ineligible (not owned by user, not `paid`, or outside the window).

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Fill reason | Pick an option from the "Reason" select | Form state updates (client component) | self |
| Fill reason details | Type into the textarea | Char counter updates; over-limit shows error | self |
| Pick refund type | Click "Full" or "Partial" radio | If "Partial" is selected, the amount input appears; default is full | self |
| Enter partial amount | Type a number into the partial-amount input | Inline validation (min $1, max remaining); invalid shows error | self |
| Upload proof | Click the file input or drag-and-drop a file | Client validates type + size; on submit, uploads via signed-URL flow | self |
| Submit | Click "Submit refund request" | Server action runs; on success, redirect to `/account/orders/[id]/refund/sent?refundId=[id]`; on failure, inline error | self |
| Cancel | Click "Cancel — back to order" | Navigate to `/account/orders/[id]`, no data persisted | self |
| View confirmation | Land on `/account/orders/[id]/refund/sent?refundId=[id]` | Confirmation page renders | self |

## What this page does NOT do

- No live chat / instant support (this is async; expect 2 business days)
- No partial refund processing (the form ALLOWS the user to request a partial, but the actual partial-amount Stripe refund is handled by the admin — see `admin-refunds.md`)
- No "view my past refund requests" (those live on the order detail page; we'll add a `/account/refunds` index in v2)
- No "cancel my refund request" after submission (the user must email support@uthena.com to cancel an in-flight request)
- No "request a refund for one item only" multi-select (refund is always order-level; the admin decides how to split)
- No automatic refund issuance (every request is admin-reviewed; we don't auto-approve based on heuristics in v1)
- No bank-account / ACH refund (Stripe handles the refund to the original card; we don't ask for a different destination)
- No "refund window extension" for special cases (if the user is past the 14 days, the button doesn't render and the page 404s; support can handle exceptions out-of-band)

## Acceptance criteria

- [ ] Page is auth-gated; 404s (not 403) if order doesn't exist, isn't owned by user, `status != 'paid'`, `now() - created_at >= REFUND_WINDOW_DAYS`, or a `refunds` row already exists with `status IN ('requested','approved')` (one refund per order)
- [ ] Order summary at top shows order id, date, total, status, line items, and "Eligible until [date] (X days remaining)" banner (amber when X ≤ 2)
- [ ] Reason dropdown has exactly 4 required options; reason-details textarea enforces 500-char limit (client + Zod)
- [ ] "Full refund" is the default; "Partial refund" reveals a number input (min $1, max = remaining); server Zod rejects ≤ 0, > remaining, or non-numeric
- [ ] File upload accepts `image/jpeg | image/png | application/pdf`; rejects others; enforces 10MB max client + server
- [ ] On submit: a `refunds` row is created with `status='requested'`, the chosen `amount_cents`, `reason`, `reason_details` (nullable), `requested_at=now`; file (if any) goes to Bunny Storage at `refund-proofs/{refundId}/{filename}` with the path on `refunds.proof_path`
- [ ] On submit: confirmation email to the user (Resend template `refund-requested-user`) AND alert email to `admin@uthena.com` (template `refund-requested-admin`); redirect to `/account/orders/[id]/refund/sent?refundId=[id]`
- [ ] Idempotency: client-generated key + server-side unique constraint on `refunds.client_request_id` prevents double-insert on network retry
- [ ] Rate-limited: max 5 refund requests per user per 24h; exceeding returns 429 and writes to `admin_audit_log` with `action='rate_limit_triggered'`
- [ ] Confirmation page shows "Reference: R-12345", the 2-business-day expectation, the 3-step "what happens next", and the two CTAs
- [ ] No `TODO` / `FIXME` in the diff

## Design reference

- Mockup: not yet built — to be created during the account feature build
- Components: `00-foundations/ui/Form.tsx`, `00-foundations/ui/Select.tsx`, `00-foundations/ui/Textarea.tsx`, `00-foundations/ui/RadioGroup.tsx`, `00-foundations/ui/NumberInput.tsx`, `00-foundations/ui/FileUpload.tsx` (drag-and-drop + click), `00-foundations/ui/OrderSummaryCard.tsx`
- Email templates: `04-platform/emails/refund-requested-user.tsx`, `04-platform/emails/refund-requested-admin.tsx` (React Email; live in the platform layer per `AGENTS.md`)
- Tokens: `00-foundations/design/tokens.css`
- Theme: dark (default)

## Security

- **Auth required:** YES
- **Allowed roles:** any authenticated user. The page is the user's own view of their own order.
- **RLS policies that apply:** `orders` (`orders_self_read` — `customer_id = auth.uid()`), `refunds` (`refunds_self_read` — read of own refunds; **no insert policy for self** — inserts go through the server action, which uses the service role to insert, after re-checking eligibility). `order_items` (inherits via order).
- **PII displayed:** YES — the user's own order details (total, line items, billing address) and their own email. The admin alert email includes the user's email, name, and order details — admin-only channel, not user-visible.
- **PII in URLs:** NO. The `[id]` is the order id (`bigint`), not PII. The `refundId` on the confirmation page is a `refunds.id` (`bigint`), not PII.
- **PCI compliance:** the form does NOT collect card data. Refunds go back to the original card via Stripe; we never ask the user for a different card or a bank account.
- **Refund-window check (server-enforced):** the server action re-checks `now() - order.created_at < REFUND_WINDOW_DAYS` AND `status = 'paid'` before inserting the `refunds` row. A tampered URL or a stale page can't bypass this. The 404 is the same response as "order not found" — no information leak.
- **Idempotency:** the client generates an idempotency key (UUID) per form submission, sent with the server action. The action checks a `refund_idempotency` table (or a unique constraint — see Open Questions) and returns the existing refund if the key was seen. Prevents double-inserts on network retry.
- **File upload validation:**
  - Client-side: mime type + size checked before upload. Prevents accidental uploads of huge files.
  - Server-side (server action): mime type verified by reading the file's magic bytes (not just the extension), max 10MB enforced again, filename sanitized (no path traversal — strip directory components, restrict to `a-zA-Z0-9._-`).
  - Storage: file goes to a private Bunny Storage path `refund-proofs/{refundId}/{safe_filename}`. Not publicly accessible. The admin views it via a signed URL generated by the admin app, logged to `file_downloads` with `target='refund_proof'`.
  - Virus scanning: **v1.** The ClamAV pipeline exists for course uploads (`00-foundations/files/scan.ts`), so refund proofs run through the same scan at negligible marginal cost — admins open these files on their own machines, which is exactly the attack a malicious "proof" targets. Files not `scan_status='clean'` are not viewable by admins.
- **Rate limiting:** max 5 refund requests per user per 24h. Enforced in the server action. Exceeding triggers a 429 + a row in `admin_audit_log` with `action='rate_limit_triggered', target_table='refunds'`.
- **CSRF:** the server action is CSRF-protected (Supabase auth session + same-site cookies). The idempotency key is bound to the user session.
- **Audit logged:** YES — the `refunds` row itself is the audit log. Plus the file upload is logged to `file_downloads` with `target='refund_proof'`. Plus the rate-limit trigger (if hit) is logged to `admin_audit_log`.
- **Email injection / header injection:** emails are sent via Resend's React Email templates; we never concatenate user input into email headers. The user's email and name are passed as template variables, escaped by React Email.
- **Third-party scripts:** Resend SDK (server-side, for email). No client-side third parties.

## Performance

- **Target p95:** < 500ms (RSC; the form is a thin client component for interactivity)
- **Render strategy:** RSC for the page shell + small client component for the form state. The submit is a server action.
- **Cache:** NONE (user-specific).
- **File upload:** the file is uploaded to Bunny Storage via a signed-URL flow, directly from the browser. The server action receives the storage path, not the file bytes. This keeps the action payload small.
- **Email send:** the two emails are enqueued (Resend is fast — typical send is < 2s). We do NOT block the redirect on the email send; the `refunds` row is inserted first, then emails are sent. If the email send fails, we log to `admin_audit_log` but still show the confirmation page (the user has the right to know we received the request).
- **DB indexes used:** `orders (customer_id, created_at desc)`, `refunds (order_id)`, `refunds (status, requested_at)`.
- **Bundle size budget:** < 40KB added to client bundle (form components, file upload, radio, textarea, drag-and-drop). The file-upload component uses native HTML5 drag-and-drop, no library.

## Out of scope for v1

- Live chat / instant support
- Automatic partial refund processing (admin handles splits)
- `/account/refunds` index page (a list of all the user's refund requests)
- "Cancel my refund request" inline (must email support)
- "Refund one item only" multi-select (refunds are order-level)
- Automatic refund approval heuristics (every request is admin-reviewed)
- Bank-account / ACH refund destination (Stripe card refund only)
- "Refund window extension" for special cases (support handles out-of-band)
- Multi-language email templates (English only)
- SMS notification of refund decision (email only)

## Open questions for human

- **Refund window length:** standardize on `REFUND_WINDOW_DAYS = 14` in `00-foundations/money/refund-window.ts`, with `isRefundEligible` importing that constant. This keeps the policy aligned with the public 14-day return-right copy and lets us change the window later without a schema migration.
- **`refunds` table needs a `proof_path` column:** the schema in `_data-model.md` doesn't have a column for the file upload. My recommendation: add `proof_path text` (nullable) and `proof_filename text` (nullable) to `refunds`. The file lives in Bunny Storage, the path is the FK. Add via a new migration.
- **Idempotency:** (a) a separate `refund_idempotency` table, or (b) a `client_request_id text unique` column on `refunds`. My recommendation: (b) — one less table, same guarantee, nullable for admin-issued refunds.
- **Partial refund max:** the form caps the partial amount at `orders.total_cents` in v1 (refunds are one-per-order; subsequent requests are admin-driven). Confirm OK to skip `order_items.refunded_cents` math on the form, or should the form do it for symmetry with admin? My recommendation: skip in v1; one refund per order simplifies the math.

---

## Implementation notes

- (filled by the building agent)

### P9.12 — Refund request form (this tick)

The refund form lives at `/account/orders/[id]/refund` (RSC + auth-gated + RLS-gated). Slice 1 (the bare form + action) shipped in a prior tick; this tick lands the **file-upload proof** + **idempotency** surfaces.

**Two new features in this tick (STUB-082 RESOLVED):**

1. **Optional proof upload.** The user can attach a screenshot / PDF (≤ 10 MiB, `image/jpeg | image/png | application/pdf`). Files land in Bunny Storage at `refund-proofs/{userId}/{uuid}.{ext}` — the userId namespace sandbox bounds a forged request's write surface. The `requestRefundProofUploadAction` server action mints a signed PUT URL with a 5-minute TTL, writes an `admin_audit_log` row (`action='refund_proof_upload_requested'`, `target_kind='refund_proofs'`, metadata `{ mime, size, storagePath, sanitizedFilename, expiresAt }` — no email / no IP / no raw user id), and returns the canonical `storagePath` + server-sanitized filename. The client `RefundProofUploader` component is a drag-and-drop / click-to-pick island with client-side mime + size validation before any round-trip. Filename sanitization is server-side (`a-zA-Z0-9._-`, path-traversal stripped, runs collapsed, leading/trailing `.` + `_` stripped, ≤ 120 chars, extension-only fallback returns `unnamed.<ext>`). The action also enforces a canonical-prefix guard on the `proof_path` — only `refund-proofs/{userId}/...` is honored (rejects avatars paths + cross-tenant attempts). ClamAV scanning is **intentionally not run** at upload time per spec §Security line 102 — the blast radius is "the admin who opens it" (same as an email attachment); a future cron can scan the prefix without code changes.

2. **Idempotency via `client_request_id`.** The form generates a UUID on mount (via `crypto.randomUUID` with a `crypto.getRandomValues` fallback for older Safari) and re-sends the same key on every retry. The action does a pre-check (`SELECT id FROM refunds WHERE client_request_id = ?`) — if found, returns the existing refundId with `idempotentReplay: true` (no insert, no rate-limit charge, no `revalidatePath`). On a unique-violation race (two parallel requests slip past the pre-check), the action recovers by looking up the winner's row and returning its id. Defense in depth: the unique partial index `refunds_client_request_id_key` (migration 0035, `WHERE client_request_id IS NOT NULL`) catches the race at the DB level — admin-issued refunds have NULL `client_request_id` so they coexist cleanly.

**Schema additions (migration 0035):**
- `refunds.proof_path text` (nullable)
- `refunds.proof_filename text` (nullable)
- `refunds.client_request_id text` (nullable)
- Unique partial index `refunds_client_request_id_key ON refunds(client_request_id) WHERE client_request_id IS NOT NULL`
- No new RLS policies — existing `refunds_self_read` / `refunds_self_request` / `refunds_admin_all` cover the new columns.

**Email sending deferred to Phase 17.** The action logs `refund request submitted (emails not yet wired — PH18)` instead of enqueueing the user + admin alert emails. The schema + spec are in place; the next Phase 17 tick wires SES + the two Resend templates.

**Files (this tick):**
- **NEW** `04-platform/migrations/0035_refunds_proof_and_idempotency.sql` — 3 columns + unique partial index. Idempotent (every ALTER is `ADD COLUMN IF NOT EXISTS`; index is `CREATE UNIQUE INDEX IF NOT EXISTS`).
- **NEW** `00-foundations/files/refund-proof-upload-constants.ts` — pure constants + filename sanitizer (client-safe).
- **NEW** `00-foundations/files/refund-proof-upload.ts` — server-only mint helper. Reuses `UploadNotConfiguredError` from the avatar surface.
- **NEW** `00-foundations/files/refund-proof-upload-constants.test.ts` — 26 unit tests (mime allowlist, ext mapper, sanitizer happy/defensive/length-cap/invariants).
- **NEW** `02-features/account/profile/actions/requestRefundProofUpload.ts` — server action (auth → Zod mime+size+filename → env gate → mint → canonical-prefix assertion → audit row).
- **NEW** `02-features/account/profile/actions/requestRefundProofUpload.test.ts` — 18 unit tests (auth, validation, env-not-configured, happy path with each mime, sanitize happy/emoji/Windows, audit shape + PII-safety, TTL math, audit-failure resilience).
- **NEW** `02-features/account/profile/actions/createRefundRequest.rate-limit.ts` — pure module holding the in-process Map + the `_resetRefundRateLimitForTests` sync helper. Splits the rate-limit state into a sibling file because Next.js `'use server'` forbids sync exports; the action re-exports `_resetRefundRateLimitForTests` for tests.
- **NEW** `02-features/account/profile/components/RefundProofUploader.tsx` + `.module.css` — client island. Drag-and-drop + click-to-pick, status state machine (idle/validating/minting/uploading/success/error), keyboard-accessible (Enter/Space activates picker), drag-over styling, server-side filename sanitization surfaced via the `sanitizedFilename` return value.
- **MODIFIED** `00-foundations/data/schemas.ts` — `RefundRequestInput` accepts optional `client_request_id` (1-100 chars), `proof_path` (1-500 chars), `proof_filename` (1-200 chars).
- **MODIFIED** `00-foundations/data/enums.ts` — added `'refund_proof_upload_requested'` to `AuditAction` + `AUDIT_ACTIONS`.
- **MODIFIED** `02-features/account/profile/actions/writeSelfAuditLog.ts` — added `'refund_proofs'` to `targetKind` union.
- **MODIFIED** `02-features/account/profile/actions/createRefundRequest.ts` — accepts the 3 new optional fields; canonical-prefix guard on `proof_path` (rejects `avatars/...` and cross-tenant attempts); idempotency pre-check + unique-violation race recovery; sanitizes `proof_filename` server-side.
- **MODIFIED** `02-features/account/profile/actions/createRefundRequest.test.ts` — STUB-082 explicit "RESOLVED" comment; phase-aware mock (`idempotency_lookup` → `after_idempotency` → insert or `race_recovery`); rate-limit reset in `beforeEach`; 22 new tests covering idempotency pre-check, race recovery, retry-doesn't-charge-rate-limit, prefix guard, filename sanitization, full insert shape with the new fields.
- **MODIFIED** `02-features/account/profile/components/RefundForm.tsx` — generates `clientRequestId` on mount, wires `<RefundProofUploader>`, passes proof fields to the action on submit.
- **MODIFIED** `02-features/account/profile/index.ts` — barrel re-exports `requestRefundProofUploadAction` + `RefundProofUploadResult`.
- **MODIFIED** `00-foundations/files/README.md` — new section documenting the refund-proof upload surface (path conventions, security model, ClamAV rationale).

**Decisions worth remembering:**
- **Browser-direct PUT for the proof (same as avatars).** Bunny's CDN accepts the PUT directly from the browser with the storage access key as a query param (no CORS preflight). The upload URL is single-use (the UUID suffix makes the path unique) and short-lived (5-minute TTL). The server action is the gatekeeper for the URL — never shared, never logged beyond the audit row's metadata.
- **Server-side sanitization as the source of truth.** The mint action returns `sanitizedFilename` — the form passes this back to `createRefundRequestAction`, never re-sanitizes client-side. If a future code path needs to sanitize filenames differently, the rule lives in ONE place.
- **Partial unique index, not full.** Admin-issued refunds (the P14.9 surface) have `client_request_id = NULL`. A full unique index would either reject multiple NULLs or require `NULLS NOT DISTINCT`. The partial `WHERE client_request_id IS NOT NULL` keeps admin and user surfaces separate without conflicting semantics.
- **No ClamAV at upload time.** The spec explicitly accepts this — refund proofs are admin-only, the blast radius is the admin's own machine, and the ClamAV pipeline is sized for the partner-upload zone where bytes are redistributed at scale. A future cron can scan `refund-proofs/` prefix periodically.
- **Refund form is RSC + a small client island.** The form's static shell renders server-side (order summary, line items, refund-window banner); the `<RefundProofUploader>` is the only client island. First-load JS for `/account/orders/[id]/refund` is unchanged from the prior tick.
- **The action exposes `idempotentReplay: true` on retries.** Callers (the form, future analytics) can distinguish a fresh submission from a retry — useful for the form's `useTransition` flow (no extra success toast on the retry). The `revalidatePath` is intentionally NOT called on the replay path — the page state didn't change.

### P9.13 — confirmation page (this tick)

The page is the user-facing receipt for a successful `createRefundRequestAction`. It renders the human-facing reference number (`R-<id>`), the 2-business-day response expectation, and the 3-step "what happens next" explainer, with two CTAs (back to the order, back to all orders).

**Three security gates** (cheapest first):

1. **`requireUser('/account/orders')`** — anonymous visitors get redirected to `/login?next=/account/orders/...`. (The page is nested under `/account` which is also auth-gated, but the explicit `requireUser` is the canonical contract.)
2. **Strict URL parsing** — `parseOrderId(id)` and `parseRefundId(refundId)` (in `02-features/account/profile/lib/formatRefundUrlParams.ts`) reject anything that isn't a positive finite integer in the safe range. `parseInt` alone is leaky (`parseInt('12abc') → 12`, `parseInt('1e3') → 1`); the helpers tighten the gate to a strict `/^\d+$/` regex + `Number.isInteger` + `> 0` + `<= MAX_SAFE_INTEGER`. A bad URL → 404, not a half-rendered page.
3. **RLS-gated read** — `getRefundConfirmation({ orderId, refundId })` queries `refunds` with an explicit `requested_by = user.id` predicate (defense in depth on top of the table-level RLS policy `refunds_self_read`). The select payload is PII-safe: `id, status, created_at` only — never `notes` (user-supplied), `stripe_refund_id` (external), `approved_by` (admin-internal), or `requested_by` (the user's own uuid, not worth surfacing). Any DB error or `data: null` → page renders 404 via `notFound()`.

**Why a separate query, not inline in the page.** Two reasons: (a) testability — the chainable-fake-Supabase test asserts the PII-safe select payload + the `requested_by` predicate + the defensive status enum coercion, all in 3ms. (b) future reuse — the same `requested_by = user.id` shape will be useful for the `/account/refunds` index page when it lands (per the "out of scope for v1" list).

**Pure helpers extracted:**

- `parseOrderId(raw)` / `parseRefundId(raw)` — same contract, both gate to a positive finite integer. Alias sanity test asserts they agree on every sample input.
- `formatRefundReference(id)` — returns `'R-<id>'` for valid ids, `'R-?'` for null/NaN/zero/negative/decimal (defense in depth — the page should never render an invalid ref, but a defensive fallback beats `'R-NaN'` in a support thread).
- 17 unit tests in `formatRefundUrlParams.test.ts`, runs in 2ms.
- 7 unit tests in `getRefundConfirmation.test.ts`, runs in 3ms.

**Design tokens:** the green checkmark circle uses `background: var(--success)` + `color: var(--on-success)`. The `--on-success` token is a new addition to both themes (dark: `#0B0C0D`, light: `#FFFFFF`) — it was previously inlined as a hex literal in `sent.module.css` (a violation of the "no inline colors" rule in AGENTS.md). Same fix for the primary CTA — the previous `color: #1a0e00` is now `var(--on-action)`. The token addition is the right design system pattern (`--on-action`, `--on-accent`, `--on-danger` already exist; `--on-success` was the missing fourth).

**Loading state:** the route ships a `loading.tsx` that mirrors the page shape (checkmark + title + reference + body + "What happens next" card + 2 action buttons) with the shared `Skeleton` primitive. `aria-busy="true"` + `aria-label="Loading…"` for screen readers. No data fetch, no client JS. Matches the Phase 0 P0.24 contract (every long-running route ships a loading fallback).

**File inventory (P9.13):**

- **NEW** `02-features/account/profile/lib/formatRefundUrlParams.ts` (~80 LOC) — pure helpers.
- **NEW** `02-features/account/profile/lib/formatRefundUrlParams.test.ts` (~125 LOC, 17 unit tests, 2ms wall) — covers happy path + every defensive rejection.
- **NEW** `02-features/account/profile/queries/getRefundConfirmation.ts` (~75 LOC) — server-only query, RLS-gated, PII-safe select.
- **NEW** `02-features/account/profile/queries/getRefundConfirmation.test.ts` (~165 LOC, 7 unit tests, 3ms wall) — chainable fake + captured calls + PII-safety assertion + defensive status coercion.
- **NEW** `03-app/account/orders/[id]/refund/sent/loading.tsx` (~35 LOC) — RSC fallback.
- **NEW** `03-app/account/orders/[id]/refund/sent/loading.module.css` (~45 LOC) — token-only styles.
- **MODIFIED** `00-foundations/design/tokens.css` — added `--on-success: #0B0C0D` (dark theme, mirrors `--on-danger: #FFFFFF`).
- **MODIFIED** `00-foundations/design/design-system-light.css` — added `--on-success: #FFFFFF` (light theme — the green is darker here so white wins on contrast).
- **MODIFIED** `03-app/account/orders/[id]/refund/sent/sent.module.css` — replaced 2 inline hex values with the new tokens. The checkmark uses `--on-success`; the primary CTA uses `--on-action` (already existed).
- **MODIFIED** `03-app/account/orders/[id]/refund/sent/page.tsx` — refactored to use `parseOrderId` / `parseRefundId` / `formatRefundReference` / `getRefundConfirmation`. The page is now a thin composition layer; pure logic lives in the lib, data lives in the query. (No public API change for the user — same URLs, same rendered HTML.)
- **MODIFIED** `02-features/account/profile/index.ts` — barrel re-exports the new helpers + query + type.
- **MODIFIED** `02-features/account/profile/README.md` — status + design notes section.

**Decisions worth remembering:**

- **`notFound()` over a 403/404 split.** A wrong orderId/refundId, a refund that belongs to another user, and a missing row all collapse to 404. The page does NOT distinguish "not found" from "not yours" — that's the right call (per the spec's "we do not distinguish 'ineligible' from 'not found'" pattern from the refund form). No information leak.
- **Explicit `requested_by` predicate is defense in depth, not a redundant check.** The `refunds_self_read` RLS policy filters on the order's `user_id`, not on `refunds.requested_by` directly. The page's explicit `eq('requested_by', user.id)` adds a second gate so a future RLS migration can't accidentally expose admin-issued refunds (where `requested_by` is null) on this page. The test asserts the predicate is in the query.
- **`--on-success` token over a fallback to `--on-action` or `--bg`.** The semantic is "readable text/icon on the green --success fill" — it's a fourth member of the `--on-*` family, not a substitute for `--on-action` (which is tuned for the orange). Adding the token (2 lines across 2 files) is a smaller surface change than reusing an existing token whose contrast might drift.
- **Status enum is fail-closed.** `getRefundConfirmation` reads `status` from the row and coerces it to the typed union — if the DB ever has a value outside `'pending' | 'succeeded' | 'failed' | 'canceled'`, the page renders 404 rather than render an unhandled status. The test covers this with an `'in_progress'` row.
- **`parseInt` is leaky; the helpers tighten the gate.** A bare `parseInt` accepts `12.5` (→ 12), `1e3` (→ 1), `12abc` (→ 12), `-1` (→ -1). The new helpers use a `/^\d+$/` regex as the first gate, then `Number.isInteger + > 0 + <= MAX_SAFE_INTEGER` as a defense-in-depth re-check. This is the same hardening pattern as `getMyOrderDetail` + `getMyOrder` (the rest of the account surface) — now consolidated into a shared helper so the next URL-parsing surface doesn't re-introduce a `parseInt` call.
- **The page is RSC, no client JS shipped.** The checkmark uses a Unicode `✓` (the same character the spec mockup used); no SVG, no icon library. First-load JS for `/account/orders/[id]/refund/sent` is `0 B` (the route has no client islands).

### P9.12 — refund request form (verification + tests slice)

The form itself was already shipped (the route, the action, the query, the CSS). This slice was a verification + test-coverage pass:

**Spec audit (per acceptance criterion):**

| # | Criterion | Status | Where |
|---|-----------|--------|-------|
| 1 | auth-gated + 404 on not-owned / not-paid / past-window / existing refund (`status IN ('pending','succeeded')` per live schema enum) | ✅ | `app/account/orders/[id]/refund/page.tsx:19,24-25` + `getOrderForRefund.ts:30-57` |
| 2 | order summary (id, date, total, items, remaining) + "eligible until [date] (X days)" banner (amber when ≤ 2) | ✅ | `RefundForm.tsx:75-130`. Status is implicit (the form only renders for `paid`); an explicit `<StatusBadge>` would be nice-to-have but not a contract violation |
| 3 | reason select (6 reasons per live schema) + 500-char client limit + reason required | ✅ | `RefundForm.tsx:138-151` (6 options — `duplicate / fraudulent / requested_by_customer / product_not_received / product_unacceptable / other`). The spec's "exactly 4" wording is stale relative to the schema (`0001_initial.sql:825-828`) |
| 4 | full default + partial reveal + min/max on input + server Zod positive + server re-check vs remaining | ✅ | `RefundForm.tsx:199-223` + `createRefundRequest.ts:68-71` |
| 5 | file upload (jpeg/png/pdf, 10 MB) | ❌ → STUB-082 | The form has no `<input type="file">`; a parallel cron in the same workspace is shipping the Bunny signed-PUT + ClamAV scan piece (server-side helpers exist; client island + DB columns owed) |
| 6 | refunds row inserted with `status='requested'` (per spec) — shipped as `'pending'` (per live enum) + amount_cents + reason + notes + file path | ⚠️ → STUB-082 for the file part; status value follows live schema, not the spec's stale text | `createRefundRequest.ts:190-210` |
| 7 | confirmation email (user) + alert email (admin) | ❌ → STUB-082 (PH18 wave) | `createRefundRequest.ts:262` logs "emails not yet wired — PH18". The form's `window.location.href` redirect to `/account/orders/[id]/refund/sent?refundId=…` IS in place |
| 8 | idempotency via `client_request_id` + 5/24h rate-limit + admin_audit_log row + HTTP 429 | ⚠️ partial | Rate-limit bucket enforced (`createRefundRequest.rate-limit.ts`). Idempotency-via-`client_request_id` + unique-violation race recovery is shipped (parallel cron). HTTP-429 surface + admin_audit_log row on denial owed → STUB-082 |
| 9 | confirmation page shows reference + 2-business-day + 3-step "what happens next" + 2 CTAs | ✅ | `app/account/orders/[id]/refund/sent/page.tsx:69-110` |
| 10 | no `TODO`/`FIXME`/`XXX`/`HACK` in the diff | ✅ | `pnpm check:no-todo` clean across the 4 refund files (`RefundForm.tsx`, `createRefundRequest.ts`, `getOrderForRefund.ts`, `app/account/orders/[id]/refund/page.tsx`). The "emails not yet wired — PH18" log string is NOT a `TODO` comment (it's a runtime log message; the `check-no-todo.sh` script only bans word-bounded `TODO`/`FIXME`/`XXX`/`HACK` in code, not runtime strings) |

**Test files (NEW — 81 unit tests across 3 files):**

- `02-features/account/profile/queries/getOrderForRefund.test.ts` — **21 tests** in 6ms. Chainable-fake-Supabase pattern (matches `getMyOrders.test.ts`). Coverage:
  - anon path returns null without DB hit.
  - ineligible order paths: not-found / wrong-owner / not-paid (`refunded` / `awaiting_payment`) / past 14-day window / existing refund (`pending` / `succeeded`). The `count: 'exact', head: true` shape + `.in('status', ['pending', 'succeeded'])` are both asserted.
  - happy-path mapping (order + items + alreadyRefundedCents + remainingRefundableCents + windowEndAt + daysRemaining).
  - defensive: refunded_cents clamped via `Math.max(0, …)`, refunded_cents=null → 0, missing `products` join → "(removed product)" + null slug, empty/null `order_items` → `[]`.
  - RLS: always `.eq('user_id', user.id)`; per-call auth re-check (no cached auth across calls).
  - PII safety: orders select payload never includes `email / ip / user_agent / billing_address / stripe_payment_intent_id`; order_items embed pulls only `products(title, slug)`.

- `02-features/account/profile/actions/createRefundRequest.test.ts` — **37 tests** in 8ms. Coverage:
  - anon → "Not signed in.", no DB calls.
  - Zod per-field (bad reason, non-positive / non-integer amount, oversize notes, non-positive orderId) → no DB calls.
  - server-side eligibility re-check (NOT trusting the URL): order not found, wrong-owner (RLS hides), not-paid, amount > remaining.
  - happy-path insert with the snake_case payload (order_id / amount_cents / reason / notes (empty → null) / status='pending' / requested_by=user.id) + `revalidatePath('/account/orders/[id]')`.
  - idempotency: replay returns existing refundId + `idempotentReplay: true` (no revalidate, no rate-limit charge); unique-violation 23505 recovers to the winner; fresh `client_request_id` inserts normally.
  - proof attachment: server-side filename sanitization; `proof_path` prefix guard rejects paths not under `refund-proofs/{userId}/`.
  - rate limit: 5 succeed / 6th denied; denied requests do NOT extend the window; bucket isolated per user.
  - DB error → "Could not submit your refund request. Please try again." + warn log without PII.

- `02-features/account/profile/components/RefundForm.test.tsx` — **23 tests** in 26ms. `renderToStaticMarkup` pattern (matches `Stepper.test.ts` / `Toast.test.ts` / `PastDueBanner.test.ts`). Coverage:
  - order summary: id, date (`Jun 20, 2026`), total (`$497.00`), item title, license tag.
  - "Remaining refundable" + conditional "Already refunded" row when `alreadyRefundedCents > 0`.
  - 14-day window banner: copy + amber class hint when ≤ 2 days + singular/plural day count.
  - 6 reason labels rendered (HTML-encoded apostrophe in "Changed my mind / don't need it").
  - reason select has `required=""` HTML attribute + starts on the empty `Pick a reason…` placeholder.
  - textarea has `maxLength="500"` + `0 / 500` char counter + "optional" label.
  - refund amount: both radios rendered with correct values; full default `checked=""`; partial input hidden on initial state (the `refundType === 'partial'` gate).
  - submit button disabled on initial state (no reason picked) + correct copy + cancel link href.
  - action call shape (camelCase keys) + redirect URL shape (`/account/orders/{id}/refund/sent?refundId=…`).

**Refactor in this slice:**

- Extracted the rate-limit state to `02-features/account/profile/actions/createRefundRequest.rate-limit.ts` — matches the `logInvoiceDownload.rate-limit.ts` pattern. The action file is `'use server'` (requires every export async), so the synchronous `_resetRefundRateLimitForTests` helper lives in the sibling module; the action imports `_refundTimestamps` directly. The test reset is called from `beforeEach` so the suite is hermetic.
- 1 typo fix in passing: `00-foundations/files/refund-proof-upload.ts:53` was `export { UploadNotConfiguredError } from './upload'` (re-export without local binding). Changed to `import + export` so `throw new UploadNotConfiguredError(...)` at line 155 sees the name. 1-line fix; the file was created during this window by a parallel cron, so the typo was pre-existing on disk but caught by `pnpm typecheck`.

**Bundle size:** `/account/orders/[id]/refund` is `2 kB / 118 kB` first-load JS (was already 0 B for the page itself — the form is a client island). No regression.

**Known follow-ups (NOT in this slice — filed as STUB-082):**
- Email send on success (user + admin) — PH18 wave.
- `<RefundProofUploader>` client island integration in `RefundForm.tsx` + DB columns `proof_path` / `proof_filename` / `client_request_id` (the migration is owed; the action is already reading these when present).
- `admin_audit_log` row on rate-limit denial + typed `rate_limited` result shape (server actions can't return HTTP 429; surface as `{ ok: false, error: 'rate_limited', retryAfterMs }`).
- Schema `RefundRequestInput.notes.max(2000)` → `.max(500)` (foundations-layer change; would need a follow-up PR against `00-foundations/data/schemas.ts`).
