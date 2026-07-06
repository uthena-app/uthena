# Feature: affiliate-onboarding

The 6-step affiliate onboarding wizard at `/affiliate/onboarding`.
Turns a logged-in customer into a `pending` affiliate row.

- **Spec:** `01-specs/pages/affiliate-onboarding.md` (+ future welcome/thanks)
- **Owner:** unassigned — claimed by the implementing agent at build start
- **Depends on:** `auth`, `00-foundations/auth/reserved-handles.ts`,
  `00-foundations/data`, `00-foundations/ui/Toast`, `00-foundations/ui/Stepper`,
  `00-foundations/ui/primitives/Button`
- **Depended on by:** `affiliate-portal` (mini-shop `/[handle]` P13.8 + dashboard
  P13.3 read the resulting `affiliates` row), `admin` (approval queue P14.3)

## Status

- [x] **P13.1 — Affiliate onboarding wizard (Slice 1)** — wizard route shell
      + 4-state dispatch (anon → `/signup?next=`; approved → `/affiliate`;
      pending → `<PendingReview>`; default → wizard) + `AffiliateOnboardingShell`
      + `WelcomeStep` + `HandleBioStep` (the critical step with race-safe
      handle reservation) + `PendingReview` + `StepPlaceholder` for steps 3-6
      + `getMyOnboardingDraft` + `getMyAffiliateApplicationStatus` queries +
      `parseStep` URL parser + `saveStepSchema` Zod for all 6 step payloads +
      `saveStepAction` server action (full handle reservation race-safety +
      per-step column merge + never-regress currentStep + 60/min/user rate
      limit + audit log) + per-user page rate limit (60/min/page) +
      foundation `reserved-handles.ts` (the canonical list + helpers) +
      migration `0045_affiliate_onboarding.sql` (table + RLS + indexes +
      step enum + `handle_reservations` race-safety table) +
      `app/affiliate/onboarding/{page,loading,error,not-found}` route +
      hardlinks in `03-app/affiliate/onboarding/` + `audited_log` action
      + `audit_log.target_kind` extension + 168 new unit tests (full suite
      now 3517 passing).

## What's deferred (Slice 2+)

- **Per-step forms for Payout / Promo methods / Agreement / Submit.**
  Each ships as its own client island + server-action call, mirroring
  the `HandleBioStep` pattern. The StepPlaceholder already renders
  accurate copy so the wizard advances end-to-end today.
- **Avatar upload at step 2 (Bunny signed PUT + ClamAV scan + a real
  `avatar_storage_path` round-trip).** The Zod schema accepts the field
  on the wire so future slices plug in cleanly.
- **Real-time debounced availability check at step 2.** Today the form
  validates shape on submit and shows server-side conflict errors after
  the save lands. The 300ms-debounced preview check ships in Slice 2+.
- **Atomic submit at step 6** — the `submit` step's server action creates
  the `affiliates` row, transfers the handle reservation (one
  transaction: INSERT into `affiliates` + DELETE from `handle_reservations`),
  and queues the 2 emails (admin alert + user confirmation).
- **7-day reservation janitor cron** (STUB-103a) — sweeps
  `handle_reservations` rows past their `expires_at`.
- **Start over / restart wizard** — wipes the draft + releases the
  reservation. STUB-089 (parked; partner onboarding has the same
  carve-out).

## Architecture notes

### Race-safe handle reservation

The `handle_reservations.handle` PRIMARY KEY is the race-safety arbiter
(see `_data-model.md` §"`handle_reservations` — race-safe handle uniqueness
during affiliate onboarding"). Two concurrent users picking "alice" race
in the DB; exactly one INSERT succeeds; the other gets SQLSTATE 23505
(unique_violation) which the `saveStepAction` maps to
`{ code: 'handle_conflict', handleConflict: true }` so the wizard can
keep the user on step 2 and show a friendly "this handle is already taken"
message.

### Per-step jsonb columns (not a single payload)

Unlike `partner_onboarding_drafts` (which uses a single `payload` jsonb),
`affiliate_onboarding_drafts` ships per-step jsonb columns
(`handle_bio` / `payout` / `promo_methods` / `agreement`) per the
spec's data model. Each step writes to its OWN column so the merge
never clobbers another step's data — and the Zod schemas can validate
each column independently.

### Named enum current_step (not int)

The `current_step` is the `affiliate_onboarding_step` enum
(`'welcome' | 'handle_bio' | 'payout' | 'promo_methods' | 'agreement'
| 'submit'`), not an int. This keeps the URL `?step=` value, the DB
column value, and the Stepper label in lock-step (single source of
truth). The ordering for "never regress" is `indexOf` in the canonical
`ONBOARDING_STEPS` array.

### Idempotent handle reservation

When the user re-saves step 2 with the same handle (e.g. editing the
bio while keeping the handle), the `saveStepAction` first checks if a
prior reservation exists for the same `(handle, user_id)` pair. If
yes, it skips the INSERT and proceeds directly to the draft upsert
(no spurious 23505). If no, it attempts the INSERT and catches the
23505 as the conflict surface.

### Audit log metadata never includes payload body

The `affiliate_onboarding.step_saved` audit row writes
`metadata: { step, next_step }` only — NEVER the payload body. The
handle_bio payload contains the user's chosen handle (privacy-adjacent
PII once it's linked to a public URL); the payout payload contains
the PayPal email (financial PII). The action's `metadata` field is
typed at the audit-log call site; any future per-step payload keys
that would be PII MUST be added to the `omit` list (and the test
asserting "metadata only has step + next_step" MUST be updated to
pin the new shape).

## Test locally

- `pnpm test 02-features/affiliate-onboarding` — 168 unit tests across
  7 files (queries + schemas + parsers + rate limit + action + RLS smoke)
- `pnpm test 00-foundations/auth/reserved-handles.test.ts` — 39 unit
  tests for the canonical handle list + shape / reserved helpers
- Manual: sign in as a customer → `/affiliate/onboarding` → land on
  step 1 → Continue → step 2 → pick `alice` → save → reservation
  created + advanced to step 3 (placeholder). Sign in as another user,
  pick `alice` → friendly "handle is already taken" message.

## Open follow-ups

- STUB-089 (shared with partner onboarding) — "Start over" CTA + draft
  deletion flow
- STUB-103a — 7-day reservation janitor cron
- P13.1 Slice 2+ — per-step forms (Payout / Promo methods / Agreement /
  Submit) + avatar upload + atomic submit