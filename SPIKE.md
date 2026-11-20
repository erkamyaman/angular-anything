# Spike, milestone 1: walking skeleton

Status: in progress. Nothing here is published or stable.

## Goal

`record`, `replay` and `gate` work between a small fixture UI written three times as an original (React, Vue, AngularJS) and once as its Angular port. The gate passes for the faithful port and fails for every seeded bug.

This milestone tests whether the gate works at all and what its tolerances should be. It is not the product.

## Binding decisions

The full list is in the planning notes (`decisions.md`). The ones that bind this milestone:

- TypeScript, ESM only, one package with one bin (`angular-anything`).
- Playwright pinned to the exact version 1.65.1. Chromium only for now.
- Angular 22.3 for the port. Standalone, zoneless and OnPush are defaults there: do not write `standalone: true` or `changeDetection` explicitly. Signals, `input()`, `output()`, built-in control flow, `inject()`.
- The port keeps the original CSS as a global stylesheet with the same class names, uses no view encapsulation, and puts each component on the original root element with an attribute selector, so Angular adds no wrapper element.
- Hard gate layers: accessibility snapshot, canonical DOM, computed style and geometry, event log, side effects. Pixels are a soft, reported check.
- Stored, hash-locked recordings are the contract. The gate is a CLI exit code.
- Normalizer relaxations apply only to nodes that are provably framework artifacts, never as a global rule.
- No telemetry. MIT license. Not affiliated with Angular or Google.
- Tagline: "Replays every recorded interaction of the original against the port." Never a bare "proves parity".

## Fixture: Tasks

One small page. All four implementations must produce the same DOM (after framework artifacts are stripped), the same styles, the same events and the same side effects.

```html
<main class="app">
  <h1>Tasks</h1>
  <form class="add" aria-label="Add task">
    <label for="new-task">New task</label>
    <input id="new-task" name="title" type="text" required>
    <button type="submit" class="btn btn-primary">Add</button>
  </form>
  <div class="filters" role="tablist" aria-label="Filter">
    <button type="button" role="tab" aria-selected="true" class="tab is-active">All</button>
    <button type="button" role="tab" aria-selected="false" class="tab">Active</button>
    <button type="button" role="tab" aria-selected="false" class="tab">Done</button>
  </div>
  <ul class="tasks" aria-label="Tasks">
    <li class="task">
      <input type="checkbox" id="task-1">
      <label for="task-1">Buy milk</label>
      <button type="button" class="btn btn-icon" aria-label="Delete Buy milk">×</button>
    </li>
  </ul>
  <p class="count" aria-live="polite">2 tasks left</p>
  <button type="button" class="btn details-toggle" aria-expanded="false" aria-controls="details">Details</button>
  <section id="details" class="details" hidden>
    <p>Tasks are stored in this browser.</p>
  </section>
  <button type="button" class="btn load">Load suggestions</button>
  <ul class="suggestions" aria-label="Suggestions"></ul>
  <div class="toast" role="status"></div>
</main>
```

Mounting: every implementation has `<div id="root"></div>` as the only content element of `<body>` and renders `<main class="app">` as the only child of that div. The verifier captures `document.body` and ignores `<script>`, `<style>` and `<link>` elements. The Angular port bootstraps its root component on `#root`, so there is no `<app-root>` element.

Behavior:

- Initial tasks: `Buy milk` (id 1, active) and `Write report` (id 2, done), unless `localStorage.tasks` holds a list. New ids count up from the highest id.
- A done task has `class="task is-done"` and a checked checkbox.
- Add: trims the title, ignores an empty one, appends the task, clears the input, keeps focus in the input, sends `POST /api/tasks` with JSON body `{"title": "<title>"}`, shows `Task added` in the toast for 2000 ms.
- Toggle and Delete act on one task. Delete moves focus to the `New task` input.
- Filter tabs show all, active or done tasks. The selected tab has `aria-selected="true"` and class `is-active`.
- Count text: `1 task left` or `N tasks left`, counting active tasks.
- Details toggles `aria-expanded` and the `hidden` attribute of the section.
- Load suggestions: the button gets `disabled` and `aria-busy="true"` while `GET /api/suggestions` is in flight, then the list shows one `<li>` per suggestion.
- Every change to the task list is written to `localStorage.tasks` as JSON (`[{"id":1,"title":"Buy milk","done":false}, ...]`).
- The task row is its own component in every implementation (React component, Vue component, AngularJS attribute directive on the `<li>`, Angular attribute-selector component on the `<li>`).

Events: each implementation reports its component outputs through one shared hook, and only through it:

```js
window.__aa?.emit(name, payload)
```

| Event | Payload |
|---|---|
| `taskAdded` | `{ id, title }` |
| `taskToggled` | `{ id, done }` |
| `taskDeleted` | `{ id }` |
| `filterChanged` | `{ filter }` with `all`, `active` or `done` |

Shared files: `fixtures/shared/fixture.css` is the only stylesheet and every implementation loads it unchanged. `fixtures/server.ts` serves the built apps and the mock API (`POST /api/tasks` returns `201` with the task, `GET /api/suggestions` returns `["Call the bank","Water the plants"]` after 150 ms).

Ports: React 4101, Vue 4102, AngularJS 4103, Angular 4104.

Seeded bugs: the Angular port reads `?bug=<name>` and misbehaves on purpose. The gate must fail on each one and name the layer.

| Bug | Effect | Layer that must fail |
|---|---|---|
| `double-event` | `taskToggled` is emitted twice | events |
| `missing-class` | a done task does not get `is-done` | DOM and style |
| `aria` | Details never updates `aria-expanded` | accessibility |
| `text` | count always says `tasks` | accessibility and DOM |
| `request` | the POST body has no title | side effects |
| `storage` | nothing is written to `localStorage` | side effects |
| `focus` | Delete leaves focus on the body | focus |
| `style` | the port adds `margin-left: 3px` to `.count` | style and geometry |

## Layout

```
package.json, pnpm-workspace.yaml, tsconfig.json, LICENSE, README.md, SPIKE.md
src/            the CLI and the verifier
test/           unit tests
fixtures/
  shared/fixture.css
  server.ts
  react/  vue/  angularjs/  angular/
cases/fixture/<case-id>/case.json      authored steps
recordings/<source>/<case-id>/         recorded observations, screenshots, lock.json
```

pnpm workspace, one install for everything. The disk is nearly full (about 6 GB free), so there is one shared store and no duplicate installs.

## Case format (version 0, unstable)

`case.json` holds only inputs:

```json
{
  "format": "angular-anything/case@0",
  "id": "add-task",
  "description": "Add a task and see it listed",
  "viewport": { "width": 1024, "height": 768 },
  "steps": [
    { "action": "goto", "path": "/" },
    { "action": "fill", "target": { "role": "textbox", "name": "New task" }, "value": "Call mom" },
    { "action": "click", "target": { "role": "button", "name": "Add" } },
    { "action": "advance", "ms": 2500 }
  ]
}
```

Targets are role and accessible name, so one script drives every implementation. After each step the page settles and one observation is captured.

A recording holds, per step: the accessibility snapshot, the canonical DOM, computed style and geometry per element, the events emitted, requests made, storage writes, the URL and the focused element, plus a screenshot. `lock.json` holds a SHA-256 per file, a root hash, and the Playwright and browser versions. `gate` refuses a recording whose files do not match the lock.

`record` runs the original twice. Anything that differs between the two runs is masked and listed in the recording, so noise is never compared.

Spike defaults, to be measured and not yet decided: the same generic settle rule on both sides (no requests in flight, no DOM mutations, two identical observations in a row), a Playwright clock installed at a fixed start time that keeps flowing with explicit `advance` steps, and 0.5 px geometry tolerance.

## Commands in this milestone

```
angular-anything doctor
angular-anything record <suite> --source <name> --url <original-url>
angular-anything replay <suite> --source <name> --url <port-url>
angular-anything gate   <suite> --source <name> --url <port-url>
```

`replay` writes a report. `gate` is `replay` plus the lock check, and exits 1 on any hard mismatch, any tampered or stale recording, or zero cases. `setup`, `review` and `mcp` come later.

## Done when

1. `pnpm test` passes.
2. All four fixture apps build and serve.
3. For each source (React, Vue, AngularJS): record from the original, then `gate` against the Angular port exits 0.
4. For each seeded bug: `gate` exits 1 and the report names the expected layer.
5. Changing one byte of a recorded observation makes `gate` exit 1 with a lock error.
6. A page with an empty `<main>` passes no case.
7. `SPIKE-RESULTS.md` holds the real numbers: every gate run, every failure, timings, and what had to be changed to get there. If a cross-source gate fails because the fixtures differ, fix the fixture. Never loosen the gate globally to get a pass.

## Not in this milestone

TodoMVC, sonner, the porting skill, the MCP server, the network tape, secret redaction, CI, publishing to npm, and any git operation. The maintainer runs git and creates the GitHub repo.
