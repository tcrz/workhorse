# UI build guide

<!-- Managed by Workhorse: refreshed on every harness upgrade. Put repo-specific UI notes in AGENTS.md outside the harness:managed markers, not here. -->

Read this for any feature that adds or changes a user-facing screen: at planning, and again before implementing a UI task. We can't define what every UI should look like — so this guide defines **how to decide** what it should look like, and **how to build it**.

## 1. Find the design source

Before designing anything, find what the screen should be built from. Use the first that exists:

1. **A design file.** A Figma link (or similar) from the human. If a Figma MCP is connected, fetch the frames and map each element to an existing component.
2. **A mockup or screenshot** the human provides.
3. **An existing screen in this app** that does something similar. Match it — a new screen should feel like the rest of the product.
4. **Reference research** — when there is nothing to follow (see below).

Record the source in the feature plan's **UI design** section. The builder builds against it and the Reviewer reviews against it.

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

For a greenfield UI, the visual direction — brand feel, density, tone — is a **planning question**, asked once and reused by every screen. The first UI task is then a **foundation task**: design tokens (colour, type scale, spacing, radius, shadow) defined in one place, the app shell, and the handful of core components the plan needs. Screens come after.

## 2. Plan the screen

In the feature plan's **UI design** section:

- **Purpose** — one line: who uses this screen and the one job it must help them do.
- **Layout** — a short wireframe where every box names an existing component, or a new one with a reason.
- **Focal point** — the single thing the screen leads with: a key figure, the primary action, the list. Everything else stays quiet. The focal point comes from content and hierarchy, never from new colours or type.
- **States** — what loading, empty, error, and partial look like.

## 3. Take stock before building

List what the project already has, and compose from it:

- components, and where shared ones live
- design tokens — never hard-code a colour, size, or font that a token covers
- the app shell and layout conventions
- form, validation, and data-fetching patterns

Create a new component only when nothing fits, and put it with the shared components, not inside the page. A connected design-system MCP or an installed design skill can help here, but **the project's own design system always wins**. No new UI library without the human's approval.

### Bundled design skills

The Workhorse plugin ships two design skills. Use them where they fit, never against the project's own system:

- **`emil-design-eng`** — polish, interaction feel, and animation decisions. Use it at step 8 (polish), whenever a screen adds motion or transitions, and when judging whether an interaction *feels* right.
- **`shadcn`** — only when the project already uses shadcn/ui (it has a `components.json`), or when the human chose shadcn/ui as the foundation of a new React + Tailwind app. Never introduce it into a project that has its own component library.

## 4. Build in this order

1. **Route and shell** — the screen is reachable inside the real layout.
2. **Static layout with realistic content** — real-length names, zero items, one item, many items. No lorem ipsum.
3. **Real data.**
4. **States** — loading, empty, error, partial.
5. **Interactions** — forms, validation, feedback after every action.
6. **Responsive** — works down to phone width; nothing essential behind hover.
7. **Accessibility** — every control reachable by keyboard, labelled, with a visible focus state; text contrast meets WCAG AA.
8. **Polish** — then remove one thing that doesn't help the user.

## 5. Look while you build (required)

After steps 2, 4, and 6, open the page in the browser tool (the Workhorse plugin bundles Playwright) and take screenshots at desktop width and phone width (~390px). Compare them against the design source and fix what's off before moving on.

This is the builder checking its own work. The Reviewer still checks independently afterwards and never takes the builder's word for it. With no browser tool available, say so in `progress.md` and continue — the Reviewer's unobserved-behaviour gate will surface it.

## 6. Craft rules

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

## 7. Copy

- **User language, not system language.** "Notifications", not "webhook config".
- **Buttons say what happens.** "Save changes", "Send invoice" — not "Submit" or "OK".
- **One name per action.** "Publish" leads to "Published", not "Success".
- **Errors explain and fix.** Say what went wrong and what to do next. Never "Something went wrong" on its own.
- **Empty states point to the next action** — a headline saying what's missing and an action that fixes it.
- **Sentence case, plain verbs, no filler.**

## What the Reviewer checks

Only what's objective — never taste:

- the screen follows its design source or the borrowed patterns listed in the plan
- loading, empty, and error states exist and match the plan
- it works at phone width, and nothing essential sits behind hover
- controls are keyboard-reachable and labelled
- error and empty-state copy say what to do next

Missing loading, empty, or error states and missing accessibility basics are acceptance failures (`fail`). Departures from the design source or the craft and copy rules are reported as `warn` findings for the human — they don't block the commit.
