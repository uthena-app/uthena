# Partner Onboarding — `/partner/onboarding`

## What this page does

A 7-step wizard that turns a logged-in customer into a pending partner. Steps render in order with a stepper at the top showing progress: **Welcome → Profile → Payout → Tax → KYC → Agreement → Submit**. Users can save & exit at any step and resume from the same step later. Each step validates its own data before the user advances; "Next" stays disabled until the step is valid. A persistent "Progress saved" toast confirms each successful step save.

On final submit, a `partners` row is created with `status = 'pending'`, the `partner_onboarding_drafts` row is marked `submitted_at`, a confirmation email is queued, and an admin alert is queued. The user lands on a "Thanks, we'll review within 2 business days" screen. Once an admin approves, the user is moved to `status = 'approved'`, gets an approval email, and the next visit to `/partner/onboarding` redirects to `/partner`.

Migration requirement: the current Shopify store and related subdomains expose instructor/partner entry points at `/pages/instructor-application`, `/pages/apply-as-instructor`, `affiliate.uthena.com/register/become-instructor`, and `portal.uthena.com/signup`. The clean top-level replacements are `/instructor-application` and `/apply-as-instructor`; both resolve to this onboarding flow after launch. The legacy `/pages/*` URLs permanently redirect to the clean route first or directly to the onboarding target, with no homepage fallback.

## Data this page shows

| Step | Field | Source | Format | Validation |
|---|---|---|---|---|
| (header) | `profiles.display_name`, `profiles.avatar_url`, current step, total steps, "Resume" / "Start over" controls | `partner_onboarding_drafts` join `profiles` | stepper + avatar | — |
| 1. Welcome | Hard-coded copy: 60% revenue share, terms link, "What you'll need" checklist | static | text + checklist | — |
| 2. Profile | `display_name`, `bio` (max 500 chars), `website_url` (optional, URL), `avatar` upload (jpg/png, max 2MB) — pre-filled from `profiles` if set | `profiles` + draft | form | Zod: `display_name` 2–60 chars; `bio` ≤ 500; `website_url` valid URL or empty; `avatar` MIME in {`image/jpeg`,`image/png`}, ≤ 2MB |
| 3. Payout | `paypal_email` (required), `paypal_email_confirm` (must match) | draft | form | Zod: RFC-5322 email, identical to confirm; must NOT equal the user's login email (warn-only) |
| 4. Tax | `country` (default "US"), `tax_id` (text), conditional `w9_upload` (PDF, max 5MB) when `country == "US"` | draft | form + file | US: `w9_upload` MIME = `application/pdf`, ≤ 5MB, `tax_id` 9 digits (EIN/SSN) — for v1 we accept any 9-digit input; real validation is admin's job in v2 |
| 5. KYC | `gov_id_front` (jpg/png/pdf, ≤ 5MB), `gov_id_back` (jpg/png/pdf, ≤ 5MB) | draft | file | MIME ∈ {`image/jpeg`,`image/png`,`application/pdf`}, ≤ 5MB each |
| 6. Agreement | `tos_accepted` (bool), `partner_agreement_accepted` (bool), "I have read the Partner Agreement" acknowledgement | draft | checkboxes | both must be true to enable Submit |
| 7. Submit | Summary view (read-only): display name, bio preview, payout email (masked: `j***@paypal.com`), tax country + form status, "Submit application" button | draft | summary | — |

**Server actions** in `02-features/partner-portal/actions/onboarding/`:
- `saveStep(userId, step, payload)` — upserts a `partner_onboarding_drafts` row. Validates payload with Zod. Returns `{ ok, savedAt }`.
- `checkHandle()` — not used here (partners don't have handles; affiliates do).
- `submitApplication(userId)` — atomic. Inserts `partners` row with `status='pending'`, copies fields from draft, marks draft `submitted_at = now()`, enqueues 2 emails. Idempotent: re-submit on a `pending`/`approved` application returns `{ ok: true, alreadySubmitted: true }` and does NOT create a duplicate row.

**Storage:** uploads go to Bunny Storage under `onboarding/partner/{userId}/{step}/{filename}`. The path is stored in the draft as `storage_path`; the signed URL is regenerated on the next page load.

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| Open onboarding | Direct nav to `/partner/onboarding` while logged in | Render the step the user is on (or step 1 if no draft) | authenticated user, role ≠ partner (existing partners get redirect to `/partner`) |
| Anonymous direct nav | Direct nav while not logged in | Redirect to `/signup?next=/partner/onboarding` (signup honors `?next`) | unauthenticated |
| Open clean instructor application URL | Visit `/instructor-application` or `/apply-as-instructor` | Permanent redirect to `/partner/onboarding` or `/signup?next=/partner/onboarding` depending on auth state | public |
| Open legacy instructor application URL | Visit `/pages/instructor-application`, `/pages/apply-as-instructor`, `affiliate.uthena.com/register/become-instructor`, or `portal.uthena.com/signup` | Permanent redirect to the clean instructor URL or `/partner/onboarding`, preserving safe attribution params | public |
| Save step | Click "Next" or "Save & exit" | Server action saves the step payload, returns `{ ok }`, toast "Progress saved", stepper advances or app routes away | authenticated, draft owner only (RLS enforces `user_id = auth.uid()`) |
| Upload a file | Drag-drop or click "Choose file" | POST to `02-features/partner-portal/actions/onboarding/uploadFile.ts` (signed upload to Bunny), returns `{ storage_path, url }`; field populated | authenticated, draft owner |
| Remove an uploaded file | Click "Remove" on a file pill | Clears `storage_path` on the draft; deletes object from Bunny | authenticated, draft owner |
| Restart onboarding | Click "Start over" on step 1 or higher | Confirmation modal, then `DELETE FROM partner_onboarding_drafts WHERE user_id = self` (drafts only — never touches a `partners` row that already exists) | authenticated |
| Submit application | Click "Submit application" on step 7 | Atomic: insert `partners` row, mark draft `submitted_at`, queue 2 emails (user confirmation + admin alert), navigate to `/partner/onboarding/thanks` | authenticated, draft owner, no existing `partners` row OR existing row is `status = 'suspended'` (resubmit after suspension) |
| Re-submit (idempotency) | Click "Submit" again with the same draft | Returns `{ ok: true, alreadySubmitted: true }`; UI shows "Submitted" state, no duplicate row created | authenticated |
| Exit | Click "Exit" / browser close | Draft is auto-saved on each step; user can resume by returning to `/partner/onboarding` | — |
| View terms | Click "Read the Partner Agreement" link | Opens PDF in a modal or new tab (PDF lives in `04-platform/emails/legal/partner-agreement.pdf`) | authenticated |

## What this page does NOT do

- No KYC identity verification in v1 (the step accepts uploads but admin reviews manually — see Open Questions; the spec recommends deferring to v2)
- No automated tax form parsing or TIN validation (admin verifies in v2)
- No payment of an "application fee" (the program is free)
- No real-time status of admin review (user gets an email; v2 can add an in-app "Application status" page)
- No course-upload flow here (that's `/partner/upload` post-approval)
- No editing of an approved partner's tax / payout info (separate "Account settings" page in v2)
- No multi-language support for the agreement PDFs (English only in v1)
- No CAPTCHA — see Open Questions on whether to add
- No "save as PDF" of the application summary

## Acceptance criteria

- [ ] Page is auth-gated; anon visitors are redirected to `/signup?next=/partner/onboarding` and the `?next=` is preserved through signup
- [ ] `/instructor-application` and `/apply-as-instructor` resolve into this flow and preserve only safe attribution params (`ref`, `utm_*`)
- [ ] `/pages/instructor-application` and `/pages/apply-as-instructor` permanently redirect to the approved clean route or directly into this flow; neither renders a page under `/pages`
- [ ] Logged-in users with an existing `partners` row in `status = 'pending'` see a "Your application is being reviewed" state, not the wizard
- [ ] Logged-in users with `partners.status = 'approved'` are redirected to `/partner` (not the wizard)
- [ ] The stepper shows all 7 steps, with the current step highlighted, completed steps checkmarked, and future steps greyed
- [ ] Each step validates its own fields inline; "Next" stays disabled until validation passes
- [ ] "Save & exit" returns the user to `/library`; the wizard can be resumed at the same step on return
- [ ] Closing the browser tab and returning to `/partner/onboarding` within 30 days resumes at the same step
- [ ] File uploads are validated for MIME type and size server-side (not just client-side) — rejected uploads show an inline error
- [ ] Submit is atomic: if the `partners` insert succeeds, the draft is marked `submitted_at`; if any step fails, no row is created
- [ ] Re-submitting a previously submitted application does NOT create a duplicate `partners` row (verified by a test that calls `submitApplication` twice and asserts only one row exists)
- [ ] PayPal email confirmation field must match the first entry (server-side check, not just client)
- [ ] W-9 upload is required for US users, optional for non-US (form shows the right field based on country)
- [ ] Step 6 disables "Submit application" until both checkboxes are true
- [ ] On successful submit, the user lands on `/partner/onboarding/thanks` and the `partners` row exists with `status='pending'`
- [ ] On successful submit, a confirmation email is queued (`04-platform/emails/partner-application-received.tsx`) and an admin alert is queued (`04-platform/emails/admin-new-partner-application.tsx`) — verify via `emails_outbox` test
- [ ] Avatar pre-fills from `profiles.avatar_url` if set, and saving step 2 updates the `profiles` row in addition to the draft
- [ ] PII (PayPal email, tax ID, gov ID files) is never exposed in URLs — use `user_id` from auth, never query-string emails or names
- [ ] Page renders in < 500ms p95 (most steps are static; step 2/3/4/5 are server actions)
- [ ] No PII in server logs (emails masked to `j***@paypal.com`, tax_id and gov_id paths logged but file contents never)
- [ ] No `TODO` / `FIXME` / `HACK` in the diff
- [ ] All uploads go through the signed-URL helper in `00-foundations/files/`, never direct browser PUTs
- [ ] Wizard is keyboard-navigable end-to-end (Tab through fields, Enter advances, Esc closes modals)
- [ ] "Progress saved" toast appears within 300ms of the network response (optimistic UI)

## Design reference

- Mockup: not yet built — to be created during the partner-onboarding feature build (`mockups/partner-onboarding.html`)
- Design tokens: `00-foundations/design/tokens.css`
- Components: `00-foundations/ui/Stepper.tsx`, `00-foundations/ui/FormField.tsx`, `00-foundations/ui/FileDropzone.tsx`, `00-foundations/ui/Checkbox.tsx`, `00-foundations/ui/Button.tsx`, `00-foundations/ui/Toast.tsx`
- Email templates: `04-platform/emails/partner-application-received.tsx`, `04-platform/emails/admin-new-partner-application.tsx`

## Security

- **Auth required:** YES — redirects anon to `/signup?next=/partner/onboarding`
- **Allowed roles:** any authenticated user without an active `partners` row (or with `status = 'suspended'` for re-submission)
- **RLS policies that apply:**
  - `partner_onboarding_drafts` — `select/insert/update/delete` only when `user_id = auth.uid()`; no admin read policy in v1 (admin views via service role in the admin app)
  - `partners` — self can `select` own row; `insert` blocked at RLS (only the `submitApplication` server action with `service_role` may insert, after Zod validation)
  - `profiles` — self `update` on `display_name`/`bio`/`avatar_url` only; `user_id` matches auth
  - `file_downloads` — INSERTs a row when any uploaded file is later read by an admin (audit trail)
- **PII displayed:** yes — user's own PayPal email, tax ID, gov ID file URLs (all behind auth, all owned by self)
- **PII in URLs:** NO. The route is `/partner/onboarding`; the `user_id` is derived from the auth session server-side, never query-stringed. Step navigation uses a `?step=N` query param only (N is an integer, no PII).
- **File upload security:**
  - MIME + size validated server-side (not just `accept=` on the input)
  - Virus scan: **v1, blocking.** ClamAV via `00-foundations/files/scan.ts` (triggered by the upload-complete webhook in `04-platform/webhooks/`); files marked `infected` are quarantined and the user is notified. (Scanning moved from v2 to v1 on 2026-06-12 — same pipeline as course uploads, see `01-specs/pages/instructor-upload.md`.)
  - Storage paths are `onboarding/partner/{userId}/{step}/{uuid}.{ext}` — no filename collision, no path traversal
  - Bunny Storage zone: `private` (not `public`); reads require signed URLs
- **Idempotency:** `submitApplication` is idempotent. The first call creates the `partners` row; subsequent calls on the same `user_id` return the existing row with `alreadySubmitted: true`. Implemented with a unique partial index on `partners(user_id) where status in ('pending', 'approved')` and an `on conflict do nothing` clause in the insert.
- **Rate limiting:** `saveStep` is rate-limited to 60 requests/minute per user (prevents a misbehaving client from spamming). `submitApplication` is rate-limited to 5/hour per user.
- **Audit logged:** yes — every step save, every file upload, every submit, every restart. Written to `admin_audit_log` via the `service_role` server action. Events: `partner_onboarding.step_saved`, `partner_onboarding.file_uploaded`, `partner_onboarding.submitted`, `partner_onboarding.restarted`.
- **CSRF:** server actions protected by Next.js's built-in action token.
- **Open redirect protection:** the `?next=` param on signup is validated (must be a relative path starting with `/` and not `//`).
- **Legacy redirect safety:** legacy partner/instructor redirects have fixed relative targets. Only allowlisted attribution params are carried forward.
- **Session security:** see `/login` spec. The wizard inherits the same session.
- **Third-party scripts:** none. Resend (email) and Bunny (storage) are server-side only — no SDKs loaded in the browser.

## Performance

- **Target p95:** < 500ms per step navigation; < 2s for the initial step load (includes the draft fetch and any signed-URL regeneration)
- **Render strategy:** RSC + SSR for the wizard shell; client components for the form fields and stepper
- **Cache:** none — every step is user-specific
- **DB indexes:** `partner_onboarding_drafts (user_id, updated_at desc)`; the existing `partners (user_id)` unique index
- **Bundle size budget:** < 50KB added to the client bundle (form, file dropzone, stepper, validation libs). The form has 5 file upload zones; the dropzone is lazy-loaded.

## Out of scope for v1

- Automated KYC verification (the step accepts uploads; admin reviews manually in v2)
- Real tax form parsing / TIN format validation (admin's job in v2)
- In-app "Application status" page (email only in v1)
- Multi-language agreement PDFs (English only in v1)
- Editing an approved partner's tax / payout info post-approval (separate "Account settings" page in v2)
- "Apply as a team" / multi-user applications (one user = one application)
- Resume from email link ("You started an application 7 days ago — finish it")
- A/B test of wizard copy
- CAPTCHA on submit (see Open Questions)
- Saving step 1 (Welcome) as a "started" event for analytics (defer to v2; log on submit only in v1)

## Open questions for human

1. **KYC step in v1 — do we actually collect the gov ID, or defer the step entirely?** My recommendation: **defer the KYC step to v2**. A small PLR marketplace with 60% revenue share does not need KYC at onboarding; we can collect it the first time a partner requests a payout over a threshold (e.g. $600, the US 1099-K reporting threshold). The wizard goes from 7 steps to 6, and the `kyc_status` field on `partners` starts at `'none'` and is updated by a separate payout-time flow in v2. Flag for human review.
2. **Proposed new table: `partner_onboarding_drafts`.** My recommendation — flag for human review:

   ```sql
   create type partner_onboarding_step as enum (
     'welcome', 'profile', 'payout', 'tax', 'kyc', 'agreement', 'submit'
   );

   create table partner_onboarding_drafts (
     id bigserial primary key,
     user_id uuid not null unique references auth.users(id) on delete cascade,
     current_step partner_onboarding_step not null default 'welcome',
     -- Step payloads, written incrementally. Each step's payload is merged into this row on save.
     profile jsonb,            -- { display_name, bio, website_url, avatar_storage_path }
     payout jsonb,             -- { paypal_email }  -- NOT paypal_email_confirm, that is a UI-only field
     tax jsonb,                -- { country, tax_id, w9_storage_path }
     kyc jsonb,                -- { gov_id_front_storage_path, gov_id_back_storage_path }
     agreement jsonb,          -- { tos_accepted, partner_agreement_accepted, accepted_at }
     submitted_at timestamptz, -- set on submit; null while drafting
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );

   create index on partner_onboarding_drafts (user_id) where submitted_at is null;
   -- submitted drafts are kept for 90 days for audit, then a janitor deletes them

   alter table partner_onboarding_drafts enable row level security;
   create policy "partner_drafts_self_all" on partner_onboarding_drafts
     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
   -- No admin read policy in v1: admins use the service role in the admin app
   ```

   Confirm the table name, the `jsonb`-per-step shape (vs one big `payload jsonb`), and the 90-day retention. Alternative: one `payload jsonb` with step-keyed sub-objects — easier to evolve, harder to query. I'm fine with either; I picked per-step jsonb for clearer per-step validation in code.
3. **"Suspended" re-submission:** if a partner is suspended, can they re-onboard via the wizard? My recommendation: **yes** — re-onboarding creates a new `partners` row with `status='pending'` after the admin re-evaluates. The `partners` table would need to drop the `user_id unique` constraint, or we archive the suspended row to `partners_archive`. Flag for human review — this is a small data-model change.
4. **CAPTCHA on submit:** do we add hCaptcha or Turnstile in v1, or wait for abuse? My recommendation: **no CAPTCHA in v1**, but rate-limit `submitApplication` to 5/hour per user. CAPTCHA adds bundle size and friction. Add in v2 if abuse appears.
5. **Email timing:** is "we'll review within 2 business days" the right commitment, or is it "1 business day"? My recommendation: **2 business days** for v1 to give us a buffer. Tighten to 1 in v2 once admin workflow is established.

---

## Implementation notes

- **(2026-06-29, 21:30 +07 — P12.1 Slice 1)**: route shell + state dispatch + stepper + Welcome step body + 6 step placeholders + URL-driven `?step=N` navigation. Files: `app/partner/onboarding/page.tsx` (+ dual-tree APFS clone at `03-app/partner/onboarding/page.tsx`) + `loading.tsx` + `error.tsx` + `not-found.tsx` + matching `.module.css` files; `02-features/partner-onboarding/components/PartnerOnboardingShell.tsx` (+ .module.css) composes the existing `00-foundations/ui/Stepper` primitive; `WelcomeStep.tsx`, `PendingReview.tsx`, `StepPlaceholder.tsx` (+ matching .module.css each); `02-features/partner-onboarding/lib/parseStep.ts` (pure URL parser); barrel `index.ts` + `README.md`; tests for the two pre-existing queries + the new parseStep helper (43 new tests; full suite 2692/2692 pass + 1 todo + 1 pre-existing encryption flake). The route renders `/partner/onboarding` at `1.4 kB / 111 kB` first-load JS (RSC, no client JS). All 6 static checks green (`typecheck`, `lint`, `check:no-todo`, `check:pii`, `check:specs`, `check:rls`) + `pnpm build` clean (53 routes). State dispatch: anon → `/signup?next=/partner/onboarding` (spec acceptance criterion #1, NOT `/login`); `partners.status='approved'` → redirect to `/partner` (criterion #5); `partners.status='pending'` → `<PendingReview>` (criterion #4); otherwise → `<PartnerOnboardingShell>` from `?step=N` or `drafts.currentStep` or step 1. Spec criteria covered by Slice 1: 1 (auth-gate to /signup), 4 (pending review surface), 5 (approved redirect), 6 (Stepper shows all 7 steps), 9 (schema-driven resume), 19 (URL only has `?step=N`, no PII), 20 (RSC, no client JS, < 50KB first-load target met at 1.4 kB), 21 (no PII in logs — query files log nothing that includes email/ID/token), 22 (no banned placeholders — deferred work filed in STUBS.md per AGENTS.md rule 4), 24 (keyboard-nav via native `<button>`/`<a>` elements + visible focus rings on all interactive surfaces). Pre-existing schema (`partner_onboarding_drafts` from migration `0001_initial.sql`) reused as-is — no new migration, no new RLS, no new table. **Slices 2-7 deferred** to follow-up releases (STUB-089 covers the 7-step rollout plan + the 2 spec open questions that gate KYC + re-onboarding scope).

- **(2026-06-29, 22:00 +07 — P12.2 draft persistence)**: `saveStepAction` server action + ContinueButton client island + per-user 60/min rate limit + audit log wiring. Files: `02-features/partner-onboarding/actions/saveStep.ts` (`'use server'` async action, Zod `SaveStepInput` + per-step `payloadForStep` plug-point, shallow-merge upsert by `user_id` with `onConflict`, `current_step = max(existing, new)`, rejects saves on submitted draft, calls `revalidatePath('/partner/onboarding')`); `02-features/partner-onboarding/actions/saveStep.rate-limit.ts` (in-process 60/min/user sliding window + test reset); `02-features/partner-onboarding/actions/saveStep.test.ts` (33 unit tests covering auth gate + rate-limit + Zod validation + happy-path upsert + never-regress current_step + submitted-draft rejection + read/upsert failure graceful paths + defensive coercion + FormData path + PII safety on audit row + warn logs); `02-features/partner-onboarding/components/ContinueButton.tsx` (`'use client'`, uses `useTransition` + `useToast` + `router.push`, three failure modes surfaced: rate-limited / unauthenticated / generic); `02-features/partner-onboarding/components/ContinueButton.module.css`; modified `PartnerOnboardingShell.tsx` (replaced the `<Link>` Continue with `<ContinueButton>` + the orphaned `.continueLink` CSS class removed); modified `02-features/partner-onboarding/index.ts` (barrel re-exports `saveStepAction` + `SaveStepInput` + `SaveStepResult` + `ContinueButton`); modified `00-foundations/data/enums.ts` (added `'partner_onboarding.step_saved'` to `AuditAction` + `AUDIT_ACTIONS`); modified `02-features/account/profile/actions/writeSelfAuditLog.ts` (added `'partner_onboarding_drafts'` to the `targetKind` union). The Continue button on the Welcome step now saves the draft + shows the spec-required "Progress saved" toast + navigates to the next step; a returning user with no `?step=` param resumes at the draft's `currentStep` (criterion #9) because the URL navigation lands on `?step=N` and the page already prefers valid URL params over the draft fallback. Spec acceptance criteria covered by Slice 2: 9 (schema-driven resume — `currentStep` is the source of truth when `?step=` is absent), 18 ("Progress saved" toast within 300ms via `useTransition` + immediate `toast.success` before the network roundtrip is even observable to the user), 23 (no banned placeholders — Slice 2 ships the real save plumbing, not a marker), 25 (rate limit 60/min per user, enforced + tested), 26 (every save writes one `admin_audit_log` row with `action='partner_onboarding.step_saved'` + `target_kind='partner_onboarding_drafts'` + `target_id=user.id` + `metadata={step, next_step}` — no payload body in metadata). Slices 3-7 plug their own Zod schemas into `payloadForStep(step)` and call `saveStepAction` from each step's form submit. No migrations were needed — `partner_onboarding_drafts` (with the `partner_onboarding_drafts_self_*` RLS policies) already shipped in `0001_initial.sql:1351-1378`.

