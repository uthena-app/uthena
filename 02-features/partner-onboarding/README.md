# partner-onboarding — `/partner/onboarding` wizard

Multi-step application flow for new Uthena partners. Per spec:
[`01-specs/pages/partner-onboarding.md`](../../../01-specs/pages/partner-onboarding.md).

## What's here

| Slice | Status | Shipped |
|---|---|---|
| Slice 1 | ✅ | route + state dispatch + stepper shell + Welcome step + 6 placeholder bodies + URL-driven step navigation |
| Slice 2 | ✅ (this PR) | `saveStep` server action + per-user 60/min rate limit + ContinueButton client island + audit log wiring + Zod per-step payload validation (permissive today; slices 2-7 tighten) + `partner_onboarding.step_saved` AuditAction + `partner_onboarding_drafts` target_kind + 33 unit tests + spec implementation notes |
| Slice 3 | ⏳ | Profile step + avatar upload |
| Slice 4 | ⏳ | Payout step (PayPal email + confirm) |
| Slice 5 | ⏳ | Tax step (country + W-9 conditional upload) |
| Slice 6 | ⏳ | KYC step (open question — see spec §"Open questions for human" #1) |
| Slice 7 | ⏳ | Agreement step (TOS + DPA checkboxes) |
| Slice 8 | ⏳ | Submit summary + atomic submit server action + thank-you redirect + email queue |
| Welcome + Thanks | ✅ (P12.3, this PR) | standalone `/partner/onboarding/welcome` + `/partner/onboarding/thanks` pages with 60/min in-process page rate limit + Thanks-page state query (partners join draft) |
| Restart | ⏳ | "Start over" server action + modal (STUB-089) |

## What ships in Slice 1

- **`app/partner/onboarding/page.tsx`** — RSC route. Auth-gates to
  `/signup?next=/partner/onboarding` (per spec acceptance criterion
  #1, not `/login`). Dispatches to:
  1. anonymous → redirect
  2. approved → `/partner`
  3. pending → `<PendingReview>` (spec criterion #4)
  4. default → `<PartnerOnboardingShell>` wizard
- **`<PartnerOnboardingShell>`** — composes the 7-step `Stepper`
  (sourced from `00-foundations/ui/Stepper`) + the active step body +
  a toolbar with `Save & exit` (→ `/library`) + Back / Continue
  buttons that update `?step=N`.
- **`<WelcomeStep>`** — full Welcome content (60% revenue share,
  "What you'll need" checklist, Terms link).
- **`<StepPlaceholder>`** — generic step body for Profile / Payout /
  Tax / KYC / Agreement / Submit (Slice 2-7 swap in place).
- **`<PendingReview>`** — "Your application is being reviewed"
  surface for `partners.status = 'pending'`.
- **`parseRequestedStep()`** + **`parseStepValue()`** — pure URL
  parser in `lib/parseStep.ts`. Coerces `?step=N` into a 1..7 int
  with a sane fallback to the draft's `currentStep`.
- **`loading.tsx` + `error.tsx` + `not-found.tsx`** — token-only
  route-level fallbacks (P0.24 pattern).
- **Tests:** `parseStep.test.ts`, `getMyOnboardingDraft.test.ts`,
  `getMyPartnerApplicationStatus.test.ts`.

## What ships in Slice 2 (this PR — P12.2 draft persistence)

- **`saveStepAction`** (server action in `actions/saveStep.ts`) —
  upserts `partner_onboarding_drafts` for the current user. Validates
  the wire input with `SaveStepInput` (Zod, step ∈ [1,7] + payload
  is an object). Calls `payloadForStep(step)` (permissive today;
  Slices 3-7 plug in their own Zod refinements). Rate-limited
  60/min/user via `actions/saveStep.rate-limit.ts`. Rejects saves on
  a submitted draft. Shallow-merges the new payload into the
  existing row's `payload` jsonb so a step 3 save doesn't clobber
  a step 2 `profile` save. `current_step` is `max(existing, new)` —
  never regresses. Writes one audit row (`action='partner_onboarding.step_saved'`,
  `target_kind='partner_onboarding_drafts'`, metadata = `{step, next_step}`
  — NEVER the payload body which will carry tax_id / gov_id storage
  paths in future slices). Calls `revalidatePath('/partner/onboarding')`.
- **`<ContinueButton>`** (client island in `components/ContinueButton.tsx`)
  — replaces the previous `<Link>` CTA. Calls `saveStepAction` via
  `useTransition`; on success shows the spec-required `Progress saved`
  toast (criterion #18) and `router.push`'s to the next step URL.
  Three failure modes are surfaced: rate-limited (with `retryAfterSeconds`
  echoed), unauthenticated (with a sign-in CTA), and a generic
  friendly message for the remaining paths.
- **No-JS fallback (form-encoded path):** `parseInput()` also accepts
  `FormData` with hidden inputs `step` and `payload` (JSON-encoded) so
  a future progressive-enhancement can wire a no-JS `<form action=>`
  path without re-architecting.
- **Audit log wiring:** new `AuditAction` variant `partner_onboarding.step_saved`
  + new `target_kind` value `partner_onboarding_drafts` on
  `writeSelfAuditLog`. Both are additive — no migration, no RLS change.
- **PII safety:** the audit row never includes the payload body. The
  warn logs never include the user_id or email (asserted in the
  test suite).
- **Tests:** `actions/saveStep.test.ts` — 33 unit tests covering
  auth gate, rate-limit (61st call → denied), Zod validation
  (every out-of-range / non-integer / wrong-shape input), happy-path
  upsert shape (`onConflict: 'user_id'` + correct merged payload +
  never-regress current_step + audit row), submitted-draft rejection,
  read-failure + upsert-failure graceful paths, defensive coercion of
  corrupted existing rows, FormData path with malformed JSON
  tolerance, and PII safety on the audit row + warn logs.

## URL contract

```
GET /partner/onboarding
GET /partner/onboarding?step=3
GET /partner/onboarding/welcome
GET /partner/onboarding/thanks
```

The `step` query param is an integer in `[1, 7]`. Invalid values
(non-numeric, out of range, CRLF/SQL injection attempts) fall back to
the draft's `currentStep` or `ONBOARDING_FIRST_STEP`. See
`parseStep.ts` for the full defensive surface.

The page **never** puts PII (email, name, ID) in the URL — only the
step number.

## Open questions blocking Slice 5+

The spec's Open Question #1 recommends deferring the KYC step to v2
(collect gov ID at payout time over a threshold instead of at
onboarding). Klaas has not yet responded to this. Slice 5 will
either ship KYC per the current spec, or skip the step entirely if
the recommendation is accepted.

## What ships in P12.3 (welcome + thanks pages)

- **`/partner/onboarding/welcome`** (RSC + auth-gated + page-level
  rate-limited) — entry screen for the partner program. 4-step
  "What you'll need" checklist + Start/Not-now CTAs. Dispatches on
  `partners.status` (pending → /thanks, approved → /partner, default
  → render). No DB writes.
- **`/partner/onboarding/thanks`** (RSC + auth-gated + page-level
  rate-limited + idempotent on re-visit) — post-submit confirmation.
  Checkmark SVG + "What happens next" 3-step explainer + "In the
  meantime" panel + application reference `#<partners.id>` + sign-out
  form. Dispatches on `(partners.status, partner_onboarding_drafts.submitted_at)`.
- **`<WelcomePage>`** + **`<ThanksPage>`** — RSC components owned
  by this feature; both ship zero client JS.
- **`getMyOnboardingApplicationForThanks`** query — parallel read of
  `partners` + `partner_onboarding_drafts` (1 RT, RLS-scoped).
  Resolves to `{ kind: 'pending' | 'approved' | 'suspended' | 'none' }`.
- **`pageRateLimitVerdict`** (in `lib/page-rate-limit.ts`) — in-process
  per-user page rate limit (60/min). Mirrors `saveStep.rate-limit.ts`
  (P12.2) and `exportLedgerCsv.rate-limit.ts` (P6.3).
- **`loading.tsx` + `error.tsx` + `not-found.tsx`** for both routes —
  token-only fallbacks (P0.24 pattern).
- **Tests:** `lib/page-rate-limit.test.ts` (10) +
  `queries/getMyOnboardingApplicationForThanks.test.ts` (14).

## RLS

`partner_onboarding_drafts` ships in migration `0001_initial.sql`
with three policies:

- `partner_onboarding_drafts_self_read` (SELECT scoped to
  `user_id = auth.uid()`)
- `partner_onboarding_drafts_self_write` (FOR ALL scoped to self)
- `partner_onboarding_drafts_admin_read` (SELECT scoped to
  `is_admin()`)

The page never uses the service-role client — both
`getMyOnboardingDraft` and `getMyPartnerApplicationStatus` rely on
RLS to keep the read self-scoped.

## No PII in logs

Both query files log nothing that includes an email, ID, or token.
The mocked `@foundations/log/pino` confirms call sites pass clean
payloads. Future step-save server actions will follow the same
contract (audit row + masked identifiers only).
