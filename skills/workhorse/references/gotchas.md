# Gotchas — Harness Engineering Failure Modes

Non-obvious principles that will cause bugs if you violate them.

---

## 1. Memory Index Caps Fire Silently

**Symptom**: Recent memories "disappear" without error.

**Cause**: Index has hard caps (e.g., 200 lines / 25KB) enforced at read time. Long entries (multi-sentence summaries) hit byte cap while staying under line cap.

**Fix**: Keep index entries to one-line hooks. Put detail in topic files.

```markdown
✓ Good: "Use bun, not npm - user preference 2024-01-15"
✗ Bad: "The user prefers bun over npm because it's faster. This was discussed on 2024-01-15 when the user said 'use bun not npm' and I updated the package.json accordingly..."
```

---

## 2. Priority Ordering is Counterintuitive

**Symptom**: Global rule silently overridden by local file.

**Cause**: Local overrides beat project rules, which beat user rules, which beat org rules. If you inject at user level expecting it to dominate, a local override file in project root wins.

**Fix**: Test with full instruction-file stack present:

```bash
# Test priority ordering
cat ~/.claude/CLAUDE.md          # User level
cat ./CLAUDE.md                   # Project level  
cat ./CLAUDE.local.md             # Local override (WINS)
```

---

## 3. Extraction Timing Creates Race Window

**Symptom**: Background extractor writes memory, but user starts next turn before extraction completes.

**Cause**: Extraction fires at end of response. User can send message before extraction finishes.

**Fix**: Coalesce concurrent extraction requests. Advance cursor only after successful run. Failed extraction means those messages reconsidered next time.

---

## 4. Derivable Content Doesn't Belong in Memory

**Symptom**: Memory index fills with architecture details that stale quickly.

**Cause**: Agent saves what's derivable from codebase (architecture, code patterns, version history).

**Fix**: Exclude derivable content by design. Type taxonomy should forbid saving what's in the repo already.

---

## 5. Concurrent Classification is Per-Call, Not Per-Tool

**Symptom**: Tool marked "concurrent-safe" causes race conditions.

**Cause**: Same tool can be safe for some inputs and unsafe for others. Don't assume tool's concurrency behavior is static.

**Fix**: Classify each call at runtime:

```typescript
// Don't do this:
toolRegistry.register('shell', { concurrentSafe: false });

// Do this:
function isCallConcurrentSafe(call: ToolCall): boolean {
  if (call.args.command.startsWith('rm -rf')) return false;
  if (call.args.command.startsWith('cat')) return true;
  // ...runtime classification
}
```

---

## 6. Permission Evaluation Has Side Effects

**Symptom**: Permission check changes behavior on subsequent calls.

**Cause**: Permission evaluator tracks denials, transforms modes, updates state as side effect. Not a pure lookup function.

**Fix**: Don't cache permission results across calls. Re-evaluate each call fresh.

---

## 7. Most Async Work Skips "Pending" State

**Symptom**: UI shows "pending" but work unit never enters that state.

**Cause**: Work units register directly as "running" in practice. "Pending" exists in state machine but rarely used.

**Fix**: Don't build UI that assumes every work unit starts pending.

---

## 8. Fork Children Must Not Fork

**Symptom**: Context cost explodes exponentially.

**Cause**: Recursive forks multiply context: parent + child1 + child2 + grandchildren...

**Fix**: Enforce single-level invariant. Keep fork tool in child's pool (for prompt cache sharing) but block at call time.

---

## 9. Context Builders are Memoized but Manually Invalidated

**Symptom**: Model sees stale data for entire session.

**Cause**: Context builder cached at startup, but mutation doesn't clear cache.

**Fix**: Every mutation point must explicitly clear its corresponding cache:

```typescript
// Example: Cache invalidation at mutation point
async function editFile(path: string, content: string) {
  await writeFile(path, content);
  context.cache.invalidate(`file:${path}`); // MUST invalidate
}
```

---

## 10. Hook Trust is All-or-Nothing

**Symptom**: Entire extension system disabled because one hook untrusted.

**Cause**: If workspace untrusted, all hooks skip — not just suspicious ones.

**Fix**: Design hooks with trust gate at dispatch point. Don't attempt per-hook trust evaluation.

---

## 11. Eviction Requires Notification

**Symptom**: Parent can never read work unit result.

**Cause**: Work unit evicted before parent notified of completion. Race condition: parent tries to read result that's already GC'd.

**Fix**: Two-phase eviction:
1. Clean disk output at terminal state (eager)
2. Clean in-memory record after parent notified (lazy)

---

## 12. Skill Listing Budgets Are Tight

**Symptom**: Skill description truncated, can't trigger properly.

**Cause**: Skill descriptions concatenated and capped per entry (~150 chars). Front-loaded trigger language gets priority.

**Fix**: Front-load distinctive trigger language:

```markdown
✓ Good: "harness-patterns: Memory, permissions, context engineering, multi-agent"
✗ Bad: "A comprehensive skill for understanding and implementing various patterns related to AI agent harnesses and runtime systems..."
```

---

## 13. Default Tool Permission is "Allow"

**Symptom**: Tool bypasses expected gate.

**Cause**: Tools without custom permission logic delegate entirely to rule-based system. Default is "allow" unless configured otherwise.

**Fix**: Override default for sensitive tools:

```typescript
registry.register('shell', {
  defaultPermission: 'ask', // NOT 'allow'
  // ...
});
```

---

## 14. Team Memory Requires Auto-Memory Enabled

**Symptom**: Team-shared memory doesn't work even when configured.

**Cause**: Team memory builds on same directory/index infrastructure as auto-memory. Disabling auto-memory (via env var or settings) also disables team memory.

**Fix**: Ensure auto-memory enabled before enabling team memory. Check both feature gate and enablement check.

---

## 15. Orphaned Topic Files Accumulate

**Symptom**: Disk space fills with `.claude/memory/topics/` files.

**Cause**: Two-step save (topic file then index). Crash between steps leaves orphaned topic file.

**Fix**: Periodic sweep deletes topic files not referenced by index. Orphans don't corrupt index but consume disk space.

---

## 16. Evidence Before Commit Looks Like Done

**Symptom**: A feature is marked or described as complete, but its changes are uncommitted, or `evidence` cites an unrelated hash from `git log`.

**Cause**: The agent saw the feature working and filled `evidence` while still `in-progress`, or copied `HEAD` from startup without committing this feature's files.

**Fix**: Enforce the ordered done ritual in `AGENTS.md`: verify → commit approval → commit → evidence with **only** `commit <hash>` from a fresh `git rev-parse --short HEAD` → validate → `status: done`. Leave `evidence` empty until committed. The validator rejects verbose evidence (`commit hash — lint clean`) and evidence on `in-progress`/`verified` rows.

---

## 17. Charged Ahead on an Ambiguous Request

**Symptom**: The agent built the wrong thing — right code, wrong interpretation of scope or inputs — surfaced only at commit review or later.

**Cause**: Bias-to-action rules ("never wait for a human", "pick sane defaults") outweigh a buried "ask" permission. Or the agent **noted assumptions** instead of asking, self-certified them as "reversible", and took the single-feature fast path — or **inherited the spec** of an adjacent shipped surface (signup after login) without re-clarifying.

**Fix**: Clarification is owned by the planning subagent and runs before any row exists. Deliverable-shaping ambiguity (scope, multiple interpretations, missing critical input, destructive impact) is asked in bundled rounds; only reversible, low-stakes choices get default + note. **Fields, flow, post-action, auth integration, and data contract** are never default + note alone. **Adjacent surface ≠ inherited spec.**

---

## 18. Rows Written Without Showing the Breakdown

**Symptom**: The agent wrote a pile of task rows and started coding without the human seeing what it had decided to build — surprises at commit time, especially on multi-feature requests.

**Cause**: The breakdown was internal-only; triage jumped from planning to rows with no visible checkpoint.

**Fix**: **Show always, approve sometimes.** Present the breakdown (`id`, `name`, one-line `description` per task, grouped by feature) before writing rows. Require explicit approval when N ≥ 2 features, when **unconfirmed assumptions** exist, or when scope is high-stakes.

---

## 19. Noted Assumptions Instead of Asking

**Symptom**: The agent listed assumptions in prose ("assuming UI-only like login") and proceeded straight to rows and code — the human never got to correct the field set, flow, or auth model before work started.

**Cause**: The approval gate only fired when clarification had run. Silently noted defaults plus the N = 1 fast path turned "note assumptions" into a bypass.

**Fix**: Any assumption not explicitly confirmed in this thread is **unconfirmed** and triggers breakdown approval, even for a single feature. List assumptions in the breakdown and wait.

---

## 20. Committed Without Human Approval

**Symptom**: In `supervised` mode the agent committed autonomously, or treated silence / `thanks` / `looks good` / an emoji as approval, or presented the overview and committed in the **same** turn.

**Cause**: "Auto-commit on done" rules ran straight from a passing review to a commit. Even with a gate, fuzzy approval semantics let a model rationalize an ambiguous reply as consent.

**Fix**: A **commit approval gate** with an unstaged working tree, and strict semantics: only an explicit affirmative in a **later** message unblocks; ambiguous replies are re-asked; overview and commit never share a turn in `supervised`; the plain-text ask is the portable contract.

---

## 21. Committed Feature Tasks Individually

**Symptom**: A multi-task feature ends up as N commits and N approval rounds, or a resumed session commits one `verified` task on its own.

**Cause**: Without a durable link between rows, each row looks like an independent delivery.

**Fix**: Every row carries a `featId`. A finished task moves to **`verified`** (no commit) and the agent continues. Only when **every** row of the feature is `verified` does one commit land. The validator rejects half-committed features and hashes shared across features.

---

## 22. Abandoned Feature Blocks All Future Work

**Symptom**: A feature that can't finish leaves rows stuck `in-progress`/`verified`; "one feature open at a time" then blocks every unrelated request.

**Cause**: Completion is all-or-nothing by design, but nothing forced the agent to close out a feature that will never finish.

**Fix**: Move **every** row of the feature to `blocked` with the reason in `progress.md`. Never salvage a lone `verified` row by committing it.

---

## 23. UI Passed Static Checks but Rendered Broken at Runtime

**Symptom**: A UI feature goes green on lint and typecheck, yet the running page is unstyled, broken, or errors in the browser.

**Cause**: Static checks prove code compiles; nothing rendered the app.

**Fix**: The **step-4 feature review** runs the app on a development server and drives it like a user, independently of the builder. Behavioural criteria pass only when **observed**.

---

## 24. Ran a Production Build During Feature Work

**Symptom**: To get a browser check working, or because output looked stale, the agent ran a production build or serve — or `node init.mjs --build` — mid-feature.

**Cause**: Dev-server recovery and the push-gate build weren't distinguished.

**Fix**: Feature work and the Reviewer's behaviour lane use the **development** server only. The production build runs once, inside `node init.mjs --build` at the push gate. A Reviewer whose app won't start records a limit — it doesn't debug.

---

## 25. All Runtime Checks Passed but the Surface Was Still Wrong

**Symptom**: Dev server up, page loaded, zero console or network errors — reported "correct" — yet the page was visibly wrong (distorted logo, wrong layout, missing state).

**Cause**: A clean check bar proves the page was *inspected*, not that it is *correct*.

**Fix**: Judge against **acceptance criteria**. A criterion passes only when its outcome was observed; clean checks are evidence of nothing on their own.

---

## 26. Treated Unobserved Behaviour as a Pass

**Symptom**: The dev server wouldn't start (or a sandbox was unreachable), the Reviewer returned behavioural criteria as `unconfirmed`, and the feature was committed anyway — in autopilot, without anyone being asked. With no tests in the harness, nothing ever checked that behaviour.

**Cause**: "Unconfirmable ≠ failing" was read as "unconfirmable = fine". In a harness with tests that is survivable; here the Reviewer is the only behaviour check.

**Fix**: Unobserved behaviour is a **hard rail in both modes**. Fix what is in reach (seed data, a documented env file, the dev command) and re-run; otherwise list the unobserved criteria and ask the human to accept explicitly. Acceptance is recorded as `reviewVerdict: unverified-accepted` and named in the commit overview and PR. The validator rejects `gaps` as a committed verdict and a `done` feature with no verdict.

---

## 27. Passed a Media Criterion From DOM Presence While the Asset 404'd

**Symptom**: A logo or image criterion was marked `pass` because the accessibility tree listed the image, while the network log showed the asset returning 404.

**Cause**: Frameworks render `<img>` with its `alt` even when `src` fails. "Element in tree" was conflated with "asset loaded".

**Fix**: Always read network and console output when driving a UI. Media criteria need **load proof**: the asset request returned `200` **and** `img.complete && naturalWidth > 0`.

---

## 28. Post-Done Message Used the Wrong Hash or a Vague Push Ask

**Symptom**: Two different hashes in one report, a closing line per task instead of per feature, or "run `init.mjs --build`" instead of a plain sentence about what will run.

**Cause**: The hash came from startup `git log` or an earlier turn; the push offer reused generic harness wording.

**Fix**: One `git rev-parse --short HEAD` immediately after the commit — the same hash everywhere. The body carries a **Before pushing** sentence naming this project's checks in plain language, then `Push now? (yes / not yet)`. One closing line per feature.

---

## 29. Pushed After a Failed Quality Gate, or Conflated Commit Approval With Push

**Symptom**: `node init.mjs --build` failed and the agent pushed anyway — or the human said `commit and push` at commit approval and the agent treated that as consent to skip a later failure.

**Cause**: Commit approval and push consent were merged; a failed gate was treated as "report and continue".

**Fix**: **Commit approval ≠ push consent.** A non-zero quality gate **aborts** the push gate. Only an explicit **`push anyway`** in a later message overrides — never inferred from earlier wording.

---

## 30. Quality Gate Run From a Subdirectory

**Symptom**: `node init.mjs` fails to find packages or config even though the repo layout is correct.

**Cause**: The agent's shell was in a subdirectory, and the runner inherited that cwd.

**Fix**: The generated `init.mjs` `chdir`s to its own directory before running anything. Re-scaffold or upgrade older runners.

---

## 31. Resumed a Row From Its One-Line Description

**Symptom**: A fresh session implemented an existing row from its one-sentence `description` — wrong files, missed acceptance conditions, re-asked questions triage already answered.

**Cause**: Rows are deliberately lean; the implementation contract lives in the plan's **Task specs**. The authoring session had it in context; a fresh one didn't.

**Fix**: Before implementing any row you didn't author this session, read its `planFile`. The validator warns when a plan has no `## Task specs` section.

---

## 32. Autopilot Over-Reached — Bypassed a Hard Rail or Relaxed Planning

**Symptom**: In `autopilot`, the agent pushed after a failed quality gate, pushed a protected branch, added a dependency with a known critical vulnerability, or skipped plan approval because "autopilot means no asking".

**Cause**: `autopilot` was read as "no gates". It removes only the delivery asks (commit, push, PR) and the where-to-start ask.

**Fix**: Hard rails and the planning gates (plan approval, breakdown approval) never relax in any mode. `push anyway` is never inferred from the mode.

---

## 33. Used `workhorse-create --force` to Update a Live Harness and Lost Task State

**Symptom**: After `workhorse-create.mjs --force` on a live repo, `feature_list.json` was back to a placeholder — real tasks, evidence, and `progress.md` history gone.

**Cause**: `--force` is a destructive re-scaffold, not an update.

**Fix**: Use **`workhorse-upgrade.mjs`**: plan mode, then `--apply`. It refreshes only the `harness:managed` block and merges missing config keys; tasks, progress, plans, `init.mjs`, and content outside the markers are preserved.

---

## 34. Stopped After the First Feature and Asked "Say Continue"

**Symptom**: A multi-feature run delivers `feat-001`, then yields with "say continue and I'll do the rest" while later rows sit `not-started`.

**Cause**: "Where to start" was read as "the request ends after this feature".

**Fix**: Where-to-start only picks the **first** active feature. The rest are the queue. After each feature is **committed**, autopilot and supervised-`all` start the next one — never invent a continue gate.

---

## 35. Skipped the PR Step or Opened a PR Without Consent

**Symptom**: After pushing, the agent stopped without the PR offer — or, in `supervised`, opened one without asking — or ran the host CLI before the push succeeded.

**Cause**: PR creation was treated as implicit follow-up to push.

**Fix**: After a successful push, check for an existing PR, then ask `Open a pull request? (yes / not yet)` in `supervised` (autopilot opens it). Never enable auto-merge. If the host CLI is missing or unauthenticated, say so plainly and report `pushed (no PR)` — never build a parallel auth path.

---

## 36. Later Features Missing From the Shared PR

**Symptom**: In a multi-feature run, the first push opened the PR and later pushes landed in it — but its description still listed only the first feature.

**Cause**: The PR body was written once, at creation.

**Fix**: On every later push, regenerate the description from every feature delivered so far and update the PR. Never open a second PR for the same branch.

---

## 37. Mis-handled the CI Watch

**Symptom**: The watch ask appeared mid-queue and stalled a run; the agent polled without asking; it judged the previous push's run; an infra failure got a speculative "fix" commit; logs were dumped into chat.

**Cause**: The watch is a post-delivery soft-ask, easy to misplace, and a fresh push takes time to queue.

**Fix**: Ask only when the queue is empty; silence is decline. Judge only runs for the current HEAD. Timeout is never green. Offer a fix only for code-related failures, cap one fix loop per delivery, and summarise logs instead of pasting them.

---

## 38. The Reviewer Became a Gate, or Became Noise

**Symptom**: **(a) Gate creep** — the agent spawned the Reviewer before every commit "to be safe". **(b) Noise** — 18 rows restating lint and style, plus ungrounded guesses with no file, line, or scenario. **(c) The unfalsifiable pass** — a bare `pass` with nothing to check.

**Cause**: The plumbing was specified but the **output contract** was not.

**Fix**: The at-will path runs only on request; the rail runs once per feature and only an acceptance/behaviour `fail` blocks. Every row passes the four-part bar (changes a decision, grounded at `path:line`, concrete failure scenario, named source) or is dropped. ≤ 5 rows per lane. **Findings are capped; evidence is not** — every passing criterion gets a confirmation line.

---

## 39. Skipped the Feature Review Because It Sat Outside the Delivery Shape

**Symptom**: A feature went `verified` → commit → push with no review. Asked why, the agent said it "rushed the autopilot path".

**Cause**: Placement, not discipline. Delivery is executed as a memorised shape (commit → push → PR), and a blocking step that is neither in that shape nor detectable afterwards is a convention, not a rail.

**Fix**: The review is step 4 of **Completing a feature**, before the commit, and on the **Definition of Done**. It leaves a trace — `reviewVerdict` on every row — and the validator fails a `done` feature that has none. General principle: **when you add a blocking step, put it in the sequence that gets executed and give it a trace that survives the turn.**

---

## 40. Pushed After Every Feature — or Stranded Committed Work

**Symptom**: **(a)** A four-feature run paid for four full push gates and four CI runs on states nobody merges. **(b)** Once pushing moved to the end, the session ended with finished features left on one machine — or the agent pushed after a **blocked** feature without asking.

**Cause**: The queue was keyed off `delivered`, so the only way to start the next feature was to push the current one.

**Fix**: **The queue runs off `committed`.** Pushes happen at push-gate invocations: queue empty, "stop after this one", every `BATCH_CHECKPOINT_FEATURES` (4) features, or session end with no stop awaiting the human. A blocked feature or hard rail **stops, reports, and asks** — never pushes on its own.

---

## 41. Task Specs Collapsed Into Boilerplate After the First Few Features

**Symptom**: The first features' task specs were bespoke; later ones repeated the same Summary sentence with the title swapped in, `Deliver: <title fragment>` objectives, a "see the plan" pointer, and layer-mismatched lines (migration language on a pure util task).

**Cause**: Authoring dozens of dense contracts in one trailing pass exhausts sustained attention; the model falls back to a fill-in template.

**Fix**: Author specs **feature by feature**, as each plan is written. The main agent runs the **self-audit gate** — cross-task dedup, no pointer, no title-echo, no layer-mismatch — across all features, and **resumes the planning subagent** to re-author any feature that drifts. Never patch drift with more boilerplate.

---

## Related Reading

- [Memory Persistence Pattern](memory-persistence-pattern.md) — Gotchas #1, #3, #4, #15
- [Tool Registry Pattern](tool-registry-pattern.md) — Gotchas #5, #6, #13
- [Multi-agent Pattern](multi-agent-pattern.md) — Gotchas #8, #11, #38, #41
- [Context Engineering Pattern](context-engineering-pattern.md) — Gotchas #9
- [Lifecycle Pattern](lifecycle-bootstrap-pattern.md) — Gotchas #10, #14, #31, #33
