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

Decisions Q33, Q35, Q37 and Q38 (Round 5), Q50 to Q61 (Round 6) and Q62 to Q80 (Rounds 7 to 9) of the planning notes bind this milestone. The findings it answers are in [SPIKE-RESULTS.md](SPIKE-RESULTS.md) under "Second review, after the fix pass". Where this part contradicts the milestone 1 part above, this part counts.

## Goal

Same commands, same fixture. After this milestone:

- The exit code of a gate does not depend on the speed or the load of the machine.
- Every page pair of the second review where a faithful port failed passes, except the plain attribute selector (Q58). Every pair where a port that differs passed fails, except the port that only leaves out a GET (`sync-none`), which passes with a note from step 5 on (Q74).
- Every rule has a test that fails when the rule is switched off.

How the work is done:

- A finding is reproduced before code changes, with a test or a script that fails.
- The gate is never loosened globally to get a pass, and no tolerance is added.
- A done-item is never bent. If a decided design cannot meet it, the design is built as written, measured, and the gap is reported with its numbers.
- Every number comes from a command that was run, with how often it ran.
- No git operation. No explanatory comments in the code.

Each step leaves what it built and measured in the planning notes (`m2/step<N>.md`). Step 6 writes SPIKE-RESULTS.md from them. Where a done-item of an earlier step says that SPIKE-RESULTS.md or the results list something, the step writes it into its notes under the heading "For SPIKE-RESULTS.md", and step 6 carries it over.

## Step 1: the paused clock (Q35, Q50, Q62 to Q64)

The clock:

- The runner starts the clock paused at the fixed start time, with `pauseAt` as the first and only clock call before the page exists. `install()` is not called, so `performance.now()` starts at 0. Page time moves only when the runner moves it, in frames of 16 ms.
- Before each observation and before each frame the page comes to rest: timers that are due run without moving the clock, queued tasks run, animations are finished or held, and the browser gets one frame of its own when something moved. This repeats until two rounds in a row moved nothing. Coming to rest has a limit of its own, counted in rounds per step. A page that is still moving at that limit (finishing an animation starts the next, without end) fails the step, and the message says what kept moving.
- An interval with a delay of 0 gets 1 ms.
- The browser context does not ask for reduced motion (Q63). The runner finishes animations itself.

Animations:

- At rest the runner finishes every finite animation on the timeline of the document, in the document and in every shadow root it can reach: CSS animations, transitions and animations started by script. Finite SVG animations are finished as well. An endless animation is held at a fixed point (for example its start), so it looks the same in every observation. An animation with playback rate 0 and an animation on another timeline (scroll-driven) are left as they are and keep no step open.
- An animation that the runner cannot reach is never passed or failed at random: `record` refuses such a page by name, every time.

Requests:

- A request that the page sends with `fetch` or an asynchronous `XMLHttpRequest` leaves the browser only when the page is at rest, after the timers that are due have run. Then the runner waits for the answer in real time. Answers reach the page one at a time, each when the page is at rest, in the order in which the requests were sent. Without this an answer races the timers that are due, and two answers race each other.
- A request that the page cannot go on without is never held: the document of a navigation, also one that the page starts itself (a link, a form, a timer, the answer of a request), the scripts, styles and images that a loading document asks for, and a synchronous `XMLHttpRequest`. After a navigation the runner waits for the new document to load before it observes.
- The wait for requests is real time and has limits of its own, counted per step: 5000 ms for the requests that are in flight together, and a number of rounds of answers. At a limit the step fails and the message names the request. The runner never moves the clock while a request is in flight.

A step while recording:

- A step stays open until 4 frames in a row were quiet. A frame is quiet when the observation after it equals the one before it, no finite animation was finished in it, no request started or ended in it, and no one-shot timer of the page is due within 500 ms of page time. The research needed 2 quiet frames and recommends 4: Vue changes its classes two animation frames after the action and arms its fallback timer only then, ngAnimate closes on a timer of its own, and Angular shows the change of a timer that fires on a frame one frame later than React.
- A one-shot timer no longer keeps a step open once timers with the same delay have fired at two earlier page times in that step (Q62). `setInterval` never keeps a step open. The rest check on the port ignores the same timers. What this rule cannot tell apart is measured and listed.
- Motion that neither the clock nor the animation API reaches (smooth scrolling, for example) is waited out in real time, without moving page time (Q64). The wait stands where the motion shows, inside a step as well as after the stable screenshot: the runner lets an observation count only when the page has stopped changing in real time. It observes again one frame of the browser later and goes on while the two differ, 5000 ms at most. Then the step fails, and the message says that the page moves without page time. How many frames a step takes does not depend on how long such motion takes in real time.
- The limit of a step is 300 frames after its action, or after the last frame of an `advance`.
- `record` stores the frames each step took, the frames of an `advance` included, in the recording, under the lock. `record` exits 1 when its two runs took a different number of frames in a step, and names the step and both numbers. `replay` and `gate` refuse a recording without frames and say that it has to be recorded again.

A step on the port:

- `replay` and `gate` run exactly the stored frames on the port, with the same waits in real time, and compare then. No side settles on its own: the same step took 3 frames on React and 22 on AngularJS in the research, which shifts every later timer.
- After the stored frames the port has to be at rest: its last frame was quiet by the rule of the recording (observation unchanged, no animation finished, no request started or ended, no one-shot timer due within 500 ms, with the same rule for timers that arm themselves again). Else the step fails. The message says that the step was not settled within the frames of the original and names what was not quiet.
- The report prints the frames of each step.

Unchanged from the first part:

- `advance` takes `frames`. `ms` is no longer accepted, and the message names the conversion. The case format is `angular-anything/case@1`.
- The stable screenshot stays. Its wait is real time and moves no page time.
- The starting point is what `research/gap-time-and-input-fidelity.md` of the planning notes measured (sources in `experiments/gap-time` and `experiments/verify-gap-time`). Its experiment becomes a test in this repo, without its two swipes, because the case format has no pointer path.

Done when:

1. Every port of the toast table (800 to 4000 ms against 2000 ms) and every port that renders late (40 to 250 ms) gets the same exit code in 10 of 10 runs, and the same one at CPU throttle rates 1, 8 and 20.
2. The clean port passes at CPU throttle rates 1, 8, 20 and 40.
3. A page with an endless stepped animation passes against its own recording in 35 of 35 gates. A page with an endless smooth animation can be recorded and passes against its own recording in 5 of 5 gates. Both hold for animations that the animation API lists. For an animation that the runner cannot reach, item 17 counts.
4. A still and a moving variant of one page (a canvas that repaints, a spinner in a shadow root, an animated GIF) differ in screenshots only, and each unchanged page passes against its own recording in 12 of 12 gates.
5. Recording the three originals 5 more times gives the same root hash for every case, every time.
6. The settle logic has a test that does not depend on real time (a fake page and a fake request log). It fails in 10 of 10 runs when the rule about requests is removed.
7. The four framework builds of the research (React, Vue, AngularJS with ngAnimate, Angular) agree at every step of this case: goto, Increment, fill Search, `advance 19`, Show toast, `advance 113`, `advance 138`, Add, Add, Remove first (its case without the two swipes, with the waits of 1800 and 2200 ms of its record and replay run, which are 113 and 138 frames). Recorded on each of the three originals, replayed on that original and on the Angular build, 20 of 20 runs each, once with nothing else running and once with 5 runs at once at CPU throttle rate 20, in the view the research compared (the texts, the toast, the list items with their opacity). The CSS of the research fixture is unchanged. Its toast has left on all four builds after `advance 138`. Control: in a copy in which each side settles on its own, the step `advance 113` differs between AngularJS and the others.
8. Recorded on the Vue build of the research, the step Add ends with the item at opacity 1 and the step Remove first with the item gone.
9. A case of the Tasks fixture whose last step ends less than 500 ms before the 2000 ms toast timer is due (goto, fill, Add, `advance 100`) passes for the clean port against all three recordings in 10 of 10 gates. In a copy of the verifier with 1 quiet frame the same gate fails as not settled. The case is kept with the tests and not in `cases/fixture`, so step 4 still counts 19 cases.
10. Three pages can be recorded, store the same frames in 5 recordings and pass against their own recording in 10 of 10 gates: a clock on `setInterval`, a poll that arms a 200 ms timer in the `then` of each `fetch` through a new function, and a page that polls every 200 ms and shows a toast that leaves through a 300 ms timer after a click. On the third page the step of the click ends after the toast has left. A page with a chain of two different one-shot timers (300 ms, then 200 ms, then a visible change) is observed after the change.
11. Changing one stored frame count makes `gate` exit 1 with a lock error. A recording made before this part is refused with a message that says to record again. A page whose document sets a timer of 100 ms on every odd load and of 400 ms on every even load (the server counts the loads of the document) makes `record` exit 1 and name the step, in 10 of 10 runs. Five recordings of each original store the same frames for every step.
12. Three ports fail as not settled within the frames of the original, in 10 of 10 gates each: one whose last change falls into the last frame of a step, one with a one-shot timer that is due within 500 ms at the end of a step where the original has none (a toast of 800 ms, `add-task` step 4), and one that changes in every frame. A port whose last change falls two frames before the end of the step passes.
13. When this part is built, the observations of the three recordings of the Tasks fixture are the same as before it. Only the stored frames are new. This item is measured once. Later steps change the observations, so it is not part of what steps 4 and 5 measure again.
14. A page whose link loads another page, a page whose form does, a page that navigates from a timer, a page that navigates from the answer of a request, and a page that sends a synchronous `XMLHttpRequest` at load and on a click can be recorded and pass against their own recording in 12 of 12 gates each. No run takes longer than 60 s. A test fails when the hold of requests is switched off.
15. A page that sends its next request as soon as the last one is answered fails `record` with a message that names the request, in 10 of 10 runs, and no run takes longer than 60 s. A page that loads 12 answers one after another can be recorded. A page that sends two requests at once, whose answers take 300 ms and 0 ms and whose end state names the answer that came last, gives one end state in 10 recordings and passes against its recording in 10 of 10 gates.
16. A page that scrolls smoothly on a click and a page with a finite SVG `animate` give one end state in 40 of 40 runs and store the same frames in 5 recordings. Each passes against its own recording in 20 of 20 gates with nothing else running and in 20 of 20 beside 10 busy processes. A page that moves without page time and never stops fails `record` with the message of that rule in 10 of 10 runs.
17. A page with an animation at playback rate 0 can be recorded. A page with a bar on a scroll timeline is recorded with the width that a browser without the runner shows, at two scroll positions. A page whose script starts a new animation whenever one finishes fails `record` with a message that says what kept moving, in less than 30 s. A page with a chain of 12 animations that ends can be recorded and gives one end state in 10 runs. An endless stepped animation in a closed shadow root and an endless SVG `animate` each pass against their own recording in 35 of 35 gates, or `record` refuses the page by name in 10 of 10 runs.
18. The test page of the repo holds the two patterns of the research (a class change two animation frames after a click that is followed by a timer of 201 ms, and a closing timer of 300 ms armed one animation frame after a click). `pnpm test` fails when the look-ahead, the quiet frames, the stored frames, the replay of the frames or the rest check on the port is switched off. That is checked by switching each off.
19. The notes say what the quiet frames and the look-ahead cost (frames and wall time per step, a recording and a gate of the fixture), which toast ports and late ports pass with 2 and with 4 quiet frames, and the exit code of every toast port and every late port before and after. A port may show a change up to 3 frames later than the original and still pass: the notes name the ports this lets through. They give the frames per step on the two poll pages of item 10, the exit code of a port that polls through a timer that arms itself again against an original that polls with `setInterval`, and what the rule of Q62 cannot tell apart. They say what the wait in real time costs: observations and wall time per step, and a gate of the fixture before and after.
20. Items 1 to 6 hold with these rules in place.


## Step 2: compare what the browser means (Q54, Q57, Q59, Q65)

- Text (Q57). A text node is compared as the browser collapses it. Adjacent text nodes are joined first. Where the parent collapses whitespace, a run of whitespace counts as one space. A run at the start or at the end of the text counts where the browser renders it as a space, or would on a wider line. It does not count at the start or the end of a block, next to a `br`, after another space, or in text that is not rendered. Where a line wraps is never the reason: the same text gives the same canonical DOM at every width. Where the parent preserves whitespace, the text is compared as written. Whitespace here is what CSS collapses: space, tab and line break. A no-break space is text. Under `white-space: pre-line` a line break counts as written and a run of spaces and tabs counts as one space. What the browser knows is asked from it (which element is a block, whether whitespace is preserved, whether text is rendered). CSS is not implemented a second time.
- `style` attribute (Q59). Compared as the declarations the browser parsed: a map from property to value and priority. Their order does not count.
- `textarea` (Q59). Compared by its value. Its text child is not part of the canonical DOM.
- `url()` (Q59). In computed values the origin of the page itself is replaced by a fixed word, so the same relative URL compares equal on two origins. Only a URL inside `url()` that starts with the origin of the page is rewritten. A URL to another host stays as it is.
- AngularJS (Q54). One proof for every attribute: it is dropped when the injector has a directive of that name, built-in ones included, or when it is a declared binding of a directive on that element, `.component()` and element directives included. The name of a directive counts only when the directive allows the attribute form. An attribute whose name, normalized as AngularJS does it, starts with a binding prefix (`ng-attr-`, `ng-prop-`, `ng-on-`) has no directive and is dropped as well. Dropped as well, by a fixed list of what AngularJS 1.8 reads without a directive of that name (Q65): `ng-app`, `ng-strict-di`, `ng-csp`, `ng-jq`, `<name>-start` and `<name>-end` where `<name>` is a directive that spans elements, `ng-true-value`, `ng-false-value`, `ng-trim`, `ng-ref-read`, `ng-switch-when-separator`, `ng-transclude-slot`, `ng-animate-ref`. Any other `ng-` attribute stays. The name of a directive and a text binding stay when the browser reads the attribute: a property of the element (compared without case, and with the renames between attribute and property: `class` is `className`, `for` is `htmlFor`, `accept-charset` is `acceptCharset`, `http-equiv` is `httpEquiv`), a global HTML attribute, `aria-*`, `role`, or an SVG presentation attribute. A text binding with a `data-` prefix is dropped as in milestone 1 and stays listed under what is not covered.
- Three small ones from the second review, each reproduced first with the review's own variants. The boolean attribute rule applies only where the element has a boolean property of that name, compared without case. An event payload is recorded with what it holds: a `Set` and a `Map` with their entries, `NaN` and `undefined` as themselves. A key with the value `undefined` equals a missing key. A custom property registered with `inherits: false` is compared per element: a longhand that the parent lists and the child does not list is recorded as missing on the child.

Done when:

1. The page pairs under "A faithful port fails" pass, except the plain attribute selector, which stays a failure by decision (step 4). For text that means all three sources, with the port written with and without the line breaks.
2. Each rule has a control that fails in the layer of the rule. Text: `<span>a</span> <span>b</span>` against `<span>a</span><span>b</span>` fails in the DOM layer, and so do `a&nbsp;b` against `a b`, two no-break spaces against one, and a line break against a space under `pre-line`. `style`: another declaration fails in the DOM layer, also when a stylesheet rule gives both pages the same computed value, and `color: red` against `color: red !important` fails in the DOM layer, while `color: red; margin: 0` against `margin: 0; color: red` passes. `textarea`: another value fails in the DOM layer. `url()`: another file fails in the style layer, and so does the same path on another host. AngularJS: an original whose directive has text bindings named `class`, `viewBox`, `fill`, `stroke-width`, `itemprop`, `for` and `accept-charset`, against a port without one of these attributes, one port each: each fails in the DOM layer.
3. The three clean gates pass with 0 masks, and the 24 gates of the seeded bugs fail in the same layers as in milestone 1.
4. Each rule has a unit test, and the test fails when the rule is switched off. That is checked by switching it off.
5. A paragraph with a space before an inline element, with its text split over several text nodes, gives the same canonical DOM at a viewport width where the line wraps at that space and at one where it does not. A port that holds the same text in one node passes at both widths. The control without the space fails at both widths.
6. An AngularJS original with `ng-attr-title`, `data-ng-attr-lang`, `ng-prop-value` and `ng-on-click` passes against its faithful port. One that boots with `ng-app` and uses `ng-repeat-start`, `ng-repeat-end` and `ng-true-value` passes against its faithful port (Q65). An original with `ng-foo` fails against a port without it. For the AngularJS source the port `missing-required` of milestone 1 still fails in the DOM layer in every case. An original with `required`, `pattern` and `maxlength` on an input and `form` on a button passes against its faithful port, and a port without one of the four fails in the DOM layer.
7. The 14 `url()` pages of the second review are tests in this repo: the 7 that failed on another origin pass, the other 7 still pass. A port built by the Angular CLI from a global stylesheet with a relative `url()` is gated once. If it fails, the difference is listed with its numbers under what is not covered.
8. On the lab page of the second review the variants `set` and `selected` fail. The page pair with `--tone` fails, registered once with `@property` and once with `CSS.registerProperty`. An AngularJS original with `ng-readonly` passes against its port.

## Step 3: masks (Q53, Q66 to Q68, Q70)

- A string with structure is compared by its parts: a `localStorage` value that is JSON, a URL (path and query parameters), a form body and a multipart body (fields). Differences and masks then name the part.
- A stored value is taken apart only when it parses to an object or a list. Any other value is compared as the string it is. Inside a stored JSON value the order of the keys counts, as in milestone 1 (Q67).
- The parts of a request follow `research/gap-stateful-network-replay.md` (Canonicalization). The path counts as sent. Query parameters are decoded, `+` and `%20` are both a space. The order between different names does not count, repeated names keep their order (Q70). A form body is compared the same way. A multipart body is compared by the names, file names, types and contents of its parts, without the boundary. One function builds these parts. In the URL of the page the path segments are decoded, the query is compared like that of a request and the fragment as sent. A URL is taken apart only in the side effects. An attribute that holds a URL is compared as written.
- A mask never hides a missing value. At a masked path the port must have a value of the same kind: the same type (string, number or boolean), and an empty string is not the same kind as a string with text.
- A key that holds `.`, `/` or `[` cannot be taken for a child path.
- `record` exits 1 when it has to mask a path in a hard layer that the case does not name. A case names the noise it expects in a list `noise` of layer and path, with `*` for any index. `record` prints each such path in the form the case needs. A screenshot mask never fails `record`.
- A noise path names one value: a string, a number or a boolean. A path to an object, a list or an element is refused when the case is read, and so is a key of the case that is not known.
- A path that the case names as noise is masked in every step where it exists, also where the two recording runs agree (Q66). `record` lists each noise entry at which the two runs did not differ.
- When the two recording runs differ in whether a value exists or in its kind, `record` exits 1, with or without `noise`.
- When `record` exits 1 for a case, no recording of that case is left, also not the one from before. `gate` and `replay` apply no hard layer mask that the case does not name.
- Masked strings of 8 or more characters that are equal to each other in both recording runs must be equal to each other on the port, within a step and across the steps of a case (Q68). Shorter values are not tied together, because two of them can agree by chance.
- The recording holds no value at a masked path, only its kind and which other masked paths held the same value.

Done when:

1. The mask page of the second review is `sites/notes` of its second run, with the ports `store`, `sync-none`, `sync-other`, `field` and `items` and the control `lang`. Each of the five passes with the code before this step and fails in the side effects after it, and `lang` fails as before. On the first mask page (`sites/r1`, eleven ports) the six that pass before this step fail after it (`stored-flag`, `get-other`, `get-none`, `form-field`, `form-empty`, `prefs-below`) and the other five still fail. Both pages are kept in this repo (sources in `experiments/second-review/mask-page-run2/own/sites/notes` and `experiments/second-review/mask-page-own/sites/r1` of the planning notes). Without `noise`, `record` exits 1 and names the paths. With it, `record` exits 0 and the faithful page passes.
2. The Tasks fixture records with 0 masks and without `noise`.
3. Each rule has a unit test that fails when the rule is switched off.
4. A page that shows one of two values at random at one path records with exit 0 in 10 of 10 runs once the case names the path, and passes in 20 of 20 gates (Q66). In every run in which the two recording runs show the same value, `record` lists the noise entry.
5. On the mask page three more ports fail. Each changes the `ref` of the note inside the JSON of `localStorage.notes`: one stores a number there, one an empty string, one an object. A port that stores `7` in `localStorage.cart`, where the original stores its random token, is gated once and listed with its exit code: a stored value that is no JSON object or list is a string, so its kind cannot tell the two apart. A page whose document holds one more row on every second load (the row is in the HTML that the server sends, not in the answer of a `fetch`) cannot be recorded: `record` exits 1 and names the path, with and without a `noise` entry for it.
6. After `record` exits 1 for a mask that the case does not name, `gate` exits 1 for that case, and no report says pass.
7. A port that sends the same query parameters in another order and with `%20` for `+` passes (Q70). One with another parameter name fails, and so does one with another fragment in the URL of the page. A port that sends a repeated parameter name in another order (`?tag=a&tag=b` against `?tag=b&tag=a`) fails. A port that sends the fields of a form body in another order passes, and one with another field name fails.
8. The port `storage-key-order` of milestone 1 still fails (Q67). A port that stores `1.10` where the original stores `1.1` fails.
9. On the first mask page a port whose event carries another id than the stored note fails, and so does a port that gives the note a new id on reload (Q68). A page with two independent random digits at two masked paths passes against its own recording in 20 of 20 gates.
10. The recording of the mask page holds none of its random values, and two recordings of it, with its noise named, give the same root hash for every case.

## Step 4: the rest (Q51, Q52, Q55, Q56, Q58, Q60)

- Tolerance (Q52). Box numbers are compared exactly. The 0.5 px tolerance and the 1e-9 slack are removed. Boxes stay rounded to 0.01 px at capture.
- Dialogs and windows (Q55). `alert`, `confirm`, `prompt` and `window.open` are logged in the side effects. A dialog is logged with its kind and its text, and the runner dismisses it. A new window is logged with the URL it was opened with, and the runner closes it. Nothing inside a new window is observed. A step that answers a dialog is not built.
- Cases (Q56). The ten extra cases named in SPIKE-RESULTS.md ("Fixtures") join `cases/fixture` as they were written, with `ms` turned into frames by the rule of step 1 (1200 ms are 75 frames, 1500 ms are 94). `add-twice` keeps its 1200 ms. `toggle-under-filter` is the version that clicks.
- Selector attribute (Q58). No gate rule. The convention for a port: the selector of a component is something the original element already matches (tag and class such as `li.task`, or an existing attribute such as `[id=root]`), else an input alias that is bound. `li.task` is tried on the fixture port and used there if the DOM stays the same. When the only DOM differences of a step are attributes with an empty value that only the port has and that the browser does not read on that element, the summary names this convention.
- Clean-up (Q60). The test gaps and the findings that one reviewer reported (SPIKE-RESULTS.md, "Tests" and "Reported by one reviewer, not repeated"): each is reproduced first, then fixed with a test, or listed with its measurement and the reason it stays. Also in the pass: `gate` that stops with exit code 2 leaves the earlier report, an element with `id="angular"` makes the capture throw, a `localStorage` key named `length` is not captured. The explanatory comments in `src/` and `test/` are removed.
- Spec (Q51). Done in the milestone 1 part above: the capture is `html` without `head` plus the title, focus is a field of the side effects, `replay` exits 1 on a hard mismatch.

Done when:

1. A port that calls `alert` on every add fails in the side effects and the report names the dialog. So does one that calls `window.open`, and the report names the URL. An original that asks with `confirm` before a delete records with the dialog in its side effects, 3 of 3, and passes against itself. A port that deletes without asking fails.
2. The 19 cases pass for all three sources with 0 masks, in 10 of 10 runs each, and the port with a broken Enter key fails. A port whose second add does not restart the toast timer fails `add-twice`.
3. The results list every item of the two sections by name: 3 under Tests, 10 under Reported by one reviewer, and the test gaps of its last bullet one by one, each with what was run on the code as it then is and the outcome. A new run of single changes on that code: every survivor has a test or a listed reason. `grep` finds no comment line in `src/` and `test/`.
4. The done-items of steps 1 to 3 still hold, except those that compare with the tree before their own step (step 1, item 13).
5. The port with the plain attribute selector still fails for all three sources, and its summary names the convention. The fixture port with the selector `li.task` is gated against the three stored recordings, and the result with its numbers is in the notes. A port with `hidden=""` on an element where the original has none fails without that line.
6. Each rule of this step has a unit test that fails when the rule is switched off: exact box numbers (two boxes 0.25 px apart differ, and a box that differs by 0.4 px), exact numbers in events and requests (two numbers 5e-10 apart differ), the dialog log, the window log and the summary line of Q58. The lab variant `float` of the second review fails in events and in side effects.
7. A page that calls `alert` in a click handler, one that calls it in a timer of 100 ms and one that calls `confirm` in the answer of a request can be recorded, store the same frames in 5 recordings and pass against their own recording in 10 of 10 gates. No run leaves a window or a process behind.

## Step 5: the remaining Round 5 rules (Q33, Q37, Q38, Q71 to Q80)

Three parts, built in this order: the network tape, geometry in the same session, secrets.

### 5a: the network tape (Q37, Q74 to Q77)

- `record` stores the requests that the page sends with `fetch` or XHR, and their answers, in the recording, under the lock: the tape. `replay` and `gate` answer these requests of the port from the tape. Every other request (the document, scripts, styles, images, fonts, a posted form) goes to the server of the page as before, and what the side effects layer compares of those stays as it is. The starting point is `research/gap-stateful-network-replay.md` (sources in `experiments/netreplay`).
- The tape holds requests to the origin of the page that end within their step. `record` exits 1 and names the request, without its values, when the page opens a WebSocket, sends a `fetch` or XHR request to another origin, or gets an answer that sets a cookie (Q77). A request that is still open when its step ends (an event stream, a long poll) fails the step as in step 1, and the message names the request. `gate` and `replay` fail the step when the port opens a WebSocket.
- Of a request the tape stores the method, the canonical URL, the canonical body and the names of the credential headers it carried. Of an answer it stores the status, the body and the headers `content-type` and `location`. No other header value is stored, whatever the name of the header, and never `Set-Cookie`, `WWW-Authenticate` or `Proxy-Authenticate`. A page that reads another header of an answer is not supported in this milestone.
- The key of a request is its canonical form: the method, the origin (the origin of the page is one fixed word on both sides), the path as sent, the query parameters sorted by name (a repeated name keeps its order, `+` and `%20` are both a space) and the body by its parts as in step 3 (JSON with sorted keys and arrays in their order, form fields sorted like the query, multipart fields without the boundary, any other body as its exact text). No body and `{}` stay different. Headers are not part of the key. The key is built with the function of step 3, and the side effects layer compares a request in the same form.
- A part of a request that the case names as noise (step 3) is not part of the key, for a read and for a mutation. When a part of a key differs between the two runs of `record` and the case does not name it, `record` exits 1 and prints the path in the form the case needs.
- A mutation is a request with the method POST, PUT, PATCH or DELETE. Every other request on the tape is a read.
- The state of a read is its epoch and its step. The epoch starts at 0 in every case and goes up by one each time the answer of a mutation has been handed to the page. A request has the epoch of the moment the runner lets it go (step 1 holds it until the page is at rest). The step is the step of the case in which the page sent the request.
- A read gets the answer recorded for its key in the same epoch and the same step: the Nth read gets the Nth answer, and the last one repeats. If that step recorded none, it gets the latest answer of an earlier step in the same epoch, and if there is none, the first answer of that epoch.
- A read whose key the tape holds, but in no step of this epoch, gets the last answer of the nearest earlier epoch, or the first answer of the next one when no earlier epoch has the key. It fails the gate with a message of its own: the tape has no answer for this state, and the case needs a step in which the original asks.
- A read whose key the tape does not hold is aborted and fails the gate.
- A mutation gets the Nth answer recorded for its key. If the key was recorded less often, the request is aborted. If the tape does not hold the key, the mutation gets the next unused recorded mutation with the same method and path, and the difference between the two bodies is reported as the changed mutation. If there is none, the request is aborted. A mutation that is changed, missing, sent once more or sent in another order fails the gate.
- Reads are soft (Q74). A read is not compared in the side effects layer, and the list `gets` leaves the observation: the reads of a step are on the tape. The report lists, per step, each read that the port sent more often or less often than the original, with both counts, and says where the order of the reads differs. None of this fails the gate, also not a read that the port never sends.
- Credential headers are `authorization`, `x-xsrf-token` and `x-csrf-token` (Q75). A request of the port that carries one where the recorded request that answers it carried none, or carries none where that one carried one, fails the gate, and the report names the header. No value of a credential header is stored, and no fake and no hash of one. Values are not compared, and the report says so.
- Requests of the tape that are in flight together are answered one at a time, in the order in which the page sent them, at `record` and at `replay`, each when the page is at rest. The next one is let go when the one before has ended and the page is at rest again. So the order of two answers does not depend on the server or on the load, and neither does the answer of a read that the page sent together with a mutation. A synchronous `XMLHttpRequest` is never held (step 1). It is answered at once, also before requests that still wait, at `record` and at `replay`, and it has the epoch of that moment. `record` and `replay` use the same route handler. While recording, the handler fetches the answer itself and hands it to the page, so both count the epoch at the same point.
- The second run of `record` is answered from the tape of the first run (Q76). The backend is asked once per case, and what still differs between the two runs is noise of the page itself. When the original sends a request in its second run that the tape of the first run does not hold, `record` exits 1 and names the request and the part that differs. `record` does not reset a backend: a case is recorded in the state the backend is in when the case starts. The README says so.
- Every finding of the tape is reported in the side effects layer.

Done when:

1. With the mock API switched off the clean port passes the gate for all three sources, answered from the tape, and the fixture server counts 0 requests under `/api/` during the gate. A port with a changed POST body fails, one that sends a request the tape does not hold fails, and one that sends the GET twice passes with a note that names the GET.
2. State. The experiment of the report is a test in this repo, on a page of its own without a login. The page loads a list and a count with two GETs at once, the list GET has two query parameters, a button adds an item with a POST whose JSON body has two keys and loads both again, and the case ends with a reload. It is recorded against its backend and gated with the backend switched off. These pass: the unchanged page, a port that sends every GET twice, a port that sends the two GETs in the other order, a port that reorders the keys of its JSON body, a port that reorders its query parameters. A recording of a variant of the page that sends the list GET twice lets the page that sends it once pass.
3. In a copy of the verifier whose tape gives the Nth request of a key the Nth recorded answer and ignores the state, the port of item 2 that sends every GET twice fails, 3 of 3. On a page that polls a job with `setInterval`, where a click sends a GET that moves the job on, a port that polls twice as often and one that polls a third as often pass. Each step of that case is long enough for the slowest port to poll once, and ends on a frame in which no port polls, because the rest check of step 1 fails a step whose last frame holds a request. In a copy that leaves the step out of the state both ports fail, 3 of 3. The notes list what a port gets that polls through a timer that arms itself again. By the rule of step 1 (Q62) its timer counts until timers with that delay have fired twice in a step, so it can fail as not settled.
4. The rules of the tape have unit tests against a hand-written tape, without a browser. Each test fails when its rule is switched off: the epoch in the state, the step in the state, the sorted query, the sorted JSON keys, headers outside the key, the answer for a changed mutation.
5. Both mask pages of step 3 are recorded with their `noise` lists and gated with their API switched off. Both faithful pages pass. On the first mask page (`sites/r1`) the port that asks another endpoint (`get-other`) and the port with another multipart field (`form-field`) fail, and so do `sync-other` and `field` on `sites/notes`. The three ports that only leave out a GET (`get-none` and `get-noconfig` on `sites/r1`, `sync-none` on `sites/notes`) pass, and the report names the request that was not sent (Q74). A port of the Tasks fixture that never asks for the suggestions fails in the DOM.
6. Gated from the tape with the API switched off, a port that sends `?q=a%20b&tag=x` where the original sends `?tag=x&q=a+b` passes, for a GET and for a POST. A port that sends `?q=b` where the original sends `?q=a` fails.
7. On a page that sends `Authorization` with its GETs and not with its POST, `record` exits 0, and a search of the recording for the value of the header and for its SHA-256 finds nothing. A port that leaves the header off one GET fails and the report names the request and the header. A port that adds it to the POST fails, and so does one that adds `X-XSRF-TOKEN` to one request. A port that sends `Authorization` with another value passes, and the report says that values of credential headers were not compared.
8. A page that sends two requests at once and shows the answer that came last gives one end state and one root hash in 20 of 20 recordings, with a server that answers the first request 200 ms late. With that server switched off it passes against its own recording from the tape in 20 of 20 gates, and at CPU throttle rates 1, 8 and 20. A page that sends a POST and then, without waiting, the GET of its list records the list with the new item in 20 of 20 recordings, with a server that waits 200 ms after the POST arrives, then adds the item and answers the POST, and a port that waits for the answer of the POST before it asks for the list passes. A test fails when an answer from the tape is delivered before the timers that are due have run.
9. On the list page of item 2, `record` exits 0 with 0 masks although the backend is never reset, and the page passes against its own recording with the backend switched off in 10 of 10 gates. An original whose API returns a new id on every call records with 0 masks, and a port that shows another id than the one in the answer fails.
10. The list page of item 2 has a button that deletes an item with a request and does not ask for the list again. In a case that ends with that click, a port that asks for the list after the delete fails, and the report names the request and says that the tape has no answer for that state. With a reload as one more step of the case, that message is gone.
11. Four small pages (a WebSocket, an event stream, a `fetch` to another origin, an answer that sets a cookie): `record` exits 1 for each and names the request, 3 of 3, and the output of no run holds a value of the request or the value of the cookie. A port of the Tasks fixture that opens a WebSocket fails the gate in 10 of 10 runs.
12. Recording the three originals 5 more times gives the same root hash for every case, with the tape in the recording. Changing one byte of a stored answer makes `gate` exit 1 with a lock error, and exit 0 after the byte is back, 3 of 3.

### 5b: geometry in the same session (Q33, Q71 to Q73)

- Sizes, positions and screenshots are compared only against the original run again in the same session: `gate` and `replay` take `--original-url`. Everything else is compared against the stored recording as before. "Same session" means the same `gate` or `replay` command.
- The original is run again the way the port is run: the same case, the frames the recording holds (step 1), a fresh browser context in the same browser, and its requests answered from the same tape as the port, by the same rules. `--original-url` only has to serve the page and its files.
- The original run again is checked first. Its stored layers must equal the recording in every step, with the masks of the recording, and it has to be at rest after the stored frames. If they differ, if the page does not load or if a step fails on it, `gate` and `replay` exit 1. The report then says that the original at `--original-url` does not match its recording, names the first difference, and compares no size.
- Without `--original-url` sizes, positions and screenshots are not compared. The line of the summary that says PASS or FAIL says so, and `report.json` has a field for it. A screenshot is then counted as not compared, not as identical. The stable screenshot is still taken on the port in every gate, so both sides wait the same way in real time (step 1).
- Sizes are split by value first, by name second (Q71). The capture asks the browser twice: `getComputedStyle` gives the laid-out value, `computedStyleMap()` the declared one (`auto`, `50%`, `3px`). Where both give the same text, the value is stored as before. Where they differ, the declared value is stored and compared anywhere, and the laid-out value is compared only in the same session. A probe comes first. On the fixture it must show `auto` for `margin-left` on `main`, `3px` for `margin-left` on `.count` under the `style` bug, and `auto` for `left` on the toast.
- Where the probe fails, and for `::before` and `::after` (`computedStyleMap()` takes no pseudo-element), a fixed list of names is used. A longhand is on it when the browser took its value from layout, so that it changes with the fonts of the machine while the page and its CSS stay the same. The list is measured here, because the research read 71 of the 480 longhands on one app. It starts with `width`, `height`, `inline-size`, `block-size`, `perspective-origin`, `transform-origin`, `top`, `right`, `bottom`, `left` and the four `inset-*` longhands. One page made for it (a box that shrinks to its text, a positioned box, a grid with `auto` tracks, a percent `transform`, a `::before` with text) is captured with two fonts behind one family name, and every other longhand whose value differs joins the list. `m2/step5.md` holds the list and the measurement behind each name.
- The layer stays `style and geometry` and its paths stay as they are. Masks and `noise` entries apply to the comparison against the original run again as well.
- `record` no longer writes boxes, laid-out sizes or screenshots into the recording (Q73). The files that the lock hashes hold what a gate compares from them and nothing else, and the recording format gets a new version. `replay` and `gate` refuse a recording of an older format (one without a tape, or one that holds boxes or a PNG) and say that it has to be recorded again. `record` still compares sizes, positions and screenshots between its two runs, and those masks stay in the recording. When a screenshot differs in a gate with `--original-url`, the report folder gets both images of that run.

Done when:

1. With `--original-url` the three clean gates pass, and the `style` bug fails with the 8 differences per step that milestone 1 lists (`inline-size`, `margin-inline-start`, `margin-left`, `perspective-origin`, `transform-origin`, `width` and the box values `x` and `width`). Without it the `style` bug fails at `margin-left` and `margin-inline-start` and at nothing else, and the report says that sizes, positions and screenshots were not compared.
2. With `--original-url` and the mock API switched off the clean port passes for all three sources, sizes and positions included, and the fixture server counts 0 requests under `/api/`.
3. The test page for the list is captured with two fonts, once with the split by value and once with the list of names alone (the probe switched off, the list on every element). Both times the two captures differ in sizes and positions and in no stored value. With the list alone the test fails when any one name is taken off the list. A page with `margin-left: auto` in a flex row next to a text has the same stored value for it at two viewport widths.
4. No file under `recordings/` is a PNG, and no observation there holds a `box`. In the recordings of the Tasks fixture no observation holds a length for `width` or `margin-left` on `main` (today `480px` and `272px`), for `width` on `.count` (today `448px`) or for `left` on the toast (today `884.781px`): the declared value of each is `auto`. One changed byte of a recorded observation still gives a lock error. A recording made before step 5 is refused with a message that says to record again.
5. With the React recording, `--url` the clean port and `--original-url` the port with `?bug=text`, `gate` exits 1 and the summary names the original, not the port. The same with the stub page as the original. With `--original-url` on an original whose toast lasts 1000 ms, `gate` exits 1 with that message in 10 of 10 gates.
6. The ports `width-minus-half-px` and `width-minus-1px` and a port that scrolls the document by 40 px are gated with and without `--original-url`. With it all three fail. Without it the two width ports fail at `width`, because the declared value is stored (Q71). Each one that passes without it is listed in SPIKE-RESULTS.md under what a gate without the original does not cover. The port that scrolls is also gated once with itself as `--original-url`, and the result is listed there too: the check of the original reads stored layers only, so it cannot tell that port from the original.
7. A page with a box of random width records with `noise` for its paths and passes against itself with `--original-url` in 10 of 10 gates. With the masks left out of the comparison in the same session it fails in 10 of 10.
8. A second machine (Q72). The Docker daemon is started for this item. The three originals are recorded once more in the Linux container of the research (`node:24-bookworm-slim` with the Chromium of Playwright 1.65.1, the fixture server inside it), by a script of the repo that is not part of `pnpm test`. The script first shows that the two machines differ in sizes and in screenshots. Every observation file of the recording made there has the same SHA-256 as on this machine. Against the Linux recording the clean port passes on this machine, with and without `--original-url`, and the 8 seeded bugs fail in the layers of milestone 1. With the split of sizes switched off the clean port fails.
9. SPIKE-RESULTS.md lists under "Not covered", each with a small page and its numbers: a size that a script wrote into an inline `style`, a custom property, an attribute or a text is stored like any other value and can differ on another machine, and the limit of the list of names, for `::before` and `::after` and for every longhand for which the probe failed, with a port that shows it. `m2/step5.md` holds the result of the probe.

### 5c: secrets (Q38, Q78 to Q80)

- `record` refuses to write a recording that holds a detected secret. Detected means two checks. Both run on everything `record` is about to write or print for a case, keys as well as values. A body is checked as the page sent or got it, before it is encoded for a file. The starting point is `research/gap-recording-secrets-and-untrusted-content.md`.
- First, the credentials the run itself saw: every cookie value and every value of a credential header (of `authorization` the part after the scheme word). Each is searched as it is, JSON-escaped, URL-encoded, as base64, as base64url and as hex. A value shorter than 16 characters is not searched (a spike default, to be measured).
- Then patterns: a JWT, a PEM block, `Bearer` or `Basic` followed by a value, a URL with a user name and a password, and a value of 16 or more characters without white space that holds a letter and a digit, under a key whose name holds `token`, `secret`, `password`, `api_key` or `session` (without case). The patterns are the tool's own, and the README lists them. No package is added (Q80).
- A `localStorage` value is no credential by itself. It is a finding only when one of the two checks finds it.
- Typed secrets (Q78). A value in a field of type `password`, or in a field whose `autocomplete` holds `current-password`, `new-password`, `one-time-code`, `cc-number` or `cc-csc`, is a detected secret, whether the case typed it or the page filled it. `record` refuses a case that types into such a field before it types, and names the step and the target, not the value.
- A refusal leaves nothing behind. On a finding `record` exits 1 and leaves no recording for that case: nothing new is written, and the recording that was there is removed. No temporary file with a request, an answer or an observation is left.
- The message names the case, the step, the layer, the path and the kind of the finding. It holds no value, no part of a value and no hash of one. A key in the path is printed as a JSON string, and a key that is itself the finding is replaced by its kind.
- `--url` or `--original-url` with a user name or a password is a usage error (exit 2) for every command, and its message does not repeat the address. The query of `--url` is checked like everything else, before the first line is printed.
- False alarms (Q79). A case can accept single findings in a list `accept` of layer, path and kind, with `*` for any index, each with a reason. The list is part of `case.json`, so the lock covers it. There is no option that accepts every finding. `record` prints each accepted finding without its value.
- `record`, `replay` and `gate` write no Playwright storage state, no trace, no HAR and no video.

Done when:

1. One page shows a token in a text node, in an attribute, in the value of a hidden input, in a CSS custom property, in a `localStorage` value, in a `localStorage` key, in the query of the page URL, in the URL of a request, in the body of a request, in an event payload and in the body of an answer, one case per place. Each case is recorded once with a JWT and once with a string of 32 letters and digits that the page also sends as its `Authorization` header. Both tokens are the same on every load, so the noise rule of step 3 does not fire. `record` exits 1 in 22 of 22 and names the case, the step, the layer and the path (where the token is a key, its kind in place of the key). The output (stdout and stderr) of each of the 22 runs does not hold the token.
2. The same page without the token records with exit 0 and no finding. So do the Tasks fixture, both mask pages of step 3 and the page of the end-to-end test, the last three with their `noise` named, and a page that shows a UUID, a SHA-256, a `data:` URL, the word `token` and a cookie `theme=dark` that its script sets next to the word `dark`.
3. Each check has a test that fails when the check is switched off. A fixed string of 32 letters and digits that the page sends as its `Authorization` header and writes to `localStorage` under the key `ref` is found by the first check only. A JWT that is no credential of the run is found by the second only. Each other rule of this part has a unit test that fails when the rule is switched off.
4. A page sends `Authorization`, `X-Api-Key`, `X-XSRF-TOKEN` and a cookie that its script set, and gets `WWW-Authenticate`, each with a token of its own that shows nowhere else. `record` exits 0, and a search of the recording for the five tokens finds nothing.
5. A case that fills a password field is refused with exit 1. Neither the output of `record` nor any file below `recordings/` or `reports/` holds the typed value.
6. After each refused `record`, a search of `recordings/`, `reports/` and the temporary folder for the token (as written, URL-encoded and as base64) finds nothing, `recordings/<source>/<case>` does not exist, and a `gate` right after it exits 1 for that case.
7. `record` with a token in the query of `--url` exits 1, and `record` with a user name and a password in `--url` exits 2. The output of neither run holds the token or the password. `gate` with a user name and a password in `--original-url` exits 2, and its output does not hold the password.
8. A page with a value that the pattern check takes for a token records with exit 0 when the case accepts that path. Without the entry, and with an entry for another path, `record` exits 1.
9. A page whose hidden input holds a token that changes with every load, and that the page also sends as its `Authorization` header, records with exit 0 when the case names that path as noise, and a search of the recording for the token finds nothing. Without the `noise` entry `record` exits 1. Both mask pages of step 3 still record with exit 0 when their `noise` is named.
10. A search of `src/` for `storageState`, `tracing`, `recordHar`, `recordVideo` and `routeFromHAR` finds nothing. The `dependencies` of `package.json` still hold `playwright` and nothing else, and a search of `pnpm-lock.yaml` for `secretlint` finds nothing. The README lists every pattern of this part.

### Done when, for the whole step

1. The experiments that Q47 names are tests in this repo, as far as the steps of the case format can write them: the network tape (5a, items 2 and 3) and the gate calibration (section 4 of its report, two machines, run on the Tasks fixture: 5b, item 8. Its TodoMVC builds stay out of this milestone). The clock is step 1. Section G of `experiments/netreplay/exp/run3.mjs` (the tape with fakes) becomes a test only when fakes are built. The secrets report has no experiment: its rules are measured by 5c, item 1. The notes of step 5 list every case that is left out and the step it needs.
2. The done-items of steps 1 to 4 still hold when their gates are run with `--original-url`, with the numbers those steps measured. The same gates are run once without it, and every exit code that changes is listed with its reason. Not measured again are the done-items that compare with the tree before their own step (step 1, item 13). The done-items of 5a and 5b are measured again after 5c. Two checks of milestone 1 change their form, because a recording holds no PNG any more: the three clean gates show all screenshots identical when run with `--original-url`, and the changed byte in a PNG becomes a changed byte in the tape (5a, item 12). One change is decided (Q74): from this step on, done-item 1 of step 3 is measured without the three ports that only leave out a GET (`sync-none` on `sites/notes`, `get-none` and `get-noconfig` on `sites/r1`), and SPIKE-RESULTS.md lists them under "Not covered". A second change follows from Q76: a page whose two recording runs differ only in what its API answers can be recorded from this step on. Each page of steps 1 to 4 that changes this way is listed.
3. Each rule of 5a, 5b and 5c has a test that fails when the rule is switched off. That is checked by switching it off.

## Step 6: measure and review

SPIKE-RESULTS.md is written again for the code as it then is, in the form of milestone 1: verdict, gate matrix, timings, what each step changed, what is not covered, open points. The 53 ports with one defect of milestone 1, the 16 toast ports, the 5 late ports and the page pairs of the second review are gated again, with `--original-url`. Then reviewers who did not build it go through all of it, and what they find is fixed or listed.

The list of what is not covered names, each with a page and its numbers where a page can show it, and by name where none can (a command, a file or a step that is not built): what "Also not in this milestone" lists below, what the steps above send there, the values of credential headers, a header of an answer that the tape does not keep, and what the route hides (what the HTTP cache would have answered, because routing switches the cache off on both sides, and preflights, which the route never sees).

## Not in this milestone

TodoMVC, sonner, the porting skill, the MCP server, `setup` and `review`, CI, publishing to npm, and any git operation.

Also not in this milestone, each measured and named so that step 6 can list it under "Not covered":

- Work that runs outside page time and is no motion (Q69): an answer or a timer of a worker, `scheduler.postTask` with a delay, a message of a WebSocket, a job that hops through `MessageChannel`, `createImageBitmap`, `document.timeline`, a `meta` refresh, and animations inside an iframe (screenshots only). The first goal line does not hold for such a page: its exit code can follow the load of the machine.
- Requests that stay open or follow each other without an end: long polling and server-sent events. Such a page fails its step by name. Also WebSockets, an API on another origin and cookies that an answer sets: `record` refuses such a case by name (Q77). Until step 5 refuses it, a message of a WebSocket is work outside page time as in the bullet above.
- Of the secrets report only what step 5 names is built. Not built: replacing secrets by fakes (so no recording of a login and no comparison of the values of credential headers), detectors for personal data, the question before recording a host that is not local, blocking third-party origins, a `check` command, limits and escaping for page text in reports, a secret check on what `replay` and `gate` print and store, `SECURITY.md` and the container recipe.
- Steps for pointer paths with times, touch, wheel, hover, long press, typing key by key, clipboard, IME and file drop, the trusted flag of an event, and a hold between key down and key up (measured in `research/gap-time-and-input-fidelity.md` and `research/gap-gate-calibration-spike.md`).
