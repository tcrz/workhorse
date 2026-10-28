# Third-party notices

Workhorse bundles the following third-party skills, unmodified, under their own licenses. Each one's full license text sits next to it (`skills/<name>/LICENSE`), and `skills/<name>/VENDORED.md` records the exact upstream commit. Pins live in `vendor.json`; update them with `node tools/sync-vendored-skills.mjs --update` and review the diff.

| Skill | Upstream | License |
|---|---|---|
| `emil-design-eng` | [emilkowalski/skills](https://github.com/emilkowalski/skills) — `skills/emil-design-eng` | MIT — Copyright (c) 2026 Emil Kowalski |
| `shadcn` | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) — `skills/shadcn` | MIT — Copyright (c) 2023 shadcn |

**Note on the `shadcn` skill:** when it activates (only in projects with a `components.json`), it runs `npx shadcn@latest info --json` to load project context, and it pre-approves the `shadcn@latest` CLI through `allowed-tools`. That CLI is fetched from npm at its latest version, not pinned by Workhorse.

Workhorse itself is derived from [learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering) — MIT, Copyright (c) 2025 WalkingLab.
