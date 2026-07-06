# RETIREMENT.md — Uthena build-orchestration cleanup, 2026-06-24

> **Audit trail for the cockpit + qwen-runner cleanup.** Per Klaas's
> direction 2026-06-24 ("Let's remove the idea of having a dashboard for
> building this, and remove those parts"). Everything that was removed
> is recoverable from macOS Trash for the next 30 days. After that, the
> only surviving reference is the preserved
> `docs/legacy/qwen-runner-backlog.json`.
>
> **What we kept.** `/Users/klaas/Documents/AllProjects/` (cross-project
> meta-dashboard workspace — out of scope). The Soofos
> `build-build-build` cron. The Uthena project itself, untouched.

---

## Trashed (2026-06-24 09:38 +07)

All deletions used `mavis-trash` (recoverable; macOS Trash → 30-day window
before purge).

| # | Path | Size | Why it went |
|---|---|---|---|
| 1 | `/Users/klaas/Documents/Uthena/.mavis/dashboard/` | 176 MB | Uthena Cockpit v1 (Vite + React + TS + Express + sql.js). Sole purpose was the per-project build cockpit. Replaced by the hourly `uthena-builder` cron reading `docs/PROGRESS.md`. |
| 2 | `/Users/klaas/Documents/Uthena/.mavis/data/` | 0 B | Empty Cockpit runtime-data directory. |
| 3 | `/Users/klaas/Documents/Uthena/.mavis/plans/` | 156 KB | Old mavis team-plan YAML from the PH10a era. Superseded by the simple cron. |
| 4 | `/Users/klaas/Documents/Uthena/01-specs/pages/cockpit-v2.md` | 8.7 KB | Unbuilt Cockpit v2 spec. |
| 5 | `/Users/klaas/Documents/Uthena/01-specs/pages/cockpit-v2-implementation.md` | 5.1 KB | Companion to cockpit-v2.md. |
| 6 | `/Users/klaas/Documents/Uthena/mockups/cockpit-v2.html` | 26 KB | Unused reference HTML for the unbuilt Cockpit v2. |
| 7 | `/Users/klaas/Documents/Uthena/docs/COCKPIT_V2_AUDIT_AND_PLAN.md` | ~14 KB | Companion to cockpit-v2.md. |
| 8 | `/Users/klaas/Documents/Uthena/qwen-runner/` | 212 KB | Local Qwen model harness with its own dashboard (LM Studio driver, OpenAI-compat API, 30-task backlog). The runner itself and its dashboard are dead weight; only the backlog is preserved. |

**Total recovered disk:** ~176 MB (mostly `node_modules` inside
`.mavis/dashboard/`).

## Preserved (intentionally kept)

| # | Path | Why |
|---|---|---|
| 1 | `/Users/klaas/Documents/Uthena/docs/legacy/qwen-runner-backlog.json` (20 KB) | 30-task dependency-ordered backlog from the Qwen runner. Useful as a cross-reference for the new plan (we're not bound by it, but it's a 30-task workup). Out of the way under `docs/legacy/`. |
| 2 | `/Users/klaas/Documents/Uthena/.mavis/active-phase.md` | Orchestrator log. The Cockpit-v1 entry (2026-06-19) is left as historical record; not edited. |
| 3 | `/Users/klaas/Documents/Uthena/docs/PHASES.md` | The merged build plan. Replaces both the old `PHASES.md` and the `PHASES-V3.md` draft. |
| 4 | `/Users/klaas/Documents/Uthena/docs/PROGRESS.md` | The live checklist the cron reads. |
| 5 | `/Users/klaas/Documents/Uthena/docs/AUDIT.md` | The current-state audit (now updated to mark §6 as DONE). |
| 6 | `~/.minimax/agents/mavis/crons/uthena-builder.md` | The new hourly cron prompt. Still has 3 stale references to `docs/PHASES-V3.md` (now deleted); awaiting permission to update those references before the cron is enabled. |

## Decision context (Klaas, 2026-06-24)

- The cockpit concept for building (cross-project meta + per-project) is
  being retired. The hourly Mavis cron + a markdown checklist is the
  replacement. Simpler, easier to inspect, fewer moving parts.
- `AllProjects` is preserved. It's not a build cockpit for Uthena; it's
  a separate cross-project workspace Klaas uses for other things.
- The Qwen runner inside Uthena is gone (it was a separate
  LM-Studio-driven harness with its own dashboard). The backlog JSON
  survived because it captures useful task structure for the new plan.
- Cron stays `disabled: true` until the full task list is reviewed and
  Klaas enables it via `mavis cron enable mavis uthena-builder`.
- No git was introduced (STUB-003 still holds).

## Recovery

If anything needs to come back, items are in macOS Trash:

```bash
# list trash
ls ~/.Trash/ | grep -i "uthena\|qwen\|cockpit"
# restore a specific path
mv ~/.Trash/<name> /Users/klaas/Documents/Uthena/<original-path>
```

After 30 days macOS purges Trash and the recovery path closes. The
preserved `docs/legacy/qwen-runner-backlog.json` is the only permanent
survivor of the Qwen runner.
