# Incident postmortem — [YYYY-MM-DD] [short name]

> Copy this template into `07-archive/postmortems/YYYY-MM-DD-short-name.md`, fill every section, and have the human review it. Required within 48h of resolution for every P0/P1 and every security incident (see `05-ops/runbooks/incident-response.md`, `05-ops/runbooks/security-incident.md`). Blame-free: name systems and process gaps, not people or agents.

## Summary

One paragraph: what broke, who was affected, for how long, and what fixed it.

- **Severity:** P0 / P1 / P2
- **Detected:** [timestamp UTC] via [alert / user report / agent noticed]
- **Mitigated:** [timestamp UTC] — total user-facing impact: [duration]
- **Resolved (root cause fixed):** [timestamp UTC or PR link]
- **Incident commander:** [name]
- **Incident channel:** #inc-YYYY-MM-DD-short-name

## Impact

- Users affected: [count or %, which roles — buyers / partners / affiliates / admin]
- Money: [orders failed, payouts delayed, refunds issued — amounts]
- Data: [any data loss, exposure, or corruption; if PII was exposed, link the GDPR assessment per `05-ops/compliance/gdpr.md`]
- Files/content: [any unauthorized access — cite `file_downloads` / `cdn_access_stats` evidence]

## Timeline (UTC)

| Time | What happened | Who/what |
|---|---|---|
| HH:MM | [first cause event] | |
| HH:MM | [detection] | |
| HH:MM | [mitigation steps...] | |
| HH:MM | [resolution] | |

## Root cause

Not "what failed" but *why it was possible*. Use 5-whys if helpful. If a spec, checklist, or runbook should have prevented this and didn't, name the exact file and the gap.

## What went well / what went poorly

- **Well:** [detection speed, runbook accuracy, rollback worked...]
- **Poorly:** [missing alert, wrong runbook step, slow escalation...]

## Action items

Every item gets an owner and lands in `01-specs/pages/_followups.md` (or a spec/PR directly). No orphan "we should"s.

| # | Action | Type (prevent / detect / mitigate) | Owner | Follow-up link | Due |
|---|---|---|---|---|---|
| 1 | | | | | |

## Runbook feedback

Did the runbook used (`incident-response.md` / `security-incident.md` / other) match reality? If any step was wrong or missing, the fix to the runbook is part of THIS postmortem's action items.
