# 06-quality/

Quality assurance. Tests, checklists, review templates, security audit scripts, performance benchmarks. The things that make sure the code we ship actually works, is secure, and is fast.

## Files

- **`README.md`** — this file
- **`checklists/pre-merge.md`** — the checklist the reviewer runs through on every PR
- **`checklists/pre-deploy.md`** — the checklist before a prod deploy
- **`checklists/security-audit.md`** — the full security audit (run before major releases)
- **`checklists/accessibility.md`** — WCAG 2.1 AA checklist (run on every UI PR)
- **`templates/pr-review.md`** — the PR review template (copy/paste into every review)
- **`templates/incident-postmortem.md`** — the template for writing post-incident reports
- **`tests/e2e/`** — Playwright e2e tests
- **`tests/unit/`** — Vitest unit tests
- **`tests/integration/`** — Vitest integration tests
- **`scripts/check-rls-coverage.sh`** — asserts every table has RLS
- **`scripts/check-no-todos.sh`** — fails the build if `TODO`/`FIXME`/`HACK` are in the diff
- **`scripts/check-bundle-size.sh`** — fails the build if client bundle grew > 50KB
- **`scripts/check-design-tokens.sh`** — fails the build if inline colors are found

## The philosophy

**Quality is not a final check. It's a property of the change as it's being made.**

A "we'll add tests after" PR is a half-baked PR. A "we'll check security in QA" PR is a half-baked PR. A "we'll measure performance before release" PR is a half-baked PR.

The PR template (in `AGENTS.md` at the repo root) forces the author to think about all of these. The checklists here are the reviewer's mirror of that.

## The reviewer workflow

For every PR, the reviewer:

1. **Reads the spec** linked in the PR description. Confirms every acceptance criterion is addressed.
2. **Runs the pre-merge checklist** (`checklists/pre-merge.md`) end to end.
3. **Checks for the four forbidden things:**
   - No `TODO` / `FIXME` / `HACK` in the diff (`scripts/check-no-todos.sh`)
   - No secrets in the diff (gitleaks runs in CI)
   - No inline colors / magic values (`scripts/check-design-tokens.sh`)
   - No bundle size regressions > 50KB (`scripts/check-bundle-size.sh`)
4. **Verifies the spec's acceptance criteria** are all checked in the PR description
5. **Clicks through the feature** if it's UI (screenshot or screen recording in the PR)
6. **Approves or sends back**

If any check fails, the PR is blocked. The builder fixes and re-submits. If the builder disagrees, they escalate to the human.

## Test coverage targets

- **Unit tests:** 80% line coverage per file. PRs that drop coverage below 80% are blocked.
- **Integration tests:** every server action has at least 3 tests (happy path, validation error, permission error).
- **E2E tests:** every user-facing flow has at least 1 happy-path test (the acceptance criteria in the spec).
- **No deleted tests.** If a test is in the way, fix the test or fix the code. Don't delete.

## The 4 automated gates (run on every PR)

1. **`check-no-todos.sh`** — grep for `TODO`, `FIXME`, `XXX`, `HACK` in the diff
2. **`check-rls-coverage.sh`** — query the DB, assert every table has RLS enabled
3. **`check-bundle-size.sh`** — compare the build output to the main branch's output
4. **`check-design-tokens.sh`** — grep for `style={{.*color.*#[0-9a-fA-F]` and similar inline-value patterns

These run in the CI workflow. If any fail, the PR is blocked.

## The manual gates (run by the reviewer)

1. **Pre-merge checklist** — every PR
2. **Accessibility checklist** — every UI PR
3. **Security audit** — every release
4. **Pre-deploy checklist** — every prod deploy

## The "definition of done"

For every PR, "done" means:

- [ ] Spec exists and is approved
- [ ] Implementation matches the spec (every acceptance criterion checked)
- [ ] No `TODO` / `FIXME` / `HACK` in the diff
- [ ] All 4 automated gates pass
- [ ] Unit tests pass, coverage maintained
- [ ] Integration tests pass
- [ ] E2E test exists (for user-facing changes)
- [ ] Screenshot / screen recording attached (for UI changes)
- [ ] Security checklist reviewed
- [ ] Design system adherence verified
- [ ] Bundle size impact documented
- [ ] Reviewer (different agent) approved
- [ ] Human approved
- [ ] CI green

If any of these is missing, the PR is not done.

## What does NOT go here

- Application code (in `02-features/`)
- Tests of application code (colocated with the code in the feature folder)
- Specs (in `01-specs/`)
- Architecture decisions (in `01-specs/decisions/`)
- Infrastructure code (in `04-platform/`)

This folder is for **the things that test and verify the code**, not the code itself.
