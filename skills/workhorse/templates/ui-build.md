# UI build guide

<!-- Managed by Workhorse: refreshed on every harness upgrade. Put repo-specific UI notes in AGENTS.md outside the harness:managed markers, not here. -->

Read this for any feature that adds or changes a user-facing screen: at planning, and again before implementing a UI task. We can't define what every UI should look like — so this guide defines **how to decide** what it should look like, and **how to build it**.

## 1. Find the design source

Before designing anything, find what the screen should be built from. Use the first that exists:

1. **A design file.** A Figma link (or similar) from the human — see *Working from a design* below.
2. **A mockup or screenshot** the human provides.
3. **An existing screen in this app** that does something similar. Match it — a new screen should feel like the rest of the product.
4. **Reference research** — when there is nothing to follow (see below).

Record the source in the feature plan's **UI design** section. The builder builds against it and the Reviewer reviews against it.

### Working from a design

An **approved design** — a Figma file or mockup the human has signed off — is binding on **structure** and flexible on **pixels**.

**Precedence.** When rules disagree, the higher one wins:

1. Accessibility basics — keyboard access, labels, focus, WCAG AA contrast
2. The design source
3. The project's design system and component library
4. This guide's craft and copy rules, and the `emil-design-eng` design pass — these only apply to **gaps** (below). Never "fix" something the design specifies.

**How firm the source is decides what a departure costs:**

| Design source | Structural departure | Cosmetic departure |
|---|---|---|
| Approved design file or mockup | `fail` | `warn` |
| An existing screen to match | `warn` | `warn` |
| Reference research | `warn` | `warn` |

A **structural** departure means the screen is built differently: a section missing, elements in a different place or order, a different kind of component (tabs designed, dropdown built), content missing or added, a different flow. A **cosmetic** departure means it's built the same way but looks slightly off: spacing, shade, weight, radius, a near-match icon.

**Structure becomes acceptance criteria.** With an approved design, the planner writes its structural elements into the feature's acceptance criteria — *"a stats row with four KPIs sits above the orders table"*, *"selecting an order opens a side panel, not a page"* — so the Reviewer holds the build to them, and the human sees exactly what's binding at plan approval.

**Deliberate departures go on record.** When the design can't or shouldn't be followed exactly, list it under **Design departures** in the plan with the reason. Accessibility conflicts (text that fails contrast, a target too small) are fixed without asking, but never silently: name each one in the commit overview and the pull request description, with the before and after (*"table metadata colour raised from #9CA3AF to #6B7280 for AA contrast"*). Anything else needs the human's approval first. A recorded, approved departure isn't a finding.

**Figma.**
- With a **Figma MCP** connected: fetch the frames and the design's variables. Put the variables into the theme tokens, map each element to a `uiLibrary` component, and in the screenshot loop compare a screenshot of the frame with the build at the same width.
- With a Figma **link but no MCP**: stop and ask the human to connect Figma or share exported frames. Never guess at a design you can't see.
- If the design is built on a **code-backed design system** (MUI, a company library, Code Connect mappings), raise it as a choice against `uiLibrary` instead of defaulting to shadcn.

**Fidelity over purity.** When matching the design needs more than theme tokens and variants, modify the library component in place and note why in the plan.

**Gaps: decide behaviour, add nothing.** A design is a set of pictures of particular moments; a working screen has to behave in all of them. A **gap** is something the design doesn't show but the screen can't avoid — hover, press and focus feedback; loading, empty, error, and partial states; validation errors; a phone layout when only desktop was designed; content much longer than the mockup's. Left undecided, the code still does *something* — usually no feedback, a blank screen, or a raw error. So gaps get decided, in the design's own visual language.

A gap is **not** licence to add. A section, button, banner, decorative element, or content the design doesn't have is a structural departure, whatever the reason.

- **List the gaps in the plan.** The planner writes them under **Design gaps** in the UI design section, each with how it'll be handled — so the human sees them at plan approval and can redirect (*"use the design system's empty state"*, *"I'll get the mobile frames"*).
- **Ask before improvising a big gap** — a whole phone layout, an entire screen or flow the design lacks. Ask whether a design is coming before inventing one.
- **Keep the design pass functional.** With a design source, `emil-design-eng` adds only motion and feedback that help the user understand what happened — a press state, a panel sliding from the side it opens on, a short fade between states. No decorative motion, and nothing that changes the design's character.

### Reference research (no design to follow)

1. **Name the screen type** in product terms: *"B2B billing settings"*, *"mobile onboarding"*, *"data table with bulk actions"*, *"checkout"*. The type, not the feature name, is what other products have solved.
2. **Pick 2–4 references** known for doing that screen well — established products in the same category, plus the relevant platform guidance: Apple Human Interface Guidelines, Material Design, WCAG 2.2, and the GOV.UK Design System for forms and plain-language flows. Use web search and page fetches when available; otherwise your own knowledge, said plainly.
3. **Extract patterns, not looks.** For each reference, note what it does that fits *this* user's job:
   - layout and information hierarchy — what leads, what's secondary
   - the main interactions and where actions sit
   - how it handles loading, empty, error, and partial states
   - copy conventions — labels, button verbs, error wording
4. **Borrow, don't clone.** Never reproduce a product's logo, branding, distinctive visual identity, or copy text. Take the patterns and build them from this project's components and tokens.
5. **Write it into the plan:** each reference, what's borrowed, and why it fits. The human sees it at plan approval and can redirect (*"more like X"*).

### New product, no design system

For a greenfield UI, the visual direction — brand feel, density, tone — is a **planning question**, asked once and reused by every screen. The first UI task is then a **foundation task**: set up the component library (section 3), express the visual direction through its theme tokens (colour, type scale, spacing, radius, shadow) in one place, build the app shell, and add the components the plan needs. Screens come after.

## 2. Plan the screen

In the feature plan's **UI design** section:

- **Purpose** — one line: who uses this screen and the one job it must help them do.
- **Layout** — a short wireframe where every box names an existing component, or a new one with a reason.
- **Focal point** — the single thing the screen leads with: a key figure, the primary action, the list. Everything else stays quiet. The focal point comes from content and hierarchy, never from new colours or type.
- **States** — what loading, empty, error, and partial look like.

## 3. Use the component library

**Never hand-build what the component library ships.** Buttons, inputs, selects, dialogs, sheets, tabs, tables, badges, toasts, skeletons — add them from the library and compose screens from them. Hand-build a component only when the library genuinely has nothing that fits, and say why in the plan.

`feature_list.json` → **`uiLibrary`** names the library:

- **`shadcn`** (default) — the shadcn family, in the flavour that matches the stack:

  | Stack | Use |
  |---|---|
  | React — Next.js, Vite, Remix / React Router, TanStack Start, Astro with React | **shadcn/ui** — ui.shadcn.com |
  | Vue / Nuxt | **shadcn-vue** — shadcn-vue.com |
  | Svelte / SvelteKit | **shadcn-svelte** — shadcn-svelte.com |
  | Angular | **spartan/ui** — spartan.ng |
  | Solid / SolidStart | **shadcn-solid** — github.com/hngngn/shadcn-solid |
  | Anything else — server-rendered templates, plain HTML, htmx, Rails, Django, Laravel | **Basecoat** — basecoatui.com |

  All of them are built on Tailwind CSS: if the project doesn't have it, the foundation task adds it. Components are added through each flavour's CLI and land in the repo as source you own — customise them through theme tokens and variants, not by rewriting them, unless matching an approved design needs more (see *Working from a design*).
- **`none`** — the human opted out: build components by hand, following the rest of this guide.
- **Any other value** (`mui`, `chakra`, `mantine`, `vuetify`, …) — the library this project already uses. Compose from it; don't add shadcn alongside it.

The human can change it at any time — *"don't use shadcn"*, *"use MUI"* — and the agent writes the new value to `feature_list.json`. Adding a **second** UI library, or swapping the existing one, always needs the human's approval.

## 4. Take stock before building

List what the project already has, and compose from it:

- components already added from the library, and where shared ones live
- design tokens — never hard-code a colour, size, or font that a token covers
- the app shell and layout conventions
- form, validation, and data-fetching patterns

New compositions go with the shared components, not inside the page. A connected design-system MCP or an installed design skill can help here, but **the project's own design system always wins**.

### Bundled design skills

The Workhorse plugin ships two design skills. Both are part of every UI task (AGENTS.md → **Completing a feature**, step 1), and each leaves a trace line in `progress.md`:

- **`shadcn`** — the official shadcn/ui skill. Required whenever `uiLibrary` is `shadcn` on a React stack: setting up the library in the foundation feature, then adding, composing, and styling every component. For the other flavours, follow that flavour's own docs and CLI.
- **`emil-design-eng`** — the design pass. Required at the polish step of every UI task: interaction feel, transitions on overlays and state changes, feedback on actions, easing and timing. Also use it whenever a screen adds motion, or when judging whether an interaction *feels* right. With a design source, it only fills what the design doesn't specify — it never overrides the design.

## 5. Build in this order

1. **Route and shell** — the screen is reachable inside the real layout.
2. **Static layout with realistic content** — composed from library components — real-length names, zero items, one item, many items. No lorem ipsum.
3. **Real data.**
4. **States** — loading, empty, error, partial.
5. **Interactions** — forms, validation, feedback after every action.
6. **Responsive** — works down to phone width; nothing essential behind hover.
7. **Accessibility** — every control reachable by keyboard, labelled, with a visible focus state; text contrast meets WCAG AA.
8. **Polish** — run the design pass with the `emil-design-eng` skill (required — see below), then remove one thing that doesn't help the user.

## 6. Look while you build (required)

After build steps 2, 4, and 6 in section 5, open the page in the browser tool (the Workhorse plugin bundles Playwright) and take screenshots at desktop width and phone width (~390px). Compare them against the design source and fix what's off before moving on. With a Figma MCP, fetch a screenshot of the matching frame and compare at the same width.

This is the builder checking its own work. The Reviewer still checks independently afterwards and never takes the builder's word for it. With no browser tool available, say so in `progress.md` and continue — the Reviewer's unobserved-behaviour gate will surface it.

## 7. Craft rules

These apply where the design source is silent. They never override a design.

**Structure is information.**
- Number items only when they are a real sequence.
- Use dividers, badges, and labels only when they tell the user something. Drop a label that restates the content under it.

**Avoid generated-UI tells.**
- No ALL-CAPS eyebrow labels above headings.
- No `→` appended to button or link text.
- No meta strings joined with middle dots (`A · B · C`).
- No single accented word in a headline.
- No decorative gradients, glows, or emoji standing in for hierarchy.

**Readable text.** Keep running text under ~80 characters per line.

**Cohesion.** Match how this app already does the same thing before inventing a new pattern.

## 8. Copy

- **User language, not system language.** "Notifications", not "webhook config".
- **Buttons say what happens.** "Save changes", "Send invoice" — not "Submit" or "OK".
- **One name per action.** "Publish" leads to "Published", not "Success".
- **Errors explain and fix.** Say what went wrong and what to do next. Never "Something went wrong" on its own.
- **Empty states point to the next action** — a headline saying what's missing and an action that fixes it.
- **Sentence case, plain verbs, no filler.**

## What the Reviewer checks

Only what's objective — never taste:

- the screen follows its design source or the borrowed patterns listed in the plan, apart from departures recorded under **Design departures**
- components come from `uiLibrary` — a hand-built button, dialog, or input that the library ships is a `warn` finding
- loading, empty, and error states exist and match the plan
- it works at phone width, and nothing essential sits behind hover
- controls are keyboard-reachable and labelled
- error and empty-state copy say what to do next

Missing loading, empty, or error states and missing accessibility basics are acceptance failures (`fail`). **Structural departures from an approved design** fail through the acceptance criteria the planner wrote for them. Cosmetic departures, departures from an existing screen or reference research, and craft or copy issues are `warn` findings for the human — they don't block the commit.
