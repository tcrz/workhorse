# Changelog

## 1.0.0 — 2026-10-28

First release of Workhorse, a general-purpose harness plugin for Claude Code and Cursor, derived from an organisation-specific harness skill.

### Plugin

- Ships as a plugin for **Claude Code** (`.claude-plugin/`) and **Cursor** (`.cursor-plugin/`) from one repository, with a Claude Code marketplace manifest.
- Bundles **Playwright MCP** (`@playwright/mcp@0.0.83`, headless, isolated) so the Reviewer can always observe UI behaviour.
- Adds the **`workhorse-reviewer`** and **`workhorse-planner`** subagents with pinned models and editing tools removed (enforced in Claude Code; instruction-level in Cursor). They are thin: their rules live in the harness's `AGENTS.md`, which they read themselves.
- The skill still works standalone from `skills/workhorse/`, falling back to general subagents and a user-connected browser tool.

### UI building

- New **UI build guide** (`templates/ui-build.md`, copied to `.harness/templates/`): every UI feature builds against a design source — design file (Figma via MCP), mockup, existing screen, or **reference research** (study 2–4 products known for the screen type plus platform guidelines, borrow patterns, never branding, recorded in the plan for approval). Covers visual direction for new products, a foundation feature, take-stock-first, a fixed build order, a required look-while-building screenshot loop, and craft and copy rules.
- Plans gain a **UI design** section; overviews gain **Visual direction**. The Reviewer fails missing states and accessibility basics, and reports design departures as warnings.
- Gotcha #42: built a UI from nothing.

### Kept

- Five-subsystem model, scaffolder, validator, upgrader, benchmark, and HTML report.
- Two-phase planning subagent (Resumable Coordinator) with structured elicitation forms.
- Feature delivery: one task at a time, `verified` state, one commit per feature, feature-hash validation.
- Independent Reviewer: once per feature before the commit, plus at-will; evidence rule, finding rubric, `reviewVerdict` trace, `featureBaseSha`.
- Batched push (queue runs off `committed`; checkpoints every 4 features).
- `supervised` / `autopilot` approval modes with hard rails.
- Upgrade-in-place via `harness:managed` markers.

### Changed

- **Task specs live in plan files.** Each `feat-NNN.md` carries a `## Task specs` section — the implementation contract a fresh session works from. Rows no longer need an external tracker id.
- **Commit trailer** is `Tasks: task-001 task-002`.
- **No tests.** The Reviewer is the only behaviour check: it must observe every behavioural criterion, and unobserved behaviour is a hard rail until the human explicitly accepts it (`reviewVerdict: unverified-accepted`), and a failed review can never be committed over — there is no override verdict. Rows no longer carry `verification` or `requiredTests`; task specs carry **How to observe** steps instead of test plans; `init.mjs` runs static checks (fast) and the build (`--build`) only. A `done` feature without a review verdict is now tier-1.
- **Pull requests** use the host CLI derived from the origin remote (`gh`, `glab`, `az repos`) or a `prHost` override; push-only when none is available. Later pushes update the PR description.
- **Branches** follow a configurable `branchPattern` (default `feature/<short-desc>`). `integrationBranch` defaults to the remote default branch and may be `main`.
- **Conventions check** reconciles against the project's own docs and lint config.
- `scoreHarness` instruction checks cover general harness concepts.
- Gotchas renumbered #1–41; added #26 (treating unobserved behaviour as a pass) and #41 (task specs collapsing into boilerplate).

### Removed

- External tracker integration, organisation MCP servers, and the scaffold-time MCP verification flags.
- Static-analysis server review and its coverage gate.
- Documentation-generation gate.
- Usage telemetry, metrics, and cycle feedback.
- Monorepo selective-build commit tags.
- Test layers (`requiredTests`), per-row `verification` commands, and test suites in the quality gate.

### Fixed

- Plan templates are copied into each harnessed repo at `.harness/templates/` (and refreshed on upgrade). The instructions previously pointed at `templates/plan.md`, which only exists inside the skill.
- The plan-file validator now accepts the `featId:` front-matter key that `plan.md` writes (it previously only matched `featureId:`).
