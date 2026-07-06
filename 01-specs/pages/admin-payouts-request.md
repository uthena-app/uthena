# Admin Payout Request Detail — `/admin/payouts/request/[id]`

> Admin-only detail page for a single `payout_requests` row. Hosts the approve / deny / mark-paid actions.

## What this page does

A single RSC that renders:
1. The request's status + amount + PayPal target (masked) + creation time.
2. The locked ledger rows that the request encompasses.
3. A right-rail action island (`<PayoutRequestActions>`) with three buttons: **Approve** (status `pending` only), **Deny** (`pending` or `approved`), **Mark paid** (`approved` only). Each opens a typed-confirmation modal.
4. A link back to the per-partner view.

## Data this page shows

| Field | Source |
|---|---|
| Status, amount, currency, denial_reason, processed_at, metadata | `payout_requests` row |
| PayPal email (masked only) | `payout_method_target_masked` column on the row — never the plaintext from `partners.payout_method` |
| Partner name + per-partner detail | `partners.public_slug` + `get_admin_partner_detail` RPC |
| Locked ledger rows | `payout_ledger` filtered to `status='pending_payout'` (or `paid`) for the partner |

## User actions

| Action | Surface | RBAC |
|---|---|---|
| Approve | `<ApproveModal>` typed `APPROVE` confirmation | admin / super_admin |
| Deny | `<DenyModal>` text-area reason (1-500 chars) | admin / super_admin |
| Mark paid | `<MarkPaidModal>` external reference (1-200 chars) | admin / super_admin |

Each action writes a `payout_request_approved` / `payout_request_denied` / `payout_request_marked_paid` row to `admin_audit_log` with hashed identifiers. Denial ALSO flips the locked ledger rows (`status='pending_payout'`) back to `status='available'` so the partner's balance updates on the next ledger read.

## What this page does NOT do

- It does NOT mint a PayPal Mass Payout call yet (deferred to STUB-057 — `payout_batch_id` capture will land in a follow-up once `PAYPAL_CLIENT_ID` + `PAYPAL_SECRET` are wired in Doppler).
- It does NOT show the partner's other payout history (use `/admin/payouts/partner/[id]` for that).
- It does NOT allow editing the amount or partner (those are immutable once a request is created).

## Acceptance criteria

- [ ] Auth-gated by `/admin/layout.tsx` `requireRole(['admin','super_admin'])`.
- [ ] Returns 404 on missing access (defense in depth).
- [ ] Renders the request's status, amount, currency, partner (linked to `/admin/payouts/partner/[id]`).
- [ ] Renders the locked ledger rows in chronological order with kind + amount + description.
- [ ] Right-rail action island shows the correct action for the current status.
- [ ] Approve requires typed `APPROVE` confirmation, updates status to `approved`, writes audit row.
- [ ] Deny requires a 1-500-char reason, updates status to `denied`, releases ledger rows to `available`, writes audit row.
- [ ] Mark paid requires a 1-200-char external reference, updates status to `paid`, flips ledger rows to `paid`, writes audit row.
- [ ] All 6 checks green, `pnpm build` clean, tests pass.
- [ ] Token-only CSS, no inline colors.
- [ ] No PII in logs (audit uses hashed identifiers).

## Security

- **Auth.** `requireRole(['admin','super_admin'])` at the layout level.
- **PII.** PayPal email is masked on the `payout_requests` row. The plaintext in `partners.payout_method` is never read by this page.
- **Audit.** Every state transition writes one `admin_audit_log` row with hashed identifiers.
- **Optimistic concurrency.** Approve uses `UPDATE … WHERE status='pending'` so a concurrent admin action is rejected at the DB level.
- **No secrets in client.** Mark-paid's reference is plaintext (per admin UX); we don't redirect it to a credential, just persist it as the user's reference.

## Performance

- The page is `force-dynamic`. 2 round-trips on render: (1) the `payout_requests` row, (2) a parallel fan-out (partner + detail RPC + locked ledger rows).
- No client JS shipped; only the action island is interactive.

## Out of scope for v1

- Real PayPal Mass Payout integration (STUB-057).
- Re-approve a denied request (admin would just queue a NEW request via the partner's `/partner/payouts`).
- Clawback (STUB-058).

## Phase coverage

| Phase | Component |
|---|---|
| P6.7 Slice 1 | The read-only queue at `/admin/payouts` (already shipped) |
| **P14.10** | This page + approve/deny/mark-paid actions |
