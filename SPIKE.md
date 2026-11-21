# Spike, milestone 1: walking skeleton

Status: done on 2026-11-21. The measured results are in [SPIKE-RESULTS.md](SPIKE-RESULTS.md). Nothing here is published or stable.

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

Mounting: every implementation has `<div id="root"></div>` as the only content element of `<body>` and renders `<main class="app">` as the only child of that div. The verifier captures the `html` element without `head`, and the document title, and ignores `<script>`, `<style>` and `<link>` elements. The Angular port bootstraps its root component on `#root`, so there is no `<app-root>` element.

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
| `focus` | Delete leaves focus on the body | side effects (field `focus`) |
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

`replay` writes a report and exits 1 on any hard mismatch. `gate` is `replay` plus the lock check, and exits 1 on any hard mismatch, any tampered or stale recording, or zero cases. `setup`, `review` and `mcp` come later.

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

# Spike, milestone 2: a gate that does not depend on the machine or on how the fixture is written

Status: in progress since 2026-11-21. Nothing here is published or stable.

Decisions Q33, Q35, Q37 and Q38 (Round 5) and Q50 to Q61 (Round 6) of the planning notes bind this milestone. The findings it answers are in [SPIKE-RESULTS.md](SPIKE-RESULTS.md) under "Second review, after the fix pass". Where this part contradicts the milestone 1 part above, this part counts.

## Goal

Same commands, same fixture. After this milestone:

- The exit code of a gate does not depend on the speed or the load of the machine.
- Every page pair of the second review where a faithful port failed passes, and every pair where a port that differs passed fails.
- Every rule has a test that fails when the rule is switched off.

How the work is done:

- A finding is reproduced before code changes, with a test or a script that fails.
- The gate is never loosened globally to get a pass, and no tolerance is added.
- A done-item is never bent. If a decided design cannot meet it, the design is built as written, measured, and the gap is reported with its numbers.
- Every number comes from a command that was run, with how often it ran.
- No git operation. No explanatory comments in the code.

Each step leaves what it built and measured in the planning notes (`m2/step<N>.md`). Step 6 writes SPIKE-RESULTS.md from them.

## Step 1: the paused clock (Q35, Q50)

- The runner installs the clock paused at the fixed start time. Page time moves only when the runner moves it, in frames of 16 ms.
- After each frame the runner finishes every finite CSS animation and transition. An endless animation is held at a fixed point (for example its start), so it looks the same in every observation.
- While a request is in flight the runner waits in real time and does not advance the clock.
- A step is settled when two observations one frame apart are identical and no request is in flight. The limit of a step is a number of frames, not a number of seconds.
- `advance` takes `frames`. `ms` is no longer accepted, and the message names the conversion. The case format becomes `angular-anything/case@1`.
- The stable screenshot stays. Its wait is real time and moves no page time.
- The starting point is what `research/gap-time-and-input-fidelity.md` of the planning notes measured (sources in `experiments/gap-time`). Its experiment becomes a test in this repo: one case run 20 times gives one end state.

Done when:

1. Every port of the toast table (800 to 4000 ms against 2000 ms) and every port that renders late (40 to 250 ms) gets the same exit code in 10 of 10 runs, and the same one at CPU throttle rates 1, 8 and 20.
2. The clean port passes at CPU throttle rates 1, 8, 20 and 40.
3. A page with an endless stepped animation passes against its own recording in 35 of 35 gates. A page with an endless smooth animation can be recorded and passes against its own recording.
4. A still and a moving variant of one page (a canvas that repaints, a spinner in a shadow root, an animated GIF) differ in screenshots only, and each unchanged page passes against its own recording in 12 of 12 gates.
5. Recording the three originals 5 more times gives the same root hash for every case, every time.
6. The settle logic has a test that does not depend on real time (a fake page and a fake request log). It fails in 10 of 10 runs when the rule about requests is removed.

## Step 2: compare what the browser means (Q54, Q57, Q59)

- Text (Q57). A text node is compared as the browser collapses it. Where the parent collapses whitespace, a run of whitespace counts as one space, and a run at the start or at the end of the node counts only if the browser gives it a box. Where the parent preserves whitespace, the text is compared as written. The browser is asked, CSS is not implemented a second time.
- `style` attribute (Q59). Compared as the declarations the browser parsed, not as text.
- `textarea` (Q59). Compared by its value. Its text child is not part of the canonical DOM.
- `url()` (Q59). In computed values the origin of the page itself is replaced by a fixed word, so the same relative URL compares equal on two origins. A URL to another host stays as it is.
- AngularJS (Q54). One proof for every attribute: it is dropped when the injector has a directive of that name, built-in ones included, or when it is a declared binding of a directive on that element, `.component()` and element directives included. Any other `ng-` attribute stays. A text binding stays when the browser reads the attribute: a property of the element (compared without case, and with the renames between attribute and property such as `class` and `for`), a global HTML attribute, `aria-*`, `role`, or an SVG presentation attribute.
- Three small ones from the second review, each reproduced first. The boolean attribute rule applies only where the element has that boolean property. An event payload keeps a `Set`, a `Map`, `NaN` and `undefined` apart. A custom property registered with `inherits: false` is compared per element.

Done when:

1. The page pairs under "A faithful port fails" pass, except the plain attribute selector, which stays a failure by decision (step 4). For text that means all three sources, with the port written with and without the line breaks.
2. Each has a control that still fails: a space that renders (`<span>a</span> <span>b</span>` against `<span>a</span><span>b</span>`), another declaration in `style`, another `textarea` value, a `url()` to another file, a missing attribute that the browser reads.
3. The three clean gates pass with 0 masks, and the 24 gates of the seeded bugs fail in the same layers as in milestone 1.
4. Each rule has a unit test, and the test fails when the rule is switched off. That is checked by switching it off.

## Step 3: masks (Q53)

- A string with structure is compared by its parts: a `localStorage` value that is JSON, a URL (path and query parameters), a form body and a multipart body (fields). Differences and masks then name the part.
- A mask never hides a missing value. At a masked path the port must have a value of the same kind.
- A key that holds `.`, `/` or `[` cannot be taken for a child path.
- `record` exits 1 when it has to mask a path in a hard layer that the case does not name. A case names the noise it expects in a list `noise` of layer and path, with `*` for any index. `record` prints each such path in the form the case needs. A screenshot mask never fails `record`.

Done when:

1. On the mask page of the second review the five ports with one defect fail. Without `noise`, `record` exits 1 and names the paths. With it, `record` exits 0 and the faithful page passes.
2. The Tasks fixture records with 0 masks and without `noise`.
3. Each rule has a unit test that fails when the rule is switched off.

## Step 4: the rest (Q51, Q52, Q55, Q56, Q58, Q60)

- Tolerance (Q52). Box numbers are compared exactly. The 0.5 px tolerance and the 1e-9 slack are removed.
- Dialogs and windows (Q55). `alert`, `confirm`, `prompt` and `window.open` are logged in the side effects. Dialogs are dismissed as before. A step that answers a dialog is not built.
- Cases (Q56). The ten extra cases named in SPIKE-RESULTS.md ("Fixtures") join `cases/fixture`.
- Selector attribute (Q58). No gate rule. The convention for a port: the selector of a component is something the original element already matches (tag and class such as `li.task`, or an existing attribute such as `[id=root]`), else an input alias that is bound. `li.task` is tried on the fixture port and used there if the DOM stays the same. When the only DOM differences of a step are attributes with an empty value that only the port has, the summary names this convention.
- Clean-up (Q60). The test gaps and the findings that one reviewer reported (SPIKE-RESULTS.md, "Tests" and "Reported by one reviewer, not repeated"): each is reproduced first, then fixed with a test, or listed with its measurement and the reason it stays. The explanatory comments in `src/` and `test/` are removed.
- Spec (Q51). Done in the milestone 1 part above: the capture is `html` without `head` plus the title, focus is a field of the side effects, `replay` exits 1 on a hard mismatch.

Done when:

1. A port that calls `alert` on every add fails, and so does one that calls `window.open`.
2. The 19 cases pass for all three sources with 0 masks, in 10 of 10 runs each, and the port with a broken Enter key fails.
3. For each finding of the clean-up: its reproduction, and the fix with its test or the reason it stays.
4. The done-items of steps 1 to 3 still hold.

## Step 5: the remaining Round 5 rules (Q33, Q37, Q38)

- Geometry in the same session (Q33). Sizes, positions and screenshots are compared only against the original run again in the same session: `gate` and `replay` take `--original-url`. Without it these values are not compared, and the report says so. Everything else is compared against the stored recording as before. Which longhands hold sizes is measured, starting from `research/gap-gate-calibration-spike.md`.
- Network tape (Q37). `record` stores each request and its answer in the recording. `replay` and `gate` answer the requests of the port from that tape, keyed by the canonical request and the state, as measured in `research/gap-stateful-network-replay.md` (sources in `experiments/netreplay`). A changed mutation, a request that the tape does not hold and a changed credential header fail the gate. How often and in which order reads are sent is reported and does not fail it.
- Secrets (Q38). `record` refuses to write a recording that holds a detected secret. It names the path and prints no value. Cookies and auth headers are never stored. The starting point is `research/gap-recording-secrets-and-untrusted-content.md`.

Done when:

1. With `--original-url` the `style` bug fails in sizes and positions as before. Without it the same bug still fails in the stored longhands, and the report says that sizes were not compared.
2. The port passes the gate with the mock API switched off, answered from the tape. A port with a changed POST body fails, one that sends a request the tape does not hold fails, and one that sends the GET twice passes with a note.
3. A recording that would hold a token (in `localStorage`, in a request header, in the body of an answer) is refused, 3 of 3.
4. The experiments behind the three reports are tests in this repo.
5. The done-items of steps 1 to 4 still hold.

## Step 6: measure and review

SPIKE-RESULTS.md is written again for the code as it then is, in the form of milestone 1: verdict, gate matrix, timings, what each step changed, what is not covered, open points. The 54 ports with one defect and the page pairs of the second review are gated again. Then reviewers who did not build it go through all of it, and what they find is fixed or listed.

## Not in this milestone

TodoMVC, sonner, the porting skill, the MCP server, `setup` and `review`, CI, publishing to npm, and any git operation.
