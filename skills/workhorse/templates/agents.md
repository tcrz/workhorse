# {{AGENT_FILE_NAME}}

{{PROJECT_PURPOSE}}

<!-- harness:managed:start -->

## Startup Workflow

Before writing code:

1. Confirm working directory with `pwd`
2. Read this file completely
3. **Read existing project documentation if present** — `README.md`, `CONTRIBUTING.md`, `docs/` (architecture, flows, ADRs). It is the project's own source of truth; inherit its decisions instead of re-deriving them
4. Run the baseline `node init.mjs` (cross-platform; `./init.sh` is a bash wrapper) to verify the repo is healthy
5. Read `feature_list.json` for current task state — if any row has a `featId` and status ∈ `{in-progress, verified}`, resume that feature to completion before starting anything else (see **Feature delivery** → Resume); never commit its `verified` rows individually
6. **Read plan files before resuming existing rows** — for every row you will work on that you did not author this session, read its `planFile` (`.harness/plans/feat-NNN.md`). The plan's **Task specs** section is the implementation contract; the row `description` is a one-line tracking label, not the spec
7. If the message is implementation work, ensure you're on a compliant **feature branch** before editing code (see **Branch Discipline**)
8. If the message is implementation work, add/activate a task row **before** editing code (see **Request Triage**)
9. Review recent commits: `git log --oneline -5`. If `git log @{u}..HEAD` shows **unpushed commits**, name them in one line — read each commit's `Tasks:` trailer → match task ids to rows → their `featId`; commits without a trailer are counted but unnamed (e.g. *"2 committed features not yet pushed (feat-001, feat-002) + 1 other commit"*). **Resume:** if the queue still has work, keep implementing and push at the normal triggers; if the queue is empty, run the push gate (`supervised`: ask `Push now?`). If the previous session stopped on a block or hard rail and asked whether to push, **ask again** — don't push on your own

If the baseline is failing, repair that first before adding new scope.

## Branch Discipline (feature branch before code)

All implementation happens on a **feature branch** — never directly on a protected branch. Protected branches are `main`, `master`, and `feature_list.json` → **`integrationBranch`**.

`feature_list.json` → **`branchPattern`** defines the naming convention (default `feature/<short-desc>`). Placeholders: `<short-desc>` — a kebab-case summary of the work (e.g. `add-otp-login`); `<username>` — the local-part of `git config user.email`, lowercased (only when the pattern uses it).

**Gate (run before implementation):**

1. `git rev-parse --abbrev-ref HEAD` — read the current branch.
2. If it already matches `branchPattern` (placeholders match any non-empty segment), proceed on it.
3. Otherwise **create and check out** a compliant branch off the current base: `git checkout -b <branch>`.
4. Never implement, commit, or push on a protected branch.

One branch covers the whole request (which may span several features and rows). Establish it once, up front; do **not** re-branch per row.

**PR target is separate from create base.** Do not infer "branched from X ⇒ PR to X". Feature PRs target `integrationBranch` (resolved at scaffold — see **Pull request**).

## Approval mode

`feature_list.json` carries a top-level **`approvalMode`** — `autopilot` or `supervised` (default when absent). Read it on session start. Mirror the active mode in `progress.md` → **Current State** so a fresh session resumes with the same policy.

**Scope.** `approvalMode` controls the delivery gates — commit approval, push offer, PR offer — and the post-triage **where-to-start** ask. It does **not** relax plan approval or breakdown approval, and never relaxes a hard rail.

| Gate | `autopilot` | `supervised` (default) |
|------|-------------|------------------------|
| **Where to start** | Skip the ask — start the earliest feature in plan order. After each feature is **committed**, **continue the queue**; never ask the human to continue | Ask `Which feature(s) do you want to start with? (feat-NNN[, feat-NNN…] / all)`. On `all`, continue the queue after each committed feature, same as autopilot |
| **Commit** (`Approve this commit?`) | After the verification stack passes (steps 1–4 of **Completing a feature**), present the review overview and commit **in the same turn** | Pause; commit **only** after an explicit affirmative in a later message |
| **Push** (`Push now?`) | Skip the ask; run the push gate inline at each **push-gate invocation** (not after every feature) | Ask **once per invocation**; push only on an explicit push affirmative. `not yet` is recorded in `progress.md` and the queue continues |
| **PR** (`Open a pull request?`) | Skip the ask; open the PR at the run's first successful push | Ask once, at the first push; open only on `yes` |
| **CI watch** (`Watch this PR's CI?`) | Soft-ask once the queue is empty; silence = decline | Same |
| **Feature review** (step 4) | Runs automatically; on `fail` show the first report, fix inline, re-run (cap 2). Unobserved behaviour stops and asks (hard rail) | Same trigger; on `fail` ask `Fix review findings and re-run? (yes / not yet)`. Unobserved behaviour stops and asks |

**Hard rails (never relaxed, any mode).** Stop and do not push when any of these hold:

- The quality gate (`node init.mjs --build`) exits non-zero — abort the push gate; only an explicit later **`push anyway`** proceeds without a fix.
- The current branch is protected.
- A new or upgraded dependency is flagged by the package manager's audit (`npm audit`, `pip-audit`, `cargo audit`, …) with a known high/critical vulnerability and no safe version.
- The step-4 feature review returned a `fail` that remediation did not clear within 2 cycles.
- The step-4 feature review left behavioural criteria **unobserved** and the human has not explicitly accepted them (see **Reviewer** → Unobserved behaviour).
- Deliverable-shaping ambiguity, unconfirmed assumptions, or destructive scope — clarify per **Request Triage**.

**Session override.** If the human changes the mode in natural language (`approval mode: autopilot`), write it into `feature_list.json` once, note it in `progress.md`, and apply it from then on.

**Plain-text contract.** `approvalMode` does not depend on any IDE-native approval UI. In `autopilot` the ask lines are simply omitted.

### Delivery levels: per feature, per push, per run

A multi-feature request verifies, reviews, and commits **each feature on its own**, but pushes and opens the PR **once per push-gate invocation**. A single-feature request runs all three levels back to back.

| Milestone | Reached when | Unlocks |
|---|---|---|
| **`committed`** | Feature commit exists, rows are `done`, `evidence` + `reviewVerdict` set | **Continue the queue** — next feature starts immediately, **without pushing** |
| **`delivered`** | A push-gate invocation pushed that commit and the PR exists | Nothing further |

Row status `done` means **committed**. `delivered` is a reporting milestone, not a row status. **The queue runs off `committed`, never off `delivered`.**

**Batch checkpoint.** `BATCH_CHECKPOINT_FEATURES = 4` — after 4 features committed since the last successful push, run a checkpoint invocation.

**A push-gate invocation runs** at the first of: (a) the queue is empty; (b) the human said "stop after this one"; (c) a checkpoint; (d) the session is ending with committed, unpushed features **and no stop is awaiting the human**.

**Stops.**

- **A feature goes `blocked`** or **a hard rail fires during implementation** → stop, report the blocker and the committed-but-unpushed features, and ask in **both** modes: *"Push the N committed features now? (yes / not yet)"*. Never push on your own here.
- **"Stop after this one"** → commit the current feature and run the push gate as the final invocation.
- **A push-gate failure** → report `push blocked — <reason>`; do not re-run on your own.

## Request Triage

Humans prompt in natural language; **you maintain `feature_list.json`** (the human will not edit it).

### Task row before code

If the user asks you to **build, add, create, implement, fix, or change** product code, you **MUST** update `feature_list.json` **before** editing application source. Utils, helpers, and pages all need rows.

Skip a row only for: **questions** (explain/review/compare), **read-only** work (search/audit/summarize), or **baseline repair** (`node init.mjs` is red — fix that first, no new scope).

| User says | You must |
|-----------|----------|
| "Create a login page" | Plan → row → `in-progress` → implement |
| "Add a util for X" | Plan → row → `in-progress` → implement |
| "Fix the auth bug" | Add/reuse row → fix |
| "How does login work?" | Answer only; no row |

**Canonical order:** ensure feature branch → planning subagent (clarification + plans + task specs) → save all plan files → present breakdown → self-audit task specs → write all rows → where to start → implement. **Everything before implement completes for the entire request — all features, all tasks — before any code is written.**

### Clarification policy

Clarification is owned by the **planning subagent**. When it hits an unknown it cannot resolve, it **returns early** with an `elicitationForm`; the main agent renders it, collects every answer, and **resumes the same subagent once**. Repeat until there is zero ambiguity.

**Ask when:** scope or acceptance is unclear; the request maps to more than one distinct build; critical input is missing (auth model, data source, target surface, external contract); the change is destructive or irreversible; several approaches or libraries are viable and the trade-off needs the human.

**Don't ask** for reversible, low-stakes choices (naming, file location, formatting) — pick a default and note it. **Deliverable-shaping choices** (a surface's fields, flow, post-action, auth integration, data contract) are never "default + note" — clarify them, or list them as **unconfirmed assumptions** and require breakdown approval.

**Adjacent surface ≠ inherited spec.** Signup after login, edit after create — each is a new triage. Do not copy the prior feature's fields, flow, or auth model unless the human stated them in this request.

**Elicitation form contract:**

```json
{
  "elicitationForm": {
    "questions": [
      {
        "question": "Which authentication flow should be used?",
        "header": "Auth flow",
        "options": [
          { "label": "Existing session auth (Recommended)", "description": "Reuses the app's current login and session middleware." },
          { "label": "Email/password", "description": "Adds application-managed credentials and recovery." }
        ],
        "multiSelect": false
      }
    ]
  }
}
```

Each question: non-empty prompt, header ≤ 12 characters, 2–4 options with labels and descriptions, explicit `multiSelect`. Recommended option first. No synthetic `Other` option (the client supplies it). Question text is the answer key — keep it stable and unique. Return either the form or completed planning output, never both.

### Planning Phase (subagent — two phases)

Every implementation request is delegated to a **planning subagent** using the **Resumable Coordinator** pattern zero context on dispatch, context preserved across resumes. **If the `workhorse-planner` subagent is available** (Workhorse plugin installed), dispatch it — its model and no-write tool restrictions are set in its definition. Otherwise spawn a general subagent on the most capable reasoning model available, with no file-editing work in its brief. Either way, **this file is the planner's rulebook**: the subagent reads the sections listed below itself, so don't paste them into the prompt.

- **Phase 1 — Overall plan.** From the raw request, produce `.harness/plans/overview.md` (template: `.harness/templates/overview-plan.md` — goal, mermaid flow, feature split, cross-cutting concerns, assumptions, risks). Present it, iterate elicitation rounds, and get explicit approval (`status: draft → approved`, stamp `approvedAt`). Phase 2 does not run until approval.
- **Phase 2 — Per-feature plans.** Produce `.harness/plans/feat-NNN.md` per feature (template: `.harness/templates/plan.md`): overview, **acceptance criteria (required)**, flow diagram, files to touch, data flow, behaviour checks, interface contracts, **task specs**, sequencing, risks.

**Naming.** With the plugin, the subagent is `workhorse-planner`. Without it, give a general subagent the visible label `Harness Planner` when the spawn tool has a description field; otherwise put `Role: harness-planner` at the top of the prompt. **Resume is always keyed by the subagent ID** captured at dispatch — never re-spawn by name or label.

**Code graph (optional).** If a code-graph tool is available (e.g. GitNexus CLI + MCP), index the repo and include it in the subagent's tools so `filesToTouch[].connections` carry real dependency edges. Absent → infer from imports. Never blocks planning.

**Subagent prompt (self-contained — it has no conversation history):**

- `Role: harness-planner`
- The raw user request, verbatim
- Codebase context: structure, stack, relevant file contents, current `feature_list.json`, and existing project docs
- How to run the app locally (dev command, URL/port, seed/login steps), so every objective can be written as something the Reviewer can observe
- Which phase to run, and for Phase 2 the approved `overview.md` path
- **The rulebook pointer:** read this file's **Request Triage** section — *Clarification policy*, *Planning Phase*, *Task spec content bar*, *Break work down* — plus `.harness/templates/overview-plan.md` and `.harness/templates/plan.md` before starting, and follow them; return content only, the main agent saves it

**Full-coverage rule.** Every plan spans the **entire** request. Never produce or offer a partial plan; implementation ordering is decided after breakdown approval (**Where to start**).

**Feedback loop.** Validate every returned form before showing it; send malformed forms back to the same subagent with precise errors. Render valid questions unchanged via your question tool (batched only if the client has a limit), or as structured Markdown if no tool exists. After **all** answers are in, resume the subagent **once** with `{ questions, answers }`. Confirmed decisions go into the plan sections; never copy raw Q&A into artifacts. No round limit.

**Saving plans.** Write every plan to disk before presenting the breakdown. `status: draft` until approved.

### Task spec content bar

Each task's spec lives in its feature plan under `## Task specs` and must stand alone as an implementation contract a fresh session can execute. Author specs **feature by feature**, as each plan is written — never in one trailing pass over all features (that pass is where quality collapses into boilerplate).

Per task:

- **Target file** — primary path changed; `[NEW: path]` for new files.
- **Summary** — 2–4 sentences: what changes at the surface, why it matters, and the shape of the delivered artifact. Not a title paraphrase.
- **Objectives** — verifiable outcomes, one bullet each ("Return 401 on invalid credentials").
- **Regression risks** — a concrete risk and how it stays contained.
- **How to observe** — concrete steps that show each objective holds in the running app (action → expected result), including error and edge cases. This is what the Reviewer drives; there are no tests, so an objective nobody can observe can never pass.
- **Technical notes** — non-obvious details (versions, ordering caveats, flags). Omit when there is nothing.
- **Code sample** — only when a short excerpt removes ambiguity prose cannot.

**Self-audit gate (main agent, before writing rows).** Check every spec across all features; on any hit, **resume the planning subagent** to re-author that feature's specs — never patch with more boilerplate:

- **Cross-task dedup** — no two tasks share an identical or trivially templated Summary / Objectives / Risks / How to observe.
- **Observable** — every behavioural objective has a How-to-observe step a reviewer could actually perform locally.
- **No pointer** — no section that reduces to "see the overview" or "see feat-NNN".
- **No title-echo** — no `Deliver: <title fragment>` openers or Summary that only paraphrases the title.
- **No layer-mismatch** — no DB/migration language on a pure util task, no API language on a UI-only task.

The bar holds equally for the last task and the first.

### Break work down

The unit of a row is **one independently verifiable deliverable** — something a user or caller can do or rely on that you can prove on its own. Size by **outcome**, not by file. Test: *can this be verified and committed on its own?*

- **Distinct actions** — a "manage X" page that views, edits, and deletes is three rows.
- **Distinct surfaces** — separate screens, routes, commands, entry points.
- **Shared building blocks** — a form shared by create and edit is its own row.
- **Supporting pieces** — config, lookup data, fixtures are their own row or an explicit acceptance criterion.

**Coverage check:** enumerate what the request implies (endpoints, routes, commands, cases) and confirm each maps to a row. Keep genuinely atomic work whole ("add a debounce util" is one row).

Sequence dependent rows with `dependencies`; let independent rows fan out.

### Approval gates

**Plan approval (Phase 1).** Point at `.harness/plans/overview.md`, give a compact preview (feature names, one-line goal), iterate, and wait for explicit `approved` / `go`. The human approves the **full** plan.

**Breakdown (Phase 2).** Present the breakdown organized by feature — each task's `id`, `name`, and one-line `description`. Then:

- **Single feature, fully specified** (no unconfirmed assumptions) → present and proceed in the same turn.
- **Explicit approval required** when: N ≥ 2 features; any **unconfirmed assumption**; or high-stakes scope (migrations, prod config, auth changes, data deletion, security-sensitive work). Ask `Proceed with these N tasks across M features? (yes / adjust breakdown)`.

Single-feature requests with no unconfirmed assumptions may collapse both reviews into one.

**Where to start (after rows are written).**

- **`supervised`** — ask `Which feature(s) do you want to start with? (feat-NNN[, …] / all)`. Start only what they name; `all` drains the queue in plan order.
- **`autopilot`** — start the earliest plan-order feature without asking.

**Atomic start (both modes, before any code):** set the feature's first task `in-progress` → record **`featureBaseSha`** (`git rev-parse HEAD`) on every row of that feature → note `Starting feat-NNN` in `progress.md` → implement.

Other same-request rows stay `not-started` as the **queue**. After each feature is committed, autopilot and supervised-`all` start the next one on the same branch — never ask "continue?". A supervised subset implements only the named features.

### Write the task row

1. `id` — next `task-NNN`
2. `name` — the **same** actionable sentence as the task's heading in the plan's Task specs. Prose, not a slug ("Reject blank titles with an inline error", not "Implement validation module")
3. `description` — one sentence: what "done" means — the behaviour a reviewer will see land
4. `status` — `in-progress` (only one at a time)
5. `dependencies` — `[]` unless blocked
6. `featId` — the parent feature (`feat-NNN`); required on every row
7. `planFile` — `.harness/plans/feat-NNN.md`; all rows of a feature point to the same file

**Continuation:** same request → reuse the row. New request while one is `in-progress` → finish or park the current one first.

### Feature delivery (tasks commit by feature)

Tasks within a feature are implemented and verified **one at a time**, then committed **together**.

**Per-task loop:** implement → fast gate → conventions check → set row to **`verified`** (evidence stays empty) → next `not-started` row in the feature. At most **one** row is `in-progress`. `verified` here means "implemented and statically clean" — behaviour is verified once, for the whole feature, by the Reviewer.

**Feature completion.** When every row sharing the `featId` is `verified`: run the **feature review** once (step 4), present **one** commit overview for the whole feature, commit once, and set every row `done` with the **same** evidence.

**Review verdict.** Set **`reviewVerdict`** on every row of the feature — `pass` (every criterion confirmed) or `unverified-accepted` (the human accepted behaviour the Reviewer could not observe). A `fail` is never committed: it is fixed, the criterion is corrected with the human's agreement, or the feature goes `blocked`. A `done` feature without a verdict fails `workhorse-validate`: the review is the harness's only behaviour check, and the verdict is its only trace.

**Feature base sha.** Captured at atomic start, identical on every row of the feature. Lets the review scope in-feature commits (`git diff <featureBaseSha>..HEAD`) after a remediation commit. Missing → review falls back to `git diff HEAD`. Never guess a base by walking history.

**Rules:**

- **Never commit one `verified` row alone** — wait for the whole feature.
- **Changes requested:** reopen only the named rows (`in-progress`), fix, re-verify, set back to `verified`, then **re-run the feature review** and re-present.
- **Abandoning:** move **every** row of the feature to `blocked` with the reason in `progress.md`.
- **One feature open at a time** — don't start another feature while any row of the current one is `in-progress` or `verified`.
- **Resume:** on startup, a row with status ∈ `{in-progress, verified}` marks the active feature. Collect all its rows, read its plan, finish the next task, and continue. Mirror membership in `progress.md` → **Active feature**.

The validator enforces evidence emptiness on `in-progress`/`verified`, feature-hash completeness, and verdict presence. It cannot see transition history — follow this section as binding regardless.

## Completion Is Mandatory (do not stop early)

**Do not yield until the active task is `done` or `blocked`.** "Implemented and it compiles" is the middle of the task, not the end. Sanctioned pauses:

- **`supervised`** — the commit approval ask; the push offer; the PR offer.
- **Both modes** — a stop under **Delivery levels → Stops**; the unobserved-behaviour ask (**Reviewer** → Unobserved behaviour); a clarification the work cannot proceed without.

**Features extend this across tasks** — implement → verify → `verified` → next task, straight through, without yielding between tasks.

**Autopilot extends the turn through the queue.** Committing a feature is not the end of the turn: close it as `committed` and start the next plan-order feature. The turn ends when the queue is empty after the final push-gate invocation, a stop fires, or the human asked to stop.

## Working Rules

- **Feature branch before code** — see **Branch Discipline**
- **Task row before code** — update `feature_list.json` before application source changes
- **Planning subagent before breakdown** — it owns clarification and decomposition; all plans and rows exist before any code
- **Plan files are the spec** — the task contract lives in the plan's Task specs; read it before implementing a row you didn't author
- **You own the task list** — create/update rows from requests; never wait for a human to edit it
- **One task at a time** — at most one `in-progress`, even inside a feature
- **No tests** — the harness writes and runs no tests. Per task: `node init.mjs` (static checks). Per feature: the Reviewer observes behaviour in the running app. Push only: `node init.mjs --build` (build). Never run a production build during feature work
- **Conventions before done** — reconcile code with the project's own conventions (step 3)
- **Vet dependencies** — before adding or upgrading a dependency, confirm it is maintained and run the package manager's audit; a high/critical finding with no safe version is a hard rail
- **The Reviewer is the behaviour gate** — step 4 runs once per feature; nothing commits on unobserved behaviour unless the human explicitly accepts it. The at-will Reviewer runs only when the human asks
- **Approval-gated commit** — `supervised`: commit only after explicit approval; `autopilot`: commit in the same turn once verification passes
- **Stay in scope** — don't modify files unrelated to the current task
- **Leave clean state** — the next session runs `node init.mjs` on a clean tree

## Required Artifacts

- `feature_list.json` — task state (source of truth): `approvalMode`, `integrationBranch`, `branchPattern`, optional `prHost`, and `tasks[]`
- `progress.md` — session continuity log
- `.harness/plans/` — `overview.md` (Phase 1) and `feat-NNN.md` (Phase 2, including task specs)
- `init.mjs` — cross-platform runner: `node init.mjs` (fast gate) and `node init.mjs --build` (push quality gate); `init.sh` wraps it
- `session-handoff.md` — optional, for larger sessions

## Verification

### Tiered baseline

- **Fast gate** — `node init.mjs`: install + static checks (lint, typecheck). Run at startup and per task.
- **Quality gate** — `node init.mjs --build`: fast gate + build, and any extra checks the project configured. Run only at the push gate.
- **Behaviour** — observed once per feature by the Reviewer (step 4). This harness writes and runs **no tests**; don't add test files or run test suites unless the human asks.

```bash
node init.mjs           # fast gate: per task + startup
node init.mjs --build   # quality gate: before pushing
```

Do not run other build commands on your own during feature work.

### Completing a feature (run every time, no stopping)

Steps 1–3 run **per task**. Steps 4–11 run **once per feature**.

1. **Implement** — scope complete for this row, guided by its task spec in the plan.
2. **Fast gate** — `node init.mjs` passes.
3. **Conventions check** — reconcile the change with the project's documented conventions (`CONTRIBUTING.md`, `docs/`, lint/format config, patterns in neighbouring code); fix divergences. Then set the row `verified` and return to step 1 for the next task.
4. **Feature review (once every row is `verified`)** — dispatch the **Reviewer** on the feature's uncommitted work (see **Reviewer** → Rail invocation). A **`fail`** blocks: remediate, re-run, **cap 2 cycles**, then `blocked`. **Unobserved behavioural criteria** block too, until fixed or explicitly accepted by the human (see **Reviewer** → Unobserved behaviour). Carry the verdict into step 5.
5. **Commit approval** — present the review overview (see **Commit approval gate**). `supervised`: pause. `autopilot`: continue in the same turn.
6. **Commit** — stage the feature's files; message per **Commit message format**. One commit per feature.
7. **Capture hash** — run `git rev-parse --short HEAD` **immediately after** the commit; this is the only hash you may use. Confirm with `git show --stat HEAD`.
8. **Evidence** — set `evidence` to exactly `commit <hash>` on every row of the feature, and set `reviewVerdict`.
9. **Validate** — run `workhorse-validate.mjs --target .` when available; don't set `done` if tier-1 fails.
10. **Status** — set every row of the feature to `done`.
11. **Sync and report** — update `progress.md`, send the **post-done message**, and end with exactly one closing line.

While `in-progress` or `verified`, leave `evidence` empty; check output belongs in `progress.md` only.

### Commit approval gate

In **`supervised`**, after step 4 and **before any `git add`**, pause for explicit approval. Do not pre-stage.

In **`autopilot`**, the passing verification stack authorizes the commit — present the same overview and commit in the same turn. Hard rails still apply.

**Feature review overview:**

- **Feature** — `featId` and each task (`task-NNN`, name, one-line "done")
- **What changed** — files grouped by task, each with a short purpose (no raw diff)
- **Static checks** — fast gate result
- **Independent review** — the Reviewer's verdict and confirmation trail summary (*"7/7 criteria observed"*). If the human accepted unobserved behaviour, name the unobserved criteria and why, in plain words (*"behaviour not verified for 3 criteria: payment sandbox unreachable — accepted by you"*)
- **Proposed commit message** — the exact message (see **Commit message format**); the human may edit it
- **Out of scope / follow-ups** — anything deliberately left
- **Explicit ask** (`supervised`) — `Approve this commit? (yes / changes requested)`

**On pause:** record `Awaiting commit approval for feat-NNN` in `progress.md`.

**Approval semantics:**

- **Affirmative only** — `yes`, `approve`, `commit`, `lgtm` in a **later** message. Silence, `thanks`, `looks good`, an emoji, or an unrelated reply are **not** approval; re-ask if ambiguous.
- **Commit approval ≠ push consent** — `commit and push` or `ship it` authorizes only the commit. Push remains a separate gate and does not count as `push anyway`.
- **Same-turn ban (`supervised`)** — presenting the overview ends the turn.

### Commit message format (Conventional Commits)

```text
<type>: <short summary>

<body — what and why, max 300 characters>

Tasks: task-001 task-002
```

- **Subject** — types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `build`, `ci`, `style`, `revert`. Summary ≤ 72 chars. The plan's front-matter `commitType` proposes the type; the human may edit it.
- **Body** — one blank line after the subject; max 300 characters.
- **Trailer** — `Tasks: <id> <id> …` on its own last line, every task id in the feature, space-separated.
- **Fix commits without a trailer** — remediation commits at the push gate and CI fixes describe the fix and carry **no** `Tasks:` trailer; they are never feature evidence.

Example:

```text
fix: reject blank todo titles

Trims input before validation and shows an inline error instead of saving an empty todo; the list stays unchanged on rejection.

Tasks: task-004
```

### Post-done message

A short **body** plus a **closing line** (last line).

- **Delivered** — one bullet per task: `**task-NNN** — <one-line "done">`
- **Commit** — `` `<hash>` `` from step 7 — the same hash as the closing line and every row's `evidence`
- **Branch** — name, and whether commits are local or pushed
- **Before pushing** — one plain sentence describing what **will run** at the push gate in everyday terms (e.g. "lint, typecheck, and a production build"), derived from this project's **Verification Commands** — no script names. Say whether it has already run on this branch
- **Push offer** — `supervised`: `Push now? (yes / not yet)`. `autopilot`: no ask; the push runs at the next push-gate invocation

```text
**Delivered**
- **task-001** — Centered login layout
- **task-002** — Form validation on sign-in

**Commit:** `59e826f` — `feat: centered login with inline validation`
**Branch:** `feature/centered-login` — local, not pushed
**Before pushing:** lint, typecheck, and a production build will run — not run on this branch yet.

Push now? (yes / not yet)

Feature feat-001: done — evidence: commit 59e826f (task-001, task-002)
```

### Closing report (required wording)

One closing line **per feature completed** in the response:

```text
Feature <featId>: done — evidence: commit <hash> (task-001, task-002, …)
Feature <featId>: awaiting commit approval
Feature <featId>: in progress — <id> verified (<n>/<total>)
Feature <featId>: blocked — <one-line reason + what you need>
```

Multi-feature and push-gate lines:

```text
Feature <featId>: committed — evidence: commit <hash> (task-001, …)
Feature <featId>: delivered — evidence: commit <hash>, pushed, PR #<id> (task-001, …)
Feature <featId>: push blocked — <one-line reason + what you need>
CI fix pushed — evidence: commit <hash>, PR #<id>
```

- `committed` closes each feature in a multi-feature run; the queue continues without pushing.
- `delivered` is emitted per push-gate invocation, once for each feature the push carried. With no PR host, write `pushed (no PR)` in place of `PR #<id>`.
- `push blocked` replaces any `delivered` lines when the push gate fails; the features stay committed.
- Never close with "looks good", "it compiles", or "tracked as in-progress". If you can't fill in `done — evidence: commit <hash>` and aren't at a sanctioned pause or `blocked`, the feature isn't finished.

### Evidence format

When `status` is `done`, `evidence` is **only** the commit pointer:

```text
commit a1b2c3d
```

**Invalid:** `commit a1b2c3d — lint clean`, `uncommitted changes`. Never set evidence while `in-progress` or `verified`. All rows of a feature share one hash; the validator rejects a shared hash that isn't a complete, same-`featId` group.

### Pushing (quality gate)

`supervised`: the push gate runs only on `Push now?` → yes. `autopilot`: it runs inline at each push-gate invocation. The gate itself is identical:

1. **P.1 Branch check** — not a protected branch (see **Branch Discipline**).
2. **P.2 Quality gate** — `node init.mjs --build` from repo root. **Non-zero → abort**: report and stop; no push. Only a later explicit **`push anyway`** proceeds without a fix. In `autopilot`, do not auto-fix a P.2 failure unless the human says so.
3. **P.3 Push** — `git push -u origin <branch>`.
4. **P.4 Record** — `progress.md`: quality-gate result + `pushed to origin`.
5. **P.5 Pull request** — see **Pull request**: open one at the run's first push, or update the existing PR's description on later pushes.
6. **P.6 Report** — summary of what the push carried, one `delivered` line per feature.
7. **P.7 CI watch** *(queue empty only)* — see **Pull request** → CI watch.

**Nothing unpushed** (`git log @{u}..HEAD` empty) → skip the gate.

**Attributing a late failure (batched pushes).** When P.2 fails over several features, trace each failing check or file to its feature: walk `git log --format='%h %B' -- <path>` back past trailer-less fix commits to the first commit with a `Tasks:` trailer, and map its ids to a `featId`. If ambiguous (several features touch the path, or the failure comes from two features combining), report the candidates with evidence and attribute the fix to the batch. Fixes are **new commits** without a trailer; feature evidence is never rewritten.

**Fix loop** (after `push anyway` is declined and the human asks for a fix, or in autopilot when told to fix): fix → `node init.mjs` → new commit → re-run P.2. If the fix changes behaviour, re-run the Reviewer on the affected feature first.

## Pull request

### Host detection

Resolve the host once per session: `feature_list.json` → **`prHost`** (`github` | `gitlab` | `azure` | `none`) wins; otherwise derive from `git remote get-url origin`:

| Remote contains | Host | CLI |
|---|---|---|
| `github.com` | `github` | `gh` |
| `gitlab` | `gitlab` | `glab` |
| `dev.azure.com` or `visualstudio.com` | `azure` | `az repos` (azure-devops extension) |
| anything else | `none` | — |

If the CLI is missing or not authenticated (`gh auth status`, `glab auth status`, `az account show`), treat the host as `none` for this session and say so plainly. Never build a parallel auth path.

| Action | `github` | `gitlab` | `azure` |
|---|---|---|---|
| Find open PR for branch | `gh pr list --head <branch> --state open --json number,url` | `glab mr list --source-branch <branch>` | `az repos pr list --source-branch <branch> --status active` |
| Create | `gh pr create --base <target> --head <branch> --title <t> --body-file <f>` | `glab mr create --source-branch <branch> --target-branch <target> --title <t> --description <d>` | `az repos pr create --source-branch <branch> --target-branch <target> --title <t> --description <d>` |
| Update description | `gh pr edit <n> --body-file <f>` | `glab mr update <n> --description <d>` | `az repos pr update --id <n> --description <d>` |
| CI status | `gh pr checks <n>` | `glab ci status --branch <branch>` | `az pipelines runs list --branch refs/pull/<n>/merge --top 5` |

Run these with read-only git around them — P.3 already pushed; never commit or check out inside the PR step.

### Opening the PR (first push of the run)

1. **Existing PR?** Query first. If one is open for this branch → skip to **Updating**.
2. **Ask** (`supervised` only): `Open a pull request? (yes / not yet)`. `not yet`/silence → record `PR status: not opened yet` and stop.
3. **Target** — `integrationBranch`. Verify `origin/<integrationBranch>` exists (`git fetch --prune`); if it's gone, ask the human and write the new value.
4. **Title** — the last commit subject, offered for confirmation (`supervised`) or used as-is (`autopilot`) unless the human gave one.
5. **Body** — features carried (featId + name), their tasks, plan file paths, review verdicts, and any behaviour the human accepted unobserved. Write it to a temp file for `--body-file`.
6. **Never** mark draft unless asked; **never** enable auto-merge — merging stays human.
7. **Record** — `progress.md` → `PR status: opened — PR #<n> → <target> (<url>)`.

### Updating (later pushes)

Later pushes land in the same PR. Regenerate the body to include every feature delivered so far and update it. Record `PR #<n> — feat-001, feat-002 included`. Never open a second PR.

### No host

Push only. Report `pushed (no PR)` and give the branch name so the human can open one. Record `PR status: n/a — no supported host`.

### CI watch (P.7)

Opt-in, after the run's final push, **only when the queue is empty** — never at a checkpoint. Ask `Watch this PR's CI? (yes / no)`; silence = decline.

On yes: poll the host's CI status every 2 minutes (wait portably with `node -e "setTimeout(()=>{},120000)"`), cap 15 minutes. Only judge runs for the current HEAD. Report green, canceled, or failed — **timeout is never green**. On a failure, read the failing job's log and classify:

- **Code-related** (compile error, failing test in touched code, lint) → ask `Fix these CI failures? (yes / not yet)`. **Yes authorizes fix + commit + push** in both modes: fix on the same branch → fast gate → new trailer-less commit → push gate P.1–P.4 (hard rails still bind) → close with `CI fix pushed — evidence: commit <hash>, PR #<n>`. Row evidence is unchanged.
- **Not clearly code-related** (infra, timeout, flaky test outside the change) → say so and suggest a re-run; no fix ask.

Cap: one CI fix loop per delivery. P.7 writes nothing to `progress.md`.

## Reviewer

A **read-only Reviewer subagent** that answers: *does the work do what was asked, observed in the running app, and does it follow the project's conventions?* There are no tests in this harness — the Reviewer is the **only** behaviour check, so it must observe every behavioural criterion, error and edge cases included. It is not a code-quality review: smells and style belong to linters and human PR review.

| | **Rail (step 4)** | **At will** |
|---|---|---|
| Trigger | Automatic, once per feature when all rows are `verified` | The human asks ("review feat-002 against the plan") |
| Scope | The feature being completed — uncommitted | Last committed feature, or the named scope |
| Blocks? | `fail` blocks; unobserved behaviour blocks until accepted | Never |

A bare "review this" is ambiguous — ask whether they mean acceptance, PR state, or defects. **Never spawn the at-will path on your own.**

### Rail invocation

- **Diff** — `git diff HEAD` (all uncommitted work). If the feature already has commits (a remediation from a prior cycle), add `git diff <featureBaseSha>..HEAD`. A clean working tree is not a no-op. Never `git diff <integrationBranch>...HEAD` — it drags in earlier features on the branch.
- **Criteria** — the plan's `## Acceptance criteria` plus every task's Objectives in `## Task specs`; each task's **How to observe** steps tell the Reviewer how to exercise them.
- **On `fail`** — map failing criteria to rows, reopen them (`verified` → `in-progress`), fix, re-run the fast gate, re-run the review for the feature. `autopilot`: show the first `fail` report before remediating. `supervised`: ask `Fix review findings and re-run? (yes / not yet)`. Cap 2 cycles, then `blocked`. **A `fail` is never committed over** — there is no `push anyway` at review.
- **Reviewer wrong?** If the human disagrees with a `fail`, the criterion is what's wrong: update the plan's acceptance criteria or task objectives with the human's explicit agreement, note the change in `progress.md`, and re-run the review. Never edit a criterion on your own to make a review pass.
- **No criteria at all** → nothing can be verified; treat every behaviour as unobserved (below) with the line *"no acceptance criteria available; nothing was verified against"* — never a silent `pass`.

### Unobserved behaviour

When the review returns behavioural criteria as `unconfirmed` (the app would not start, a dependency was unreachable, a criterion could only be checked destructively):

1. **Fix what is in your power first** — missing seed data, an env file documented in the README (copy from `.env.example`), a wrong dev command — then re-run the review. This counts toward the 2-cycle cap. Never point the app at a shared or production environment to make it run.
2. **Still unobserved → hard rail, both modes.** List the unobserved criteria and why, then ask `Behaviour not verified for N criteria — accept and commit anyway? (yes / not yet)`.
3. **`yes`** → `reviewVerdict: unverified-accepted`, and name the criteria in the commit overview and PR description. **`not yet`** / silence → stop; the feature stays `verified`, recorded in `progress.md`. Acceptance is never inferred — not from autopilot, not from earlier approval.
- **Never pass the builder's self-assessment** — no "it works", no `progress.md` claims, no "I fixed it". A reviewer told the answer is no longer checking it.

### Resolve the target (at will)

1. The human named a `feat-NNN`, task ids, or paths → that scope.
2. Otherwise the most recently **committed** feature (all rows `done` with evidence). Say which rule picked it.
3. Nothing committed → ask one short question.

### Spawn

- **If the `workhorse-reviewer` subagent is available** (Workhorse plugin installed), dispatch it — its model is pinned and its editing tools are removed, so read-only is enforced. Otherwise spawn a general subagent on the most capable reasoning model available, with the visible label `Harness Reviewer` (or `Role: harness-reviewer` in the prompt), and state the read-only rule in the prompt.
- **This section is the Reviewer's rulebook.** The subagent reads it from this file itself — don't paste it into the prompt.
- Resumable and self-contained; **capture the subagent ID** and resume it for follow-ups instead of re-spawning.
- **Return early** if it cannot identify criteria — reviewing against guessed criteria produces confident, wrong rows.

Pack into the prompt: repo path, stack, `featId` + title; **the plan path with an instruction to read the whole file** (don't paste it); the exact diff commands; the project's convention sources (`CONTRIBUTING.md`, `docs/`, lint config — or "none found"); **how to run the app** (dev command, URL/port, seed/login steps, and which browser tool to use — the Workhorse plugin's bundled Playwright tools when installed); the instruction to read this file's **Reviewer** section (*Unobserved behaviour*, *Finding rubric*, *Return shape*) and follow it. **No writes** — not code, not commits, not `progress.md`, not even a saved copy of its report.

### Finding rubric

**A row earns its place only if all four hold:**

1. **It changes a decision** — if the engineer would read it and do nothing, drop it.
2. **It is grounded** — `path:line`, verified by reading the file.
3. **It has a concrete failure scenario** — inputs/state → wrong outcome.
4. **It maps to a named source** — an acceptance criterion, a task objective, or a documented convention.

Anything failing one rule is dropped — not downgraded, not rephrased as a suggestion.

**Do not report** what other gates own: lint, formatting, smells, duplication. Convention findings fire only on **touched lines** with a violation still present.

**Caps and shape:**

- ≤ 5 acceptance rows and ≤ 5 convention rows, most severe first; otherwise *"N minor items not listed."*
- **Empty findings is a valid result** — but a clean `pass` still carries the **confirmation trail**: one line per passing criterion with evidence kind and how it was confirmed. Not capped.
- Every `observed` line states **what you did and what you saw** (*"submitted `"   "` → inline error, list unchanged"*). `read` lines cite `file:line`.
- Phrase criteria as **outcomes a user would see**, not code.
- Unconfirmable criteria get an `unconfirmed` row saying **what you searched and what is missing**.
- No generic advice ("consider refactoring", "could be clearer").

**Evidence rule:** reading code can **refute** a behavioural criterion; it can never **confirm** one.

| Criterion kind | Confirmed by |
|---|---|
| **Behavioural** (an observable outcome) | `observed` only — you exercised the running app. Otherwise `unconfirmed` |
| **Structural** (nothing to observe) | `read` — the file is the fact |

**Verdict:** `fail` — a criterion demonstrably not met (observed failing or refuted from code). `gaps` — nothing proven broken but something unconfirmed. `pass` — every criterion confirmed. Unconfirmable ≠ failing — but in this harness a `gaps` with unobserved behavioural criteria still blocks the commit until fixed or accepted, because nothing else will check them.

**`limits[]`** — what the review could not check (app didn't start, no acceptance criteria, no browser tool, only a shared-environment config). Limits are about the review; gaps are about the work.

**Behaviour lane:** start the app locally from its documented dev command and drive it as a user would (via a browser tool for UI — the Workhorse plugin bundles Playwright; direct calls for APIs/CLIs). Drive **every** behavioural criterion, including the error and edge cases in each task's How-to-observe steps. Existing test files, if the project has any, are navigation hints, never evidence. **Development server only.** Read console and network output; a DOM node is not proof an asset loaded. **Time-box ~5 minutes**; if the app won't start, record a limit — never fix anything to make it run. Local only, nothing destructive, no exploratory roaming.

**Budget:** one pass, the feature's diff and touched files, ~40 tool calls (most of them driving the app). No repo-wide crawl. If the criteria won't fit, say which were covered — the rest are unobserved.

**Self-audit before returning:** delete rows missing `path` + `failureScenario` (or `searched`), duplicates, rows other gates own, and bare `observed` claims. Confirm caps, the trail, and `limits[]`.

### Return shape

```text
verdict: pass | gaps | fail
featId: feat-NNN
scope: <paths or summary>
summary: <2–4 sentences of judgment: state of the work, can it ship, where risk sits, what the verdict rests on>
criteriaChecked: <total>/<total>
criteriaClean: <n>
gaps[]: { criterion, kind: behaviour|evidence|convention, severity: blocker|warn, detail, path, failureScenario|searched, fix }
limits[]: <omit when empty>
confirmed[]: { area, criterion, evidence: observed|read, how }
run?: { status: ran|not-run, how?, why? }
droppedMinor?: <count>
```

**Validate before presenting.** If rows lack evidence, exceed caps, contradict the verdict, a behavioural criterion is `observed` while `run.status` is `not-run`, or the trail is missing — **resume the same subagent** with the specific violation. Never render an unvalidated report.

**Present** with fixed sections: `VERDICT` (the summary) → `GAPS` (each with its fix) → `LIMITS` (omit if empty) → `COVERAGE`. On a clean `pass`, replace `GAPS` with the full `CONFIRMED` trail, grouped by area past ~8 lines. The Reviewer writes nothing to `progress.md`; save a report to `.harness/reviews/` only when the human asks.

## Definition of Done

- [ ] `node init.mjs` passes
- [ ] Code reconciled with the project's conventions (step 3)
- [ ] Feature reviewed once (step 4) with every behavioural criterion **observed** — or the unobserved ones explicitly accepted by the human; `reviewVerdict` recorded on every row; no unremediated `fail`
- [ ] Commit landed once per feature — `supervised` after explicit approval; `autopilot` in the same turn
- [ ] `evidence` is exactly `commit <hash>` from `git rev-parse --short HEAD` right after that commit, shared by every row of the feature
- [ ] `status: done` set only after evidence; no yielding while `in-progress`/`verified` outside a sanctioned pause
- [ ] Post-done message sent with exactly one closing line per feature; `progress.md` matches `feature_list.json`
- [ ] Repo restartable from `node init.mjs` on a clean tree; `workhorse-validate` has no tier-1 errors
- [ ] Docs updated in the same feature when user-visible behaviour, setup, or APIs changed

## End of Session

1. Run `node init.mjs` (fast gate)
2. Complete or park active features (`blocked` with notes in `progress.md`); if paused at commit approval, record `Awaiting commit approval for feat-NNN` (not `blocked`)
3. Run `workhorse-validate.mjs --target .` when available; fix tier-1 errors
4. Update `progress.md` — **Blockers**, **Next Step**, and the **Before pushing** sentence if the push gate hasn't run
5. If committed features are unpushed and **no stop is awaiting the human**, push them: `autopilot` runs the push gate; `supervised` asks `Push now?` once for the batch

## Verification Commands

```bash
# Repo baseline (recommended every session)
{{PRIMARY_VERIFICATION_COMMAND}}
```

Commands run by `node init.mjs` (and `./init.sh`):

{{VERIFICATION_COMMANDS}}

## Escalation

- **Architecture / requirements unclear** — consult project docs, else ask the user
- **Repeated check or review failures** — update `progress.md`, flag for human review
- **Scope ambiguity** — re-read the row's plan file; for new work, run Request Triage, or ask

<!-- harness:managed:end -->
