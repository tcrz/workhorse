---
name: workhorse
description: >-
  Workhorse sets up and audits the harness a coding agent works inside: AGENTS.md/CLAUDE.md,
  feature state and plans, reviewer-gated verification, scope boundaries, batched delivery
  and pull requests, lifecycle handoff, memory persistence, context control, tool safety,
  and multi-agent coordination.
license: MIT
---

# Workhorse

Use this skill to set up a repository so coding agents can start reliably, stay in scope, prove their work, and resume across sessions — a harness the agent works inside. Keep the harness small enough that agents actually follow it.

Not for model selection, prompt tuning in isolation, chat UI design, or general app architecture.

## Core Model

Every useful coding-agent harness has five subsystems:

| Subsystem | Minimal artifact | Purpose |
|---|---|---|
| Instructions | `AGENTS.md` or `CLAUDE.md` | Startup path, working rules, definition of done |
| State | `feature_list.json`, `progress.md`, `.harness/plans/` | Tasks grouped by feature, status, evidence, task specs, next step |
| Verification | `node init.mjs` (static checks) per task, the Reviewer observing behaviour once per feature, `node init.mjs --build` (build) at the push gate — no tests | Repo health, behaviour, and push gates |
| Scope | Task dependencies and done criteria | Prevents overreach and half-finished work |
| Lifecycle | `session-handoff.md`, end-of-session routine | Makes the next session restartable |

## Plugin or standalone

Workhorse ships as a plugin for **Claude Code** and **Cursor**, and the plugin adds three things this skill relies on:

- a bundled **Playwright browser** MCP server, so the Reviewer can observe UI behaviour;
- the **`workhorse-reviewer`** subagent — editing tools removed, so read-only is enforced;
- the **`workhorse-planner`** subagent — no write tools.

Used standalone (this folder copied into a skills directory), everything still works, but the generated harness falls back to general subagents, and you must connect a browser tool yourself. Script paths below are relative to this skill's directory.

## First Move

1. Inspect what already exists: instruction files, feature/state files, verification commands, docs, package manifests, git remote.
2. Ask only for missing context that cannot be inferred safely: target agent file name, approval mode, tolerance for structure, and whether overwriting is allowed.
3. Prefer a minimal harness first. Add memory, tool safety, multi-agent, or benchmark details only when the user's problem calls for them.

## Common Tasks

### Create a harness

1. **Ask the approval mode** — a single-select question, recommended option first:
   - "**Supervised**: Require human approval for every commit, push, and pull request" (Recommended for a first harness) → `supervised`
   - "**Autopilot**: Commit after verification, push at batch checkpoints, and open the PR automatically" → `autopilot`

   Hard rails and plan/breakdown approval apply in both modes.
2. **Confirm the PR target** — default is the remote's default branch (`origin/HEAD`). Mention it and accept an override (e.g. `develop`).
3. **Run the scaffolder:**

```bash
node scripts/workhorse-create.mjs --target /path/to/project --approval-mode supervised
```

Options:

- `--integration-branch <name>` — PR target (default: `origin/HEAD`, else `main`).
- `--branch-pattern "<pattern>"` — feature branch convention (default `feature/<short-desc>`; placeholders `<short-desc>`, `<username>`).
- `--pr-host github|gitlab|azure|none` — override PR host detection (default: derived from the origin remote at runtime).
- `--ui-library none|shadcn|hand-built|<name>` — component library for UI work. Default: the one the project already uses, else `none` — no library yet, so the planner asks at the first UI work, recommending the shadcn flavour for the stack. `hand-built` opts out.
- `--agent-file CLAUDE.md` for Claude-oriented projects.
- `--package-manager npm|pnpm|yarn|bun` when detection is wrong.
- `--commands "cmd one,cmd two"` for custom static checks and builds. Commands that look like builds run only under `--build`.
- `--force` only after confirming overwrites are acceptable — it resets `feature_list.json` and `progress.md`. Use **Upgrade** for live harnesses.

4. **Check for a browser tool.** The Reviewer can only observe UI behaviour through one. With the Workhorse plugin, the bundled Playwright server provides it — nothing to say. Standalone, confirm one is connected (Playwright MCP, Chrome DevTools MCP).
5. **Check `init.mjs` yourself** — its `fast` (static checks) and `build` lists should match the project's scripts and CI. Edit them directly if detection missed something. Ask only if you genuinely can't tell.
6. **Validate** — `node scripts/workhorse-validate.mjs --target /path/to/project`. Fix anything tier-1 before finishing.
7. **Finish with one short message**, in this shape:

   > Workhorse is set up — supervised mode, pull requests target `main`. What would you like to build?

   That's the whole message. Don't recap the files created, explain how the harness works, describe trade-offs, or ask about committing — the harness files are committed automatically with the first feature. Add a sentence only for something that needs the user: validation still failing, or a UI project with no browser tool available.

`feature_list.json` ships with `approvalMode`, `integrationBranch`, `branchPattern`, `uiLibrary`, and one placeholder task — the agent replaces it with real tasks as work arrives; humans prompt in natural language.

### Request triage

On implementation requests, the agent **must** update `feature_list.json` before editing application source. The canonical order, all completed before any code:

**Feature branch → planning subagent (clarification + plans + task specs) → save plans → present breakdown → self-audit task specs → write rows → where to start → implement.**

- **Planning subagent (two phases).** Phase 1 writes `.harness/plans/overview.md` for approval. Phase 2 writes `.harness/plans/feat-NNN.md` per feature — acceptance criteria, flow, files to touch, behaviour checks, and **task specs** with **How to observe** steps (the implementation contract a fresh session works from). Resumable Coordinator pattern: the subagent returns early with an `elicitationForm` whenever it hits an unknown; the main agent collects every answer and resumes the same subagent once. See [Multi-Agent Coordination](references/multi-agent-pattern.md).
- **Task specs live in plans, not in a tracker.** Rows stay lean (`name`, one-line `description`, `featId`, `planFile`). The self-audit gate catches boilerplate drift (cross-task dedup, no pointers, no title-echo, no layer-mismatch) and resumes the subagent to re-author.
- **Show always, approve sometimes.** The breakdown is always shown; explicit approval is required for N ≥ 2 features, unconfirmed assumptions, or high-stakes scope.
- **Feature branch before code.** The branch must match `branchPattern` and never be a protected branch (`main`, `master`, `integrationBranch`).

### Building UI

The harness can't define what every UI should look like, so it defines how to decide. Every UI feature builds against a **design source** — a design file (Figma via MCP when connected), a mockup, an existing screen, or **reference research**: the planner names the screen type, studies 2–4 products known for it plus platform guidelines, and records the borrowed patterns in the plan for approval. New products get one visual-direction question and a foundation feature first. Screens are composed from the component library in `uiLibrary` — never hand-built where the library has the component. An existing library is detected and kept. With none yet, the planner asks once, as its own question, recommending the shadcn flavour for the stack (shadcn/ui, shadcn-vue, shadcn-svelte, spartan/ui, shadcn-solid, Basecoat); the user can opt out (`hand-built`). Builders follow a fixed build order and a required screenshot loop at desktop and phone width. All of it lives in `templates/ui-build.md`, copied into each repo at `.harness/templates/ui-build.md`.

### Feature delivery

Tasks sharing a `featId` are implemented and verified one at a time (each moves to `verified`), then **one independent feature review** runs, then **one commit** lands for the whole feature. Commit messages follow Conventional Commits with a `Tasks: task-001 task-002` trailer. The validator rejects half-committed features.

**Batched push.** The queue runs off `committed`, not `delivered`: a multi-feature run commits each feature and keeps going, and pushes at **push-gate invocations** — queue empty, "stop after this one", every 4 features, or session end. A blocked feature stops, reports, and asks before any push.

### Verification model

**The harness writes and runs no tests.** Three layers:

1. **Fast gate** — `node init.mjs`: install + static checks (lint/typecheck). Startup and per task. Cross-platform; `./init.sh` wraps it.
2. **Behaviour** — the Reviewer observes every behavioural criterion in the running app, once per feature (see below).
3. **Quality gate** — `node init.mjs --build`: fast gate + build. Push gate only. A non-zero exit aborts the push; only an explicit later `push anyway` overrides.

Trade-off (documented in the README, not something to announce): there is no regression suite, so a later feature can break an earlier one unnoticed until a human or the project's own CI catches it. If the project's CI runs tests, the optional CI watch after a push surfaces those failures.

**Evidence** on a `done` row is exactly `commit <hash>` — from `git rev-parse --short HEAD` immediately after the feature commit, shared by every row of the feature. Nothing after the hash.

### Independent review

A read-only **Reviewer** subagent is the harness's **only** behaviour check. It runs automatically once per feature (step 4, before the commit) and on request. It checks the work against the plan's acceptance criteria, task objectives, and the project's own conventions, and drives the running app on a dev server to **observe** every behavioural criterion, error paths included — reading code can refute a criterion but never confirm one. A `fail` blocks and is never committed over — it is fixed (cap 2 cycles), the criterion is corrected with the human's agreement, or the feature goes `blocked`. **Unobserved behaviour blocks too**, in both modes, until it is fixed or the human explicitly accepts it. It leaves a trace — `reviewVerdict` (`pass` or `unverified-accepted`) on every row — and the validator fails a `done` feature without one.

### Pull request

After a successful push, the agent opens (or updates) a PR using the host CLI matching the origin remote — `gh` (GitHub), `glab` (GitLab), `az repos` (Azure DevOps) — or the `prHost` override. No supported host or no authenticated CLI → push only, reported as `pushed (no PR)`. Later pushes update the same PR's description. Optional CI watch after the final push, with one consented fix loop for code-related failures.

### Approval mode

`approvalMode` in `feature_list.json` (`supervised` default, or `autopilot`) controls the commit, push, and PR asks and the where-to-start ask. It never relaxes plan/breakdown approval or the **hard rails**: a failed quality gate, a protected branch, a dependency with a known high/critical vulnerability and no safe version, an unremediated review `fail`, unobserved behaviour the human hasn't accepted, or unresolved ambiguity. The human can switch modes in natural language; the agent persists the change.

### Audit an existing harness

```bash
node scripts/workhorse-validate.mjs --target /path/to/project
```

Report the five subsystem scores, the lowest-scoring area, and the first 2–3 changes that would improve reliability. Include tier-1 structural errors and warnings — they fail the run even when the overall score looks high. Exit code 1 means structural checks failed or the score is below `--min-score`.

### Upgrade an existing harness

For a live repo whose harness should move to the current skill version **without** losing tasks, plans, or progress (not `workhorse-create --force`):

1. **Plan** — `node scripts/workhorse-upgrade.mjs --target /path/to/project` (add `--json` for structured output). No writes. Summarize it — especially any warning about edits **inside** `<!-- harness:managed:start -->` … `<!-- harness:managed:end -->`, which is skill-owned and replaced. Content outside the markers is preserved.
2. **Apply** — an explicit upgrade request is consent; in the same turn run `node scripts/workhorse-upgrade.mjs --target /path/to/project --apply`. It refreshes the managed block, merges missing `approvalMode` / `branchPattern` / `integrationBranch` (from `--integration-branch`, else `origin/HEAD`), writes `.harness/manifest.json`, and re-validates.

### Produce a report

```bash
node scripts/workhorse-report.mjs --target /path/to/project
node scripts/workhorse-benchmark.mjs --target /path/to/project --html /path/to/report.html
```

This is a structural benchmark. Real effectiveness still needs before/after agent sessions on representative tasks.

## When to Read References

Load only the reference needed for the user's problem:

- Memory across sessions: [Memory Persistence](references/memory-persistence-pattern.md)
- Reusable workflows as skills: [Skill Runtime](references/skill-runtime-pattern.md)
- Permissions, tools, concurrency: [Tool Registry & Safety](references/tool-registry-pattern.md)
- Context budget and progressive disclosure: [Context Engineering](references/context-engineering-pattern.md)
- Delegation and parallel agents (including the planning subagent's Coordinator pattern): [Multi-Agent Coordination](references/multi-agent-pattern.md)
- Hooks, startup, long-running work: [Lifecycle & Bootstrap](references/lifecycle-bootstrap-pattern.md)
- Non-obvious failure modes: [Gotchas](references/gotchas.md)
- Change history: [CHANGELOG.md](CHANGELOG.md)

## Design Rules

- Keep the root instruction file focused: routing and invariants, not a full manual.
- Clarify deliverable-shaping ambiguity through the planning subagent; default-and-note only reversible, low-stakes choices; unconfirmed assumptions require breakdown approval; adjacent surfaces don't inherit prior spec.
- Put project facts in project docs, not in the skill.
- Make static-check and build commands explicit and runnable; make every behavioural objective observable.
- Require commit + evidence before marking a task done.
- Forbid yielding on `in-progress`: an implementation request ends only at `done` or `blocked` (or a sanctioned pause).
- Use one active task unless the harness has explicit multi-agent ownership boundaries.
- Prefer append/update state files over relying on chat history.
- Never hide destructive behavior in scripts; overwrites require explicit user approval.

## Deliverable Checklist

For a usable minimal harness, leave the target project with:

- [ ] `AGENTS.md` or `CLAUDE.md`
- [ ] `feature_list.json` with `approvalMode`, `integrationBranch`, `branchPattern`
- [ ] `.harness/plans/` directory
- [ ] `progress.md`
- [ ] `node init.mjs` runs the static checks and `node init.mjs --build` the build (with `./init.sh` wrapper), matching what CI runs
- [ ] `workhorse-validate.mjs` passes with no tier-1 errors
- [ ] Optional `session-handoff.md` for multi-session work

If you cannot create files, provide exact file contents and commands instead.
