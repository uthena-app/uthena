# Architecture Decision Records (ADRs)

This folder contains the ADRs for Uthena v2. ADRs document significant architectural decisions: the context, the options considered, the decision, and the consequences.

## What is an ADR?

An ADR (Architecture Decision Record) is a short document that captures a single architectural decision. The format we use (Michael Nygard's variant):

1. **Title** — short noun phrase
2. **Status** — Proposed / Accepted / Deprecated / Superseded
3. **Date** — when the decision was made
4. **Deciders** — who made it
5. **Context** — what was the situation, what were the constraints
6. **Considered options** — what we looked at
7. **Decision** — what we chose
8. **Consequences** — the trade-offs, both positive and negative
9. **Mitigations** — how we address the negatives
10. **References** — links to related docs

## When to write an ADR

Write an ADR when:
- The decision is hard to reverse (vendor choice, data model, framework)
- The decision has long-term consequences (impacts every PR for years)
- The decision affects multiple teams or features
- The decision was non-obvious (someone reading the code in 2 years would wonder "why did they do it this way?")

Don't write an ADR for:
- Bug fixes
- Small refactors
- Library version bumps
- Routine feature additions (the spec handles that)

## The list

- **[0001-bunny-net-stream-and-storage.md](./0001-bunny-net-stream-and-storage.md)** — Bunny.net for video and object storage
- **[0002-stripe-in-paypal-out.md](./0002-stripe-in-paypal-out.md)** — Stripe for money in, PayPal Mass Payout for money out
- **[0003-hetzner-coolify.md](./0003-hetzner-coolify.md)** — Hetzner VPS + Coolify, no Vercel
- **[0004-rls-multi-tenancy.md](./0004-rls-multi-tenancy.md)** — Row-Level Security on every table
- **[0005-append-only-payout-ledger.md](./0005-append-only-payout-ledger.md)** — Append-only payout ledger
- **[0006-tooling-choices.md](./0006-tooling-choices.md)** — TypeScript, Next.js, pnpm, Vitest, Playwright, etc.
- **[0007-new-tables-for-v1.md](./0007-new-tables-for-v1.md)** — Round-2 additions to the v1 schema (10 tables: cart, onboarding drafts, handle reservations, certificates, notification prefs, reports, platform settings, API tokens, DMCA)
- **[0008-admin-area-rbac.md](./0008-admin-area-rbac.md)** — v1 admin RBAC: single role, all actions audit-logged, no dual-control, no sub-roles (with v2 deferrals)
- **[0009-royalty-snapshot-invariant.md](./0009-royalty-snapshot-invariant.md)** — Royalty engine: snapshot rate + royalty cents at order time, payout ledger reads from `order_items` (never from `partners`), partial refunds are proportional + floored + clamped at full-sale-royalty

## ADR process

1. **Draft.** The agent (or human) writes the ADR.
2. **Review.** The human reviews and either approves, sends back, or rejects.
3. **Accept.** Once approved, the ADR is merged. The status changes to "Accepted."
4. **Supersede.** If a future decision reverses this one, a new ADR is written with a "Supersedes" link at the top. The old ADR is marked "Superseded by [link]."

ADRs are immutable once accepted. If you discover new information, write a new ADR that supersedes the old one. Don't edit the old one.

## Naming convention

`NNNN-short-title.md` where:
- `NNNN` is a zero-padded 4-digit sequence number
- `short-title` is the kebab-case title

Examples:
- `0001-bunny-net-stream-and-storage.md`
- `0002-stripe-in-paypal-out.md`

## When the decision is small

If the decision doesn't warrant a full ADR, consider putting it in:
- A `// ADR-NNNN` comment in the code (links to the relevant ADR)
- The relevant spec's "Out of scope for v1" section
- A note in the relevant README

The line: an ADR is for things that affect the architecture. A code comment is for things that affect the implementation. A spec note is for things that affect the product. A README note is for things that affect the developer.
