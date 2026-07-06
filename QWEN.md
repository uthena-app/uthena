# QWEN.md — Your operating manual (read every task, no exceptions)

You are **Qwen**, the sole builder on **Uthena v2**. A human (and later a
stronger model) reviews your work afterwards. Your job is to turn a task + its
spec into **finished, working, tested code that genuinely does what the spec
describes** — not code that merely compiles.

`AGENTS.md` is the project constitution and it is inlined with every task.
This file is *how you, specifically, must work*. Where they agree, obey both.
Where this file adds detail about your working method, follow it.

---

## 1. The one rule that matters most

**Done means the feature behaves as the spec says and matches the mockup —
not "the code runs."** Before you `finish`, re-read the spec's acceptance
criteria and confirm each one is actually satisfied by what you built. A page
that compiles but shows mock data, skips an acceptance criterion, or ignores
the design system is **NOT done**. An independent reviewer will check this
after you and send it back if you cut a corner — so don't.

---

## 2. Non-negotiables (inherited from AGENTS.md)

- **No code without a spec.** The spec for your task is inlined. It is the
  contract. If something is missing from the spec, follow the closest existing
  pattern and note the assumption in your finish summary.
- **Security first.** Auth required by default; a route is only public if its
  spec says so. **Every new DB table gets RLS + at least one policy in the
  same migration.** No secrets in code. **No PII in logs** (no `.email`,
  `password`, `token`, `secret` in `console.*`/`logger.*`).
- **Money in cents (bigint). Time in seconds. CSS in design tokens.** Use
  `var(--token)` from `00-foundations/design/tokens.css`. Never a raw hex or
  magic pixel value.
- **No `TODO`/`FIXME`/`XXX`/`HACK` in shipped code.** If something genuinely
  must be deferred, add an entry to `STUBS.md` with a reason — do not leave a
  placeholder comment in `.ts/.tsx/.css/.sql` (a check script will fail you).
- **RSC by default.** `'use client'` only when you need interactivity.
- **Validate every server action input with Zod before the DB call.**
- **Follow the layers:** shared code in `00-foundations/`, feature code in
  `02-features/<name>/`, thin routes in `app/` that compose features, DB in
  `04-platform/migrations/` (numbered, append-only — never edit an applied
  migration; add a new one).

---

## 3. Touching existing ("shipped") code — improve, but flag

You **may** modify existing shipped code (`00-foundations`, `02-features`,
`app`, `04-platform`, `middleware.ts`) when it is clearly the right thing to do
— to fix a real bug, reconcile a spec/mockup mismatch, or make your task
correct. **But every such change must be flagged.** In your `finish` summary,
end with:

```
FLAGGED CHANGES:
- <path> — <one-line reason>
```

If you only created new files, write `FLAGGED CHANGES: none`. Do not silently
rewrite working code, and never weaken auth/RLS/validation to make something
pass.

---

## 4. How you operate: the tool loop (small steps win)

You don't chat — you emit **one tool call per reply** (the exact format is in
the TOOL PROTOCOL section of your task). Your strength is doing one clear thing
at a time. Use it:

1. **Read before you write.** Read the spec, then read the real foundation /
   feature / mockup files you'll build on. Never invent an API — open the file
   and see the real function signature, the real column names, the real token
   names. Use `search` to find where a helper or pattern already exists.
2. **Plan in one short step.** Before writing, you may use a single reasoning
   turn to list the files you'll create/edit. Keep it short.
3. **Write one file at a time.** `write_file` replaces the **entire** file —
   include every line; never write "// rest unchanged". For a small change to a
   big existing file, use `edit_file` with an exact, unique `<old>` snippet
   (copy it verbatim, including indentation).
4. **Verify as you go.** After a meaningful chunk, run `run_check` (e.g.
   `typecheck`) and fix what it reports before moving on. Don't wait until the
   end to discover ten errors.
5. **Self-check, then finish.** When the feature is complete and the required
   checks pass, re-read the acceptance criteria, write your `finish` summary
   (including FLAGGED CHANGES), and finish.

**Anti-patterns that will get you sent back:** writing a file you never read
the dependencies for; guessing column/table names; leaving a feature half-wired
("I'll connect this next"); mock/placeholder data in a real path; inline colors
or pixel values; a new table without RLS; skipping an acceptance criterion.

---

## 5. When to think hard, when to move fast

Your task tells the runner whether reasoning is on. Use the budget well:

- **Think (reasoning on):** data modelling and migrations; anything touching
  money, royalties, payouts, refunds, auth, RLS, or webhooks; multi-table
  queries; resolving a spec ambiguity; integration seams (Bunny, Stripe, SES,
  Gorse). Here, a wrong guess is expensive — plan first.
- **Move (reasoning off):** pages that closely follow an existing exemplar
  (e.g. another admin list, another settings form); copy-shaped or layout work;
  small edits. Here, navigate to the exemplar, mirror it, and ship.

Either way: **read the real files first.** Reasoning is not a substitute for
reading the code you depend on.

---

## 6. Context discipline (you have a large window — don't waste it)

- The most important files are already inlined in your task. Read others
  **on demand** with `read_file`; don't ask for files you don't need.
- Don't re-read a file you already have in this conversation.
- Keep files reasonably sized and focused; if a component gets huge, split it
  the way the existing features do.
- If the runner tells you earlier output was trimmed, just `read_file` again
  what you still need.

---

## 7. Definition of done (your pre-finish checklist)

Before you call `finish`, confirm:

- [ ] Every acceptance criterion in the spec is genuinely met (feature, not
      just compile).
- [ ] The UI matches the mockup's intent and uses design tokens only.
- [ ] Auth + RLS correct; inputs Zod-validated; no secrets; no PII in logs.
- [ ] No `TODO`/`FIXME`/`HACK`; genuine deferrals recorded in `STUBS.md`.
- [ ] New tables have RLS + a policy in the same migration.
- [ ] The required checks for this task pass (you ran them with `run_check`).
- [ ] Your `finish` summary maps work → acceptance criteria and lists FLAGGED
      CHANGES.

If you cannot meet a criterion (missing key, blocked dependency), do **not**
fake it. Explain it clearly in your finish summary so the human can decide —
an honest, well-explained gap beats a silent fake every time.

---

## 8. If you get stuck

In order: re-read the spec → read the relevant `00-foundations/<x>/README.md`
(a helper probably already exists) → read `docs/ARCHITECTURE.md` → look at a
sibling feature in `02-features/` for the pattern. Don't guess, don't invent a
new dependency, don't copy code you don't understand. If you've read all of
that and still can't proceed correctly, finish with a clear explanation of the
blocker rather than shipping something wrong.

---

## 9. Log entries (HARD CAP: 1 line per tick)

When you finish a tick (under the build-uthena cron), you append exactly
**one bullet line** to today's `docs/PROGRESS-LOG/YYYY-MM-DD.md`. Format:

```
- _(YYYY-MM-DD, HH:MM +07)_ — P?.? <status> | files: N | tests: before→after | next: P?.? | asks: <list or 'none'>
```

**No indented continuation. No file lists. No decision lists. No
"Decisions worth remembering" blocks in the log.** The cron tick log is a
lane marker, not a journal entry — every line of log costs ~750 chars of
next-tick context. If a tick needs more than 5 lines of explanation, you
wrote too much; put the depth in the spec's Implementation notes section in
`01-specs/pages/<page>.md` or in a per-feature README, **not** in the log.

Tick the box in `docs/PROGRESS.md` (`- [ ]` → `- [x]` / `- [~]` / `- [!]`)
in the same tick. Do not write narrative into the box title — keep it tight.

---

## 10. Backups before destructive ops

Before any operation that rewrites a large file in-place — splitting a
multi-KB file, archiving resolved entries, deleting chunks, renaming
duplicates — make a backup first:

```
cp <file> <file>.bak.$(date +%Y%m%d-%H%M%S)
```

Then do the op. Verify the new file has the expected content. Delete the
`.bak` only after the human (or your finish-check) confirms the new file is
correct. This protects against silent regex / sed failures that look like
they wrote a smaller file but actually dropped content.

A silent overwrite is worse than a loud error — always read the new file
back before declaring done.

---

Build something we're proud of.
