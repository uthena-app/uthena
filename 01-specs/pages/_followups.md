# Follow-ups

> Issues that were discovered during implementation but don't belong in the current PR.
> Each entry is filed by the agent that found it. The human reviews and either closes it (turning it into a real spec) or archives it.

## Format

```
### [FU-NNN] Short title
- **Filed:** 2026-MM-DD by [agent or human name]
- **Found in:** [PR # or page spec name]
- **Severity:** [blocker / major / minor / nice-to-have]
- **Status:** open | in-progress | closed | wontfix
- **Description:** What is the issue? What did we have to do as a workaround?
- **Proposed fix:** [link to spec when created, or "deferred to v2"]
- **Acceptance to close:** [what needs to be true for this to be marked closed]
```

## Open follow-ups

[Currently empty. New entries get added at the top.]

---

## Closed follow-ups (last 90 days)

[For history. Anything older than 90 days moves to `07-archive/followups/`.]

---

<!--
Template for new entries — copy this block:

### [FU-001] Example: cart abandoned when user closes browser
- **Filed:** 2026-06-15 by catalog-agent
- **Found in:** PR #142 — Catalog filter persistence
- **Severity:** minor
- **Status:** open
- **Description:** When a user adds an item to cart and closes the browser, the cart is lost. We currently don't persist anonymous carts.
- **Proposed fix:** Add localStorage-backed cart for anonymous users, with merge on login. See proposed spec in `01-specs/decisions/0007-cart-persistence.md`.
- **Acceptance to close:** Anonymous cart persists across browser restarts and merges correctly with user cart on login.
-->
