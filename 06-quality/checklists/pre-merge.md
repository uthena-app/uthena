# Pre-merge checklist

The reviewer runs through this checklist on every PR. If any item is unchecked and unaccounted for, the PR is blocked.

## Spec compliance

- [ ] The PR description links to a spec in `01-specs/pages/`
- [ ] The spec is approved (the human has signed off)
- [ ] Every acceptance criterion in the spec is checked in the PR description
- [ ] If any acceptance criterion is NOT MET, there's a clear explanation and a link to the follow-up spec

## Security

- [ ] Auth is required on the route, or the spec explicitly marks it as public
- [ ] New tables have RLS enabled AND have at least one policy (verify with `check-rls-coverage.sh`)
- [ ] No secrets in the diff (no API keys, no DB URLs, no service-role keys, no signing keys)
- [ ] No PII in any log line (verify by reading new logger calls)
- [ ] File access goes through signed URLs (no direct bucket URLs)
- [ ] New server actions validate input with Zod before touching the DB
- [ ] No SQL string concatenation in queries (use the Supabase client or parameterized queries)
- [ ] No `dangerouslySetInnerHTML` without explicit sanitization
- [ ] No new dependencies added without checking for existing equivalents and updating the lockfile

## Design system

- [ ] All colors are design tokens (no inline `#hex` values)
- [ ] All spacing is on the 4/8/12/16/24/32/48/64 grid (no magic pixel values)
- [ ] All typography uses the `t-*` classes (no inline font sizes)
- [ ] All radii are from the design system scale (6/8/10/14/18)
- [ ] Components used are from `00-foundations/ui/` (not invented inline)
- [ ] Light AND dark theme are both tested (both are first-class in v3)
- [ ] Icons are from the icon set (no emoji as icons, no random SVGs)

## Code quality

- [ ] No `TODO` / `FIXME` / `HACK` / `XXX` / `// for now` / `// later` in the diff (verify with `check-no-todos.sh`)
- [ ] No commented-out code
- [ ] No console.log / console.error / console.warn left in (use the structured logger)
- [ ] No debug statements (`debugger`, `// @ts-ignore` without justification, `// eslint-disable` without justification)
- [ ] Functions are focused (one thing per function; if the function name has "and" in it, split it)
- [ ] No copy-pasted code (extract to a shared helper if it appears 2+ times)
- [ ] Variable names are clear (no `data1`, `tmp`, `x` for non-loop variables)
- [ ] No dead code (imports, variables, functions that are not used)

## Testing

- [ ] Unit tests added or updated (if business logic was added or changed)
- [ ] Integration tests added or updated (for new server actions)
- [ ] E2E test added (for new user-facing flows)
- [ ] All tests pass locally and in CI
- [ ] Coverage is maintained at 80%+ for changed files
- [ ] No tests were deleted (if a test was removed, the PR description explains why)

## Accessibility (UI changes only)

- [ ] All interactive elements are keyboard-accessible (Tab order is correct)
- [ ] All form controls have associated labels (visible or `aria-label`)
- [ ] All images have alt text (descriptive, not just "image")
- [ ] Focus states are visible (test by tabbing through the page)
- [ ] Color contrast meets WCAG AA (4.5:1 for body, 3:1 for large text)
- [ ] No content relies on color alone to convey meaning
- [ ] All ARIA attributes are used correctly (no `aria-label` on a non-interactive element)
- [ ] Modals trap focus and restore it on close
- [ ] Toasts / live regions announce properly to screen readers
- [ ] Empty states are designed (not blank)
- [ ] Error messages tell the user what to do next (not just "an error occurred")

## Performance

- [ ] No client-side data fetching for catalog / product / library pages (RSC + ISR)
- [ ] No large client components that could be server components
- [ ] Images use `next/image` (not `<img>`)
- [ ] Fonts use `next/font` (not random CDN imports)
- [ ] No `useEffect` for data that could be fetched at build time or in RSC
- [ ] Bundle size impact: if > 50KB added, the PR description explains why
- [ ] No synchronous long-running operations in request handlers
- [ ] DB queries have appropriate indexes (verify with `EXPLAIN` for new queries)

## Documentation

- [ ] README in the feature folder is updated (if a new feature was added)
- [ ] `01-specs/pages/_followups.md` is updated (if a TODO was converted to a follow-up)
- [ ] Any new env vars are added to `.env.example` (with placeholders, not real values)
- [ ] Any new public API is documented in the relevant README
- [ ] If the architecture changed, an ADR is written in `01-specs/decisions/`

## PR hygiene

- [ ] Branch name follows the convention (`feat/`, `fix/`, `refactor/`, `docs/`, `chore/`)
- [ ] Commit messages are clear (imperative, present tense: "Add", not "Added")
- [ ] The PR description uses the template from `AGENTS.md`
- [ ] Screenshot or screen recording is attached (for UI changes)
- [ ] The PR is focused (one feature / one fix, not a kitchen sink)
- [ ] No `// this is just a draft` commits (squash before merging)
- [ ] No unrelated changes (e.g. formatting, refactoring in a feature PR)

## Final checks

- [ ] CI is green (typecheck, lint, tests, build, security scan)
- [ ] The reviewer is a **different agent** than the builder (different session)
- [ ] The human has approved the PR (for user-facing changes)
- [ ] The merge button is hit by the reviewer, not the author
