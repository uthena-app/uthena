# 05-ops/

Running the business. The documentation layer for the things humans need to do to keep Uthena alive: incident response, payout procedures, secret rotation, GDPR compliance, business decisions. **No code lives here.** This folder is for humans and for AI agents learning how to operate the system.

## Files

- **`README.md`** — this file
- **`runbooks/incident-response.md`** — what to do when the site is down
- **`runbooks/secret-rotation.md`** — how to rotate signing keys, API keys, JWT secrets
- **`runbooks/payout-procedure.md`** — the daily payout batch and how to debug it
- **`runbooks/security-incident.md`** — what to do when there's a security incident
- **`runbooks/deploy-procedure.md`** — the full deploy procedure
- **`decisions/`** — business-level decisions (not architectural; those are ADRs in `01-specs/decisions/`)
- **`compliance/gdpr.md`** — GDPR compliance: data subject rights, retention, breach notification
- **`compliance/tax.md`** — sales tax, VAT, partner tax form collection
- **`compliance/dpa.md`** — Data Processing Agreement status with vendors
- **`partners/`** — partner agreement template, onboarding flow doc (not code)

## What this folder is for

This folder exists because **some things can't be put in code**. Decisions about what to do when a database goes down. Decisions about how to handle a GDPR request. Decisions about whether to onboard a new partner. These are the things that humans (or AI agents under human supervision) need to do.

If you're a code agent reading this folder, you're here to:
- Understand the human-side constraints on the code (e.g. "we must respond to GDPR requests in 30 days" affects how we structure the user export flow)
- Find the runbook for an incident (e.g. "checkout is broken, what do I do?")
- Learn from past decisions (e.g. "why don't we use Vercel?" — the answer is in `docs/ARCHITECTURE.md` and the decision log)

## What does NOT go here

- Code (in `02-features/` or `04-platform/`)
- Specs (in `01-specs/`)
- Architecture decisions (those are ADRs in `01-specs/decisions/`)
- Test plans (in `06-quality/`)
- Marketing content (separate system)
- Customer support scripts (separate system)

## The format of a runbook

Every runbook in this folder follows the same structure:

1. **When to use this runbook** — the trigger condition. "If X happens, use this."
2. **Severity** — how urgent is it? P0 (down), P1 (degraded), P2 (single user affected), P3 (cosmetic).
3. **Who's involved** — on-call engineer, admin, human, etc.
4. **Steps** — the actual procedure, in order.
5. **Escalation** — when and how to escalate.
6. **Postmortem** — link to the template; required for P0/P1.

The format is consistent so an on-call engineer under stress can find their way around.

## How to update this folder

- **Runbooks** are updated whenever a new procedure is discovered. The owner is whoever runs into the situation first.
- **Decisions** are added when a business-level decision is made. Format: "Decision: ...; Context: ...; Date: ...; Decided by: ..."
- **Compliance docs** are updated when the law changes or when our practice changes. Reviewed quarterly.

## The "two-question test" for new files

Before adding a new file here, ask:

1. **Could this be in code?** If yes, put it in code. A runbook is for things that can't be code.
2. **Is this a one-time thing?** If yes, put it in the scratchpad, not here. Runbooks are for recurring situations.

If both answers are "no," this folder is the right place.
