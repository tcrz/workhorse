# Changelog

Every change that should reach installed users gets a version bump here and in `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, and `skills/workhorse/metadata.json` — Claude Code keeps users on a pinned version until it changes. The self-test fails when they disagree.

## 1.1.0 — 2026-10-28

### UI building

- New **UI build guide** (`templates/ui-build.md`, copied to `.harness/templates/`): every UI feature builds against a design source — design file (Figma via MCP), mockup, existing screen, or **reference research** (study 2–4 products known for the screen type plus platform guidelines, borrow patterns, never branding, recorded in the plan for approval). Covers visual direction for new products, a foundation feature, take-stock-first, a fixed build order, a required look-while-building screenshot loop, and craft and copy rules.
- Plans gain a **UI design** section; overviews gain **Visual direction**. The Reviewer fails missing states and accessibility basics.
- **Component library by default:** new `uiLibrary` setting (`--ui-library`). Defaults to `shadcn` — the shadcn flavour for the stack: shadcn/ui, shadcn-vue, shadcn-svelte, spartan/ui, shadcn-solid, or Basecoat — and never hand-builds what the library ships. An existing library (MUI, Chakra, …) is detected and kept; `none` opts out. Upgrades merge a missing `uiLibrary`.
- **Working from a design:** an approved Figma or mockup is binding on structure and flexible on pixels. Precedence is accessibility, then the design, then the design system, then craft rules and the design pass (gap-filling only). The planner turns the design's structure into acceptance criteria, so structural departures fail review; cosmetic ones warn. Deliberate departures are recorded in the plan. Figma via MCP feeds tokens and screenshot comparison; a Figma link without the MCP means ask, never guess.
- **Design gaps:** what the design doesn't show is listed under **Design gaps** at plan approval and filled with behaviour, never new content; big gaps are asked about first; with a design, the design pass stays functional; accessibility changes to the design are named in the commit overview and PR.
- Bundles two design skills, vendored unmodified and pinned by commit in `vendor.json`: **`emil-design-eng`** (Emil Kowalski — polish, interaction, animation) and the official **`shadcn`** skill. `tools/sync-vendored-skills.mjs` updates them; licenses and notes in `THIRD_PARTY_NOTICES.md`.
- Both bundled skills are explicit parts of every UI task (step 1 of Completing a feature), and each UI task leaves a `progress.md` trace line saying which library components were used and whether the design pass ran.
- Gotchas #42 (built a UI from nothing), #43 (hand-built components a library ships), #44 ("improved" an approved design).

### Changed

- Harness setup ends with a one-line handoff — *"Workhorse is set up — supervised mode, pull requests target `main`. What would you like to build?"* — instead of a recap. The agent checks `init.mjs` itself, and the harness files are committed automatically as the first commit on the first feature branch.
- The `workhorse-reviewer` and `workhorse-planner` subagents inherit the session's model instead of pinning Opus.
- The README describes Workhorse by what to say to the agent, not which scripts to run.

## 1.0.0 — 2026-10-28

First release. Workhorse is a plugin for Claude Code and Cursor that sets up and audits the harness a coding agent works inside.

### Plugin

- Installs in **Claude Code** (`.claude-plugin/`, with a marketplace manifest) and **Cursor** (`.cursor-plugin/`) from one repository. The skill also works standalone from `skills/workhorse/`.
- Bundles **Playwright MCP** (`@playwright/mcp@0.0.83`, headless, isolated profile) so the Reviewer can observe UI behaviour.
- **`workhorse-planner`** and **`workhorse-reviewer`** subagents with editing tools removed, so they can't change code (enforced in Claude Code; instruction-level in Cursor). Their rules live in the harness's `AGENTS.md`, which they read themselves.

### The harness

- **Setup** writes `AGENTS.md` (or `CLAUDE.md`), `feature_list.json`, `progress.md`, `session-handoff.md`, `init.mjs`/`init.sh`, and `.harness/` with plan templates. Settings: `approvalMode`, `integrationBranch`, `branchPattern`, optional `prHost`.
- **Planning before code:** a two-phase planning subagent clarifies the request with structured questions, writes an overall plan for approval, then per-feature plans with acceptance criteria and **task specs** — the implementation contract a fresh session works from, with **How to observe** steps.
- **Feature delivery:** one task at a time, then one Conventional Commit per feature with a `Tasks:` trailer and the commit hash recorded as evidence.
- **Verification without tests:** `node init.mjs` runs static checks per task and `node init.mjs --build` runs the build before pushing. The **Reviewer** is the behaviour check: it drives the running app against the acceptance criteria before each commit. A failed review is never committed over; behaviour it couldn't observe blocks until fixed or explicitly accepted. Every committed feature records a `reviewVerdict`.
- **Batched push:** features are committed as they finish and pushed at the end of the queue, every 4 features, or on request.
- **Pull requests** through `gh`, `glab`, or `az repos`, detected from the git remote; push-only when none is available.
- **Approval modes:** `supervised` asks before every commit, push, and PR; `autopilot` doesn't. Hard rails apply in both: a failed quality gate, a protected branch, a vulnerable dependency, an unresolved review failure, or behaviour nobody verified.
- **Keeping it healthy:** validation scores a harness across instructions, state, verification, scope, and lifecycle; upgrades refresh the instructions inside `harness:managed` markers without losing tasks, plans, or progress; a benchmark produces a shareable HTML report.
- **References** on memory, context, tool safety, multi-agent coordination, lifecycle, and 41 documented failure modes ("gotchas").

Derived from [learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering) (MIT).
