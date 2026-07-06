# [Page name] — [route]

<!--
INSTRUCTIONS FOR WRITING A SPEC

1. Copy this file. Rename to pages/[page-name].md
2. Fill in every section. If something is N/A, write "N/A — [reason]". Do not leave blanks.
3. Be specific. "Show the user's stuff" is not a spec. "Show courses the user owns, grouped by status, with the last lesson watched shown for in-progress" is.
4. Acceptance criteria must be testable. "Looks good" is not acceptance criteria. "The progress bar shows the correct percentage" is.
5. If you have a question you can't answer, put it in "Open questions" at the bottom. Do not guess.
6. Link the mockup file in "Design reference". Without a mockup, the spec is incomplete.
-->

## What this page does

[One paragraph. What does this page DO? Not "what is it for" — what does the user see and interact with?]

Example:
> "The buyer's library. Lists every course the user owns, grouped by status (in progress, completed, not started). For in-progress courses, shows the last lesson watched with a 'Resume' button. Below the course list, shows the user's downloaded file vault with signed-URL generators."

## Data this page shows

| Field | Source | Format | Sort/filter |
|---|---|---|---|
| [field] | [query/action name] | [date / number / text] | [if applicable] |

[Be exhaustive. If a field appears on the page, it's in this table. If you can't name the source query, you don't understand the data yet — go read the schema.]

## User actions

| Action | Trigger | Result | RBAC |
|---|---|---|---|
| [e.g. "Add to cart"] | [e.g. "click 'Add to cart' button"] | [e.g. "item added, cart count increments"] | [e.g. "anyone, including anonymous"] |
| [e.g. "Generate signed download link"] | [e.g. "click 'Generate link' on a vault item"] | [e.g. "POST to /api/vault/sign, return 24h-signed URL, log to file_downloads"] | [e.g. "buyer with library_grant for this product"] |

[Every button, link, form submission, and keyboard shortcut is a row. If the user can do it, it's here.]

## What this page does NOT do

- [Out of scope item 1 — e.g. "does not support gift purchases"]
- [Out of scope item 2]
- [Out of scope item 3]

[This section is critical. It's the agent's permission to NOT build things. Without it, the agent will add features "just in case" and the page will be 30% bloat.]

## Acceptance criteria

- [ ] [Testable, observable, specific. e.g. "The progress bar shows the correct percentage, calculated as completed_lessons / total_lessons"]
- [ ] [Each one is a checkbox. When the PR is opened, every box is checked off, or the PR is blocked.]

[6–12 criteria is normal. If you have fewer, you're under-specifying. If you have 30+, you're over-specifying — split into smaller PRs.]

## Design reference

- Mockup: `mockups/[filename].html`
- Design tokens: `00-foundations/design/tokens.css`
- Theme: [dark / light / both]

[If there's no mockup yet, the spec is not ready. Either build the mockup first, or mark this as "needs mockup" and block.]

## Security

- **Auth required:** [yes / no / optional]
- **Allowed roles:** [customer / partner / affiliate / admin / public]
- **RLS policies that apply:** [list table names; e.g. "products (public read on status=published), library_grants (self only)"]
- **PII displayed:** [yes/no, which fields. e.g. "yes — email, but only on user's own profile page"]
- **PII in URLs:** [no. ever. even for vanity URLs — use slugs, not emails]
- **Audit logged:** [yes/no, what events. e.g. "yes — every signed URL generation is logged to file_downloads"]
- **Third-party scripts:** [none. if any, justify in a comment]

## Performance

- **Target p95:** [e.g. < 200ms for catalog, < 1.5s for player first frame]
- **Render strategy:** [RSC / SSR / ISR / Client. Default: RSC with ISR=60s for public pages, RSC-only for authenticated pages]
- **Cache:** [which data is cached, for how long, where it invalidates]
- **Bundle size budget:** [N/A for non-UI work. For UI: < 50KB added to client bundle, justified in PR]

## Out of scope for v1

- [Things explicitly NOT in this page for v1. These go in `01-specs/pages/_followups.md` or get their own spec.]
- [Be generous here. Better to under-promise and over-deliver.]

## Open questions for human

- [Anything the agent can't decide alone. Examples: "Should we show reviews for unpublished products?" or "Is the empty state helpful or should it suggest courses?"]
- [If you have no questions, write "None." Don't leave the section blank.]

---

## Implementation notes (filled in during/after build)

<!-- This section is filled by the agent during implementation. It captures decisions that
weren't in the spec but are useful to know. e.g. "Used useState instead of useReducer
because the state is shallow" or "Server action returns a typed error code, see
02-features/checkout/errors.ts" -->

- [Decision or note]
- [Decision or note]
