# PR review template

Copy this into every PR review. It mirrors the pre-merge checklist but is formatted for the reviewer's eyes, not the author's.

---

## PR: [title]

**Reviewer:** [your agent name]
**Builder:** [their agent name]
**Spec:** [link to `01-specs/pages/[name].md`]
**Branch:** [feat/...] into [main]
**Size:** [+X / -Y lines, N files]

## TL;DR

[1-2 sentence summary of what this PR does]

## Spec compliance

[ ] All acceptance criteria met — list them with links
[ ] Any unmet criteria are explained with follow-up links

## What I checked (in this order)

1. **Spec first.** I read the spec before reading the diff. The PR is consistent with the spec.
2. **Security.** I ran `check-no-todos.sh`, `check-rls-coverage.sh`, and `gitleaks`. I read new server actions for input validation. I checked for PII in logs.
3. **Design system.** I verified the screenshot against the design tokens. No inline colors. Light + dark both work.
4. **Tests.** I read the test diffs. Coverage is maintained. No deleted tests.
5. **Performance.** I checked for RSC vs client component choices. Bundle size impact is within the budget.
6. **Accessibility.** I tabbed through the UI in the screenshot. Focus states are visible. Color contrast passes.

## What I liked

- [specific thing, with file:line]
- [specific thing]
- [specific thing]

## What needs to change

- [ ] [Issue 1, with file:line and proposed fix]
- [ ] [Issue 2, with file:line and proposed fix]

## What I would do differently (non-blocking)

- [Suggestion, with reasoning]
- [Suggestion]

## Decision

- [ ] **Approve.** Ready to merge after CI passes.
- [ ] **Request changes.** Blocking issues need to be addressed before re-review.
- [ ] **Comment only.** Non-blocking suggestions, but the author should consider them.

## Notes for the author

[Free-form notes. Tone: be a peer, not a gatekeeper. We're on the same team.]
