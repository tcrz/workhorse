# workhorse

A plugin for **Claude Code** and **Cursor** that sets up and audits the harness an AI coding agent works inside — the files and rules that let it start a session, stay in scope, prove its work, and hand off cleanly to the next session.

A harness gives a repository five things:

| Subsystem | What the agent gets |
|---|---|
| **Instructions** | `AGENTS.md` / `CLAUDE.md` — startup path, working rules, definition of done |
| **State** | `feature_list.json`, `progress.md`, `.harness/plans/` — tasks, status, evidence, task specs |
| **Verification** | `node init.mjs` (static checks), an independent Reviewer that observes behaviour, `node init.mjs --build` (build before pushing) — no tests |
| **Scope** | One task at a time, dependencies, feature-level commits |
| **Lifecycle** | Session handoff and an end-of-session routine |

Works with any stack the scaffolder can detect (Node/TypeScript, Python, Go, Rust, Java, .NET) and any git host. Pull requests use `gh`, `glab`, or `az repos` when available, and fall back to push-only.

## What's in the plugin

| Component | Path | Purpose |
|---|---|---|
| Skill | `skills/workhorse/` | Scaffolding, validation, upgrade, and reporting — plus the templates the harness is built from |
| Reviewer subagent | `agents/workhorse-reviewer.md` | Checks each feature against its plan by driving the running app. Uses the session's model; editing tools removed, so read-only is enforced |
| Planner subagent | `agents/workhorse-planner.md` | Clarifies requests and writes plans with task specs. Uses the session's model; no write tools |
| Design skills | `skills/emil-design-eng/`, `skills/shadcn/` | Emil Kowalski's design-engineering skill (polish, interaction, animation) and the official shadcn/ui skill (used only in shadcn projects). Vendored unmodified, pinned in `vendor.json` — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |
| Browser | `.mcp.json` (Claude Code), `mcp.json` (Cursor) | Playwright MCP (`@playwright/mcp@0.0.83`, headless, isolated profile) so the Reviewer can observe UI behaviour |

## Install

Requires Node.js 18+. The browser server downloads on first use via `npx`; it uses your installed Chrome by default — if you don't have Chrome, the Reviewer can install Playwright's browser through the server's `browser_install` tool.

### Claude Code

```bash
claude plugin marketplace add tcrz/workhorse
claude plugin install workhorse@workhorse

# Or try a local clone for one session without installing
claude --plugin-dir /path/to/workhorse
```

Inside a session, `/plugin` manages it.

### Cursor

Cursor reads `.cursor-plugin/plugin.json`, `skills/`, `agents/`, and `mcp.json` from the same repository. For local use, link the repository into Cursor's local plugins directory and restart Cursor:

```bash
git clone https://github.com/tcrz/workhorse.git
ln -s "$PWD/workhorse" ~/.cursor/plugins/local/workhorse
```

To publish, submit the repository at cursor.com/marketplace/publish (plugins must be open source and are reviewed before listing).

Cursor reads only `name` and `description` from subagent files, so the read-only tool restriction applies in Claude Code only. In Cursor the Reviewer's read-only rule is enforced by its instructions, not by the tool list.

### Standalone skill (other agents)

Copy `skills/workhorse/` into your agent's skills directory. Everything works, but you get general subagents instead of the pinned ones, and you need to connect a browser tool yourself — without one, every UI feature stops at the unobserved-behaviour ask.

## Use

Just talk to your agent. Workhorse picks up on what you ask for.

**Set it up once per repo**

> *"Set up Workhorse in this repo"* · *"Create a harness for this repo"*

It asks which approval mode you want, confirms which branch pull requests should target, and writes the harness files.

**Then ask for work as you normally would**

> *"Add a settings page where users can change their email"* · *"Fix the broken date filter on the orders table"*

The harness takes over from there. It asks clarifying questions, shows you a plan to approve, builds feature by feature, has the Reviewer check each one in the running app, and commits, pushes, and opens the pull request. Supervised mode asks you at each step; autopilot doesn't.

**Steer it while it works**

| Say | What happens |
|---|---|
| *"approval mode: autopilot"* (or *supervised*) | Switches mode for this repo |
| *"all"* or *"start with feat-002"* | Picks which features to build first |
| *"yes"* / *"changes requested"* | Approves or rejects a commit (supervised) |
| *"stop after this one"* | Finishes the current feature, then pushes |
| *"review feat-002 against the plan"* | Runs the Reviewer on demand |
| *"more like Linear"* (at plan approval) | Redirects the UI references for a screen |

**Keep the harness healthy**

| Say | What happens |
|---|---|
| *"Audit this repo's harness"* | Scores it across the five subsystems and names the weakest area |
| *"Upgrade this repo's harness"* | Refreshes the instructions to the latest Workhorse without losing tasks, plans, or progress |
| *"Give me a shareable harness report"* | Writes an HTML assessment |

In Claude Code you can also invoke it directly with `/workhorse:workhorse`.

## What the generated harness does

- **Plans before code.** A planning subagent clarifies the request, writes an overall plan for approval, then per-feature plans with acceptance criteria and implementation-ready **task specs**, each with steps to observe it working.
- **Delivers by feature.** Tasks are verified one at a time and committed together — one Conventional Commit per feature, with a `Tasks:` trailer and the commit hash recorded as evidence.
- **Builds UI from a source, never from nothing.** Every screen follows a design file, mockup, or existing screen — or, when there's none, patterns researched from products known for that kind of screen, approved in the plan. A fixed build order and a screenshot loop at desktop and phone width keep it honest.
- **Verifies by observation, not tests.** A read-only Reviewer drives the running app and checks every acceptance criterion before the commit. A failed review is never committed over, and anything it couldn't observe blocks until fixed or explicitly accepted. There is no regression suite — that's the trade-off.
- **Pushes in batches.** Features are committed as they finish; the quality gate and push run at the end of the queue (or every 4 features).
- **Two approval modes.** `supervised` asks before every commit, push, and PR; `autopilot` doesn't. Hard rails — failed quality gate, protected branch, vulnerable dependency, unresolved review failure, unobserved behaviour — apply in both.

## Configuration (`feature_list.json`)

| Key | Default | Purpose |
|---|---|---|
| `approvalMode` | `supervised` | `supervised` or `autopilot` |
| `integrationBranch` | remote default branch | PR target; treated as protected |
| `branchPattern` | `feature/<short-desc>` | Feature branch convention (`<short-desc>`, `<username>`) |
| `prHost` | detected | `github`, `gitlab`, `azure`, or `none` |

Edit the `fast` and `build` lists in the generated `init.mjs` to match the static checks and build your CI runs.

## Develop

```bash
node skills/workhorse/scripts/self-test.mjs
claude plugin validate --strict .
```

The skill's scripts (`skills/workhorse/scripts/workhorse-*.mjs`) are what the agent runs behind the conversation; each takes `--help` if you need to run one by hand.

Keep the two plugin manifests (`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`) and the two MCP files (`.mcp.json`, `mcp.json`) in sync — the self-test checks both.

Vendored skills are never edited in place. To update them, run `node tools/sync-vendored-skills.mjs --update`, review the diff, and commit.

## Credits

Derived from [learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering) (MIT). Bundles [emil-design-eng](https://github.com/emilkowalski/skills) and the [shadcn/ui skill](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn), both MIT — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT — see [LICENSE](LICENSE).
