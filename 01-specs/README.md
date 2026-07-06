# 01-specs/ — The human gate

> **This folder is the contract. No code is written without a spec.**

## Why this folder exists

Half-baked work happens when:
- The agent guesses what "done" looks like
- The spec is vague, so the agent fills in the gaps
- Two agents work on the same area and overwrite each other
- The agent stops at "it renders" without checking it works

This folder fixes all four. Every page has a spec. The spec defines:
- What the page does (one paragraph)
- What data it shows and where it comes from
- What user actions it supports, and who's allowed to do them
- What it does **not** do (so the agent doesn't add features that weren't asked for)
- The acceptance criteria — a checklist the agent must check off in the PR
- The security implications (auth, RLS, PII, audit)
- The performance target (p95, caching strategy)
- Open questions for the human

The spec is the source of truth. The code is the implementation. If they disagree, the spec wins — until the spec is updated.

## How to use this folder

### As the human

1. **For each new page**, either write a spec yourself (10–30 min) or have the agent draft one and review/approve it.
2. **The spec is the only thing you need to read** to know what the page will do. You don't need to read the implementation.
3. **Open questions at the bottom of each spec** are for you. Answer them, or tell the agent to proceed with a sensible default.
4. When the agent files a follow-up (see `_followups.md`), review it like a new spec.

### As the agent

1. **Before writing any page code**, check `01-specs/pages/[page-name].md`. If it doesn't exist, **write the spec first** and flag it for human review.
2. **Copy `_template.md`** as the starting point. Fill in every section. If a section is N/A, write "N/A — [reason]" rather than leaving it blank.
3. **Link the spec in every PR** that implements it. PRs without a spec link are rejected.
4. **Update the spec first** if the implementation reveals a design issue. Then update the code in the same PR.
5. **File follow-ups in `_followups.md`** for things that don't belong in the current PR. Don't add them silently.

## File structure

```
01-specs/
├── README.md                          ← you are here
├── pages/
│   ├── _template.md                   ← copy this for every new spec
│   ├── _followups.md                  ← issues filed from TODOs in code
│   ├── home.md
│   ├── catalog.md
│   ├── product.md
│   ├── checkout.md
│   ├── library.md
│   ├── library-watch.md
│   ├── vault.md
│   ├── instructor-dashboard.md
│   ├── instructor-upload.md
│   ├── instructor-payouts.md
│   ├── affiliate-dashboard.md
│   ├── affiliate-minishop.md
│   ├── admin-review.md
│   ├── admin-payouts.md
│   ├── login.md
│   └── signup.md
└── decisions/
    ├── 0001-use-bunny-net-for-stream-and-storage.md
    ├── 0002-use-stripe-in-paypal-mass-payout-out.md
    └── ... (one per architecture decision)
```

## Workflow

```
[HUMAN] writes spec OR
[HUMAN] asks AGENT to draft spec
   ↓
[AGENT] drafts spec, fills every section, flags open questions
   ↓
[HUMAN] reviews spec, answers open questions, approves
   ↓
[AGENT] implements against spec, checks off acceptance criteria
   ↓
[AGENT-2] reviews PR (spec compliance + security + tests)
   ↓
[HUMAN] approves PR (skims screenshot, clicks through)
   ↓
[CI] runs all checks
   ↓
Merge → deploy
```

## What makes a good spec

A good spec is **specific enough that two agents reading it would build the same thing**.

### Good

> "Show the buyer's library. List every course they own, grouped by status (in progress / completed / not started). For in-progress courses, show the last lesson watched and a 'Resume' button. Below the course list, show their downloaded file vault, with 'Generate signed link' buttons."

### Bad

> "Show the user's stuff."

The good one tells you:
- What entities appear
- How they're ordered/grouped
- What fields appear per entity
- What the user can do (buttons)
- Where the data comes from

If a spec can be interpreted two different ways, it's not ready. Rewrite it.

## What about non-page work?

Not everything is a page. Specs for migrations, refactors, and infrastructure changes follow the same principle but use a different template. Put those in:

- **`decisions/`** — architecture decisions (ADRs). One file per decision. Even small ones. Especially small ones — "we use icon library X" deserves an ADR so the next agent doesn't undo it.
- **`_followups.md`** — issues filed when a TODO is found in code. Each entry has: what, why, who, when, status.
- **`pages/_followups.md`** — page-level follow-ups, separate from platform-level.

## When the spec changes

The spec is **append-only in spirit**. Don't delete old content; strike it through with `~~strikethrough~~` and add the new version below. History is valuable.

When the spec changes mid-implementation, update the spec **in the same commit** as the code change. Both at once. Don't land a code change that contradicts the current spec.

## The 30-second version for the human

1. **You write specs** (or approve agent-drafted ones).
2. **Specs are the contract** — agents build to the spec, you review against the spec.
3. **Acceptance criteria are the checklist** — every box has to be checked before merge.
4. **You don't read the code** — you read the spec + look at the screenshot.

That's it. Everything else is in `_template.md` and `AGENTS.md`.
