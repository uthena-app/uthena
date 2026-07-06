# db-types — TypeScript types generation wrapper

P3.7 Slice 1 ships the CI machinery that keeps `00-foundations/data/types.generated.ts`
in lockstep with the live Supabase schema. Two scripts + one workflow
together implement the "no hand-written DB types" contract.

## What it does

`db-types.ts` wraps `supabase gen types typescript --db-url <URL>` and
writes the output to `00-foundations/data/types.generated.ts`. The
wrapper adds:

1. **PII-safe logging.** The database URL (which can carry the
   service-role password in the query string) is redacted before
   being logged. The redaction helper is shared with `db-bootstrap.ts`
   so both scripts use the same logic — and the same test coverage.
2. **Atomic write.** The output is written to a temp file in the
   same directory, then `rename()`'d over the destination. POSIX
   guarantees that `rename()` is atomic within a directory, so a
   reader (e.g. the next typecheck run) never sees a partial file.
3. **Skip-gracefully behavior.** If the Supabase CLI isn't installed
   or the DB isn't reachable, the wrapper prints a clear "skipped"
   message and exits 0. This makes it safe to call from CI jobs that
   may or may not have the environment ready.

`check-types-fresh.ts` is the drift detector. It generates types to a
temp file and compares against the committed one. Returns:

- `fresh` (exit 0) — committed types match a fresh generation.
- `stale` (exit 1) — drift detected; the contributor must run
  `pnpm db:types` and commit the result.
- `missing` (exit 3) — no committed types file exists yet; first-run
  setup.
- `generation-failed` (exit 2) — the wrapper itself failed; the
  environment needs attention.

`.github/workflows/db-types.yml` ties them together:

- **On PR** — runs `db-bootstrap` → `db-types` (to a temp path) → diff
  against the committed file. Fails the PR if drift is detected.
- **On push to main** — runs `db-bootstrap` → `db-types` (to the real
  path) → commits the result if it differs from the previous commit.
- **Daily at 06:17 UTC** — same as push-to-main, catches out-of-band
  schema drift (e.g. a manual Supabase Studio change).
- **`workflow_dispatch`** — manual re-run from the Actions tab.

## How to run

### Local regeneration

```bash
# Against the local Supabase Postgres (default URL)
pnpm db:types

# Against a custom DB
DATABASE_URL=postgresql://user:pass@host:5432/dbname pnpm db:types
```

The script writes to `00-foundations/data/types.generated.ts`. Commit
the result alongside any migration that changed the schema.

### Local drift check

```bash
pnpm db:types:check
```

Exits non-zero if the committed types are stale relative to a fresh
generation. The wrapper itself may skip if no DB is reachable —
that's exit 0 (a `skipped` outcome, distinct from `fresh`).

### CI

The `db-types` workflow runs on every PR that touches
`04-platform/migrations/**`, on every push to main that touches the
same path, daily via schedule, and on manual dispatch. See the
workflow file for the full trigger matrix.

## Why a Node wrapper, not a shell one-liner

The original `db:types` script was a one-liner that called
`supabase gen types typescript --local > 00-foundations/data/types.generated.ts`.
That worked for local dev when the CLI was on PATH and the local
Supabase stack was running. It had three problems for CI:

1. **No redaction.** The `--db-url` value was logged in plain text. A
   `postgres://...?password=...` URL would leak the password.
2. **No atomic write.** A partial write (interrupted mid-stream)
   would leave `types.generated.ts` broken, blocking the next
   typecheck.
3. **No skip-gracefully.** A missing CLI produced "command not found"
   instead of a structured "skipped" outcome.

The Node wrapper fixes all three without adding a runtime dependency
— it only uses Node's built-in `child_process`, `fs`, and `path` modules,
plus the `pg`-free path through `spawnSync`. No new packages in
`dependencies` or `devDependencies`.

## When does Slice 2 land?

The current `00-foundations/data/types.ts` is a **hand-written
placeholder** with 7 table row types (the catalog surface). Slice 1
ships the CI machinery; Slice 2 will:

1. Replace `types.ts` with a re-export from `types.generated.ts` once
   the first CI run produces the file.
2. Add a pre-commit hook that runs `pnpm db:types:check` and refuses
   the commit if drift is detected (the GitHub Action is the
   server-side half; the hook is the local half).
3. Delete the hand-written `Tables<T>` exports once
   `types.generated.ts` is the single source of truth.

Slice 2 is blocked on the first CI run producing a valid
`types.generated.ts`. The cron can't trigger that locally (no
running Supabase); the workflow can, but only after the repo is
pushed to GitHub. Track Slice 2 in the next tick after the first
push.

## Files in this slice

| File | Purpose |
| --- | --- |
| `db-types.ts` | The wrapper script — generates + writes atomically. |
| `db-types.test.ts` | Pure-function tests for `readGeneratedTypes`. |
| `check-types-fresh.ts` | The drift checker — generates + compares. |
| `check-types-fresh.test.ts` | Type-shape tests for `FreshnessResult`. |
| `.github/workflows/db-types.yml` | The CI workflow (PR + push + schedule + dispatch). |

## Integration with P3.6 (db-bootstrap)

`db-types.yml` runs `pnpm db:bootstrap` before `pnpm db:types` —
the bootstrap populates the Postgres service with every migration,
so the types reflect the same end-state that production will see.
This is why P3.6 and P3.7 are sequenced — Slice 1 of P3.7 depends
on Slice 1 of P3.6 (the bootstrap + verify scripts).

If the bootstrap step fails (a migration doesn't apply cleanly), the
workflow aborts before `db-types` runs — the contributor sees the
bootstrap error first, which is the right ordering.

## Reusable lessons

- **Atomic writes via `rename(2)`.** Writing to a temp file in the
  same directory + `rename()` is the canonical POSIX atomic-rename
  pattern. The temp filename includes `process.pid` + `Date.now()`
  so concurrent invocations don't clobber each other.
- **Skip-gracefully vs fail-hard.** The wrapper distinguishes "the
  environment isn't ready" (skip, exit 0) from "the call failed for
  a real reason" (fail, exit 1). CI jobs that gate on explicit
  bootstrap success can use `--skipIfUnavailable` to opt into
  fail-hard behavior.
- **Drift detection needs the temp-file write path.** Comparing in
  memory would skip the atomic-write code path, which is the most
  likely source of partial-write bugs. The temp-file write is
  intentionally identical to the production write so the check
  exercises the same code.
