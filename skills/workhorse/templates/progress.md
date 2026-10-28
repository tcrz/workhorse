# Session Progress Log

## Current State

**Last Updated:** YYYY-MM-DD HH:MM
**Approval mode:** [supervised | autopilot] — from feature_list.json approvalMode (see AGENTS.md **Approval mode**)
**Integration branch:** [main | develop | …] — from feature_list.json integrationBranch (feature PR target)
**Active Task:** [task-XXX - Task Name]
**Build/Push status:** [pushed to origin | not pushed — **Before pushing:** <this project's push-gate checks in plain language> will run — <already run on this branch | not run on this branch yet>]
**Quality gate status:** [not run yet | passed (branch <name>) | failed — <which check>]
**PR status:** [not opened yet | opened — PR #<id> → <targetBranch> (<link>) | n/a — no supported host | n/a — not pushed yet]

## Active feature

Only present while a feature's tasks are in flight — see AGENTS.md **Feature delivery**. Remove this section once the feature commits and every task is `done`.

- **Request:** [one-line description of the original ask]
- **featId:** [feat-NNN] — plan: `.harness/plans/feat-NNN.md`
- **Feature base sha:** [hash from atomic start]
- **Commit (pending):** `<type>: <summary>` + trailer `Tasks: task-NNN task-NNN` (see AGENTS.md **Commit message format**)
- **[task-NNN]** [verified|in-progress|not-started|blocked] — [task name]
- **[task-NNN]** [verified|in-progress|not-started|blocked] — [task name]

## Status

### What's Done

- [x] [Completed item 1]

### What's In Progress

- [ ] [Current work item]
  - Details: [specific task]
  - Blockers: [if any]

### What's Next

1. [Next action item]
2. [Following action item]

## Blockers / Risks

- [ ] [Blocker 1]: [description, impact]
- [ ] [Risk 1]: [description, mitigation]

## Decisions Made

- **[Decision 1]**: [description]
  - Context: [why this decision was made]
  - Alternatives considered: [what else was discussed]

## Files Modified This Session

- `path/to/file1.ts` - [brief description of change]

## Evidence of Completion

Use this section for **in-progress** verification notes only. When a feature is `done`, the commit hash belongs in `feature_list.json` → `evidence` (see AGENTS.md **Completing a feature**).

- [ ] Fast gate clean: `[command and output]`
- [ ] Reviewer verdict: `[pass | unverified-accepted (which criteria)]`

## Notes for Next Session

[Free-form notes that will help the next session pick up context]

If commits are not yet pushed, mirror the post-done **Before pushing:** sentence here (project checks in plain language — no script names). After a successful push, keep **PR status** current so the next session knows whether a pull request was opened.
