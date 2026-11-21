# Spike results, milestone 1

Measured on 2026-11-21 between 03:07 and 05:27 local time, on one machine, after the review of this milestone and with the code as it is now. Every number below comes from a command that was run for this file. Where a number describes the code before the review, the sentence says so. Nothing is estimated unless the sentence says so.

## Verdict

All seven "Done when" items of [SPIKE.md](SPIKE.md) hold.

| # | Item | Result | Measured |
|---|---|---|---|
| 1 | `pnpm test` passes | yes | 46 of 46 tests, 58.4 s. Four more runs: 46 of 46 each. `pnpm typecheck` exits 0. |
| 2 | All four fixture apps build and serve | yes | `pnpm fixtures:build` exits 0 in 1.3 s. Ports 4101 to 4105 answer 200 for `/`, 201 with the posted body for `POST /api/tasks` and the two suggestions for `GET /api/suggestions` after 152 to 153 ms. |
| 3 | Record each original, gate against the port exits 0 | yes | React, Vue, AngularJS: 9 of 9 cases recorded with 0 masked paths, gate exit 0, 0 of 29 steps differ, 29 of 29 screenshots identical. Repeated 10 times per source afterwards: 30 of 30 exit 0. |
| 4 | Each seeded bug: gate exits 1 and names the layer | yes | 24 of 24 gates (8 bugs, 3 sources) exit 1. The failing layers are the expected ones, see the table below. |
| 5 | One changed byte makes gate exit 1 with a lock error | yes | 3 of 3. The message is `lock: 03.json does not match its SHA-256 in lock.json`. With the byte restored the gate exits 0 again, 3 of 3. |
| 6 | A page with an empty `<main>` passes no case | yes | 9 of 9 cases fail for each source, exit 1. |
| 7 | This file | yes | |

Four things to know before relying on that:

1. Three reviewers went through the first version of this milestone. They built ports with one defect each, 53 with the three added here. Before the review 29 of them passed the gate (measured with the React recording), now 13 pass for all three sources, and each of the 13 is in the "Not covered" list with its measurement. What was changed is in the next section.
2. The clock that keeps flowing makes the exit code for a timing difference depend on how fast the machine and the verifier are. A port whose toast lasts 1200 to 3200 ms passes against an original with 2000 ms. This is the spike default from SPIKE.md and it is not changed. Details are under "Spike defaults, measured".
3. One fix has a price. Screenshots are now taken until two in a row are identical. That made all 29 screenshots byte identical in every run, and it makes a gate take 10.3 s where one screenshot per step takes 6.1 s. Under the flowing clock it also moves every timing window. This is open point 1.
4. Two places differ from the wording of SPIKE.md. The verifier now captures the `html` element and not only `body`, and the layer for the `focus` bug is the field `focus` of the side effects. Both are under "Spec points".

## What the review found and what was done

Each finding was reproduced first. "Before" is measured with the code and the recordings from before the review, "after" with the code as it is now. Ports with one defect were built in a scratch folder and gated with the real CLI.

| Finding | Before | What was done | After |
|---|---|---|---|
| Major. CSS outside the 69 properties that were read passes every hard layer, for example `.tasks { filter: opacity(0) }`, which hides the list | 8 of 8 such ports exit 0 | Fixed. The verifier reads every computed longhand (480 in Chromium 159, plus custom properties) of every element and of each `::before` and `::after` that has content | 24 of 24 gates exit 1 (8 ports, 3 sources). The first difference names the longhand, for example `ul[1].style.filter`: expected `"none"`, actual `"opacity(0)"` |
| Major. Nothing outside `body` is observed: style and attributes of `html`, the document title, nodes appended to `html` | 4 of 4 ports exit 0 | Fixed. The capture starts at `html` and leaves out `head`. The document title is a field of the side effects | 12 of 12 gates exit 1. `head` apart from the title is listed under "Not covered" |
| Major. Framework name rules ran on every page, the port included, against the binding decision | Ports with leftover `ng-*` attributes or classes: 2 of 2 exit 0. On a page without any framework, `ng-*`, `data-v-*` and `_ngcontent-*` gave no difference | Fixed. A mark is dropped only where the framework is proven for the element: AngularJS by the injector of the element, Vue by `__vue_app__` and Angular by `__ngContext__` on the root element. The rules for `_ngcontent-*`, `_nghost-*`, `ng-reflect-*`, `data-v-<hash>` and React `useId` are removed | 6 of 6 gates exit 1. A port with emulated view encapsulation now fails as well, 3 of 3, which enforces a binding decision |
| Major. The AngularJS directive rule removed native attributes: a port without a `title` passed, a faithful port failed | Probe: the broken port gave no difference, the faithful port 2 differences | Fixed. The name of a directive and a text binding (`@`) stay in the DOM when the browser reads the attribute too (`aria-*`, `role`, or a property of the element). Expression bindings are always dropped | The reviewer's CLI scenario: port without `name` and `draggable` exits 1, faithful port exits 0 |
| Major. Two fresh recordings of the same original did not give the same root hash for `add-empty` | 25 of 27 roots equal between two fresh recordings, 24 of 27 against the stored ones | Fixed. The screenshot is taken again one quiet period later until two in a row are identical. The validation bubble of the browser fades in for about 1.2 s and was captured halfway | 15 more recordings: 27 of 27 roots equal to the stored ones each time, 0 masks. The cost is open point 1 |
| Major. The exit code for a timing difference depends on machine speed | Toast of 800 ms fails, 900 and 2900 pass, 3000 fails (4 runs each) | Not fixed. SPIKE.md names the flowing clock as the default to measure. Measured again, see "Spike defaults, measured" | Listed under "Not covered" |
| Minor. "A port that never disables the button passes" was wrong | That port fails at `focus`. A port that never sets `aria-busy` passes | The sentence is corrected. States of one frame are listed | Listed under "Not covered", 3 ports, 9 of 9 gates exit 0 |
| Minor. Dialogs and new windows are not observed | `alert` on every add and `window.open` on every add: exit 0 | Listed. Logging them needs a way for a case to accept a dialog | 6 of 6 gates exit 0 |
| Minor. Effects after the last settle of a case, and a port that behaves differently under the verifier | Both ports exit 0 | Listed | 6 of 6 gates exit 0 |
| Minor. The 0.5 px tolerance lets a 0.5 px change pass | Port with a width of 100% minus 0.5 px: exit 0 | The tolerance is not changed, it is a default from SPIKE.md. Sizes are now also compared as exact strings | That port fails 3 of 3: `p[1].style.inline-size` expected `"448px"`, actual `"447.5px"` |
| Minor. Deleting a case folder made a failing port pass. A recording was not tied to its suite and source | 3 of 3 such gates exit 0 | Fixed. `gate` fails when `recordings/<source>` holds a recording of the suite without a case. `replay` and `gate` refuse a recording made for another suite, source or case | 3 of 3 exit 1 |
| Minor. A gate that failed before the replay left the PASS report of an earlier run | `report.json` still said `pass` | Fixed. The report folder is removed before the suite is loaded | No report is left |
| Minor. Normalizer rules and step code that nothing reaches | Read in the code | The three name rules above are removed, and the test markup is now what the built fixtures leave. The rest is kept and listed under "Not covered" | |
| Minor. Six failure paths were executed by no test | None of the six messages appeared in a test | Tests added for all six | 46 tests, 38 before |
| Minor. `ng new` leftovers in the Angular fixture | `@angular/forms` and `@angular/router` are imported nowhere | Removed both, the unused `angular.json` entries and the generator comments. `app.config.ts` is kept, it is the CLI default | `main-2ZB4IMST.js` has the same SHA-256 as before |
| Minor. Every run opens UDP sockets toward a public address | The review counted 4 per gate, with 0 bytes sent | No code change. It is Chromium's IPv6 reachability check | One gate: 6 sockets toward a public resolver address, 0 with a bytes sent or received event. Every URL in the browser's network log is on `http://localhost:4104`. Node itself opens no connection |
| Minor. Three imprecise statements and two wrong size figures in this file | | Corrected in this version: sizes are given in one measure, and the two statements about masks and about the old settle rule are measured again below | |

## Setup

- Apple M4, 10 cores, 16 GB, macOS 27.3 (Darwin 27.3.0, arm64).
- Node 24.15.0, pnpm 12.18.0, Playwright 1.65.1, Chromium 159.0.8154.6 (headless), one viewport of 1024 x 768.
- The 1 minute load average was between 1.6 and 3.2 for everything that is timed below. The 162 gates of the defect ports and the rule table ran five at a time at a load average between 4 and 5, and only their results are used, not their times.

Commands, in this order, from the project folder:

```sh
pnpm fixtures:build
node fixtures/server.ts &            # all five ports, stopped at the end
pnpm typecheck
pnpm test
node src/cli.ts record fixture --source react     --url http://localhost:4101
node src/cli.ts record fixture --source vue       --url http://localhost:4102
node src/cli.ts record fixture --source angularjs --url http://localhost:4103
node src/cli.ts gate fixture --source <source> --url http://localhost:4104
node src/cli.ts gate fixture --source <source> --url 'http://localhost:4104/?bug=<bug>'
node src/cli.ts gate fixture --source <source> --url http://localhost:4105
```

`pnpm aa <command>` runs the same thing and keeps the exit code (checked with a clean gate, exit 0, and `?bug=aria`, exit 1). `pnpm aa doctor` reports Node, Playwright and Chromium as ok.

The suite is `cases/fixture`: 9 cases, 29 steps. The recordings in `recordings/` are the ones from this pass. They are what the matrix below was gated against.

Everything else (repeated runs, the ports with one defect, the copies of the verifier with one rule switched off, the ten extra cases) ran from a scratch folder outside the project. Those scripts and outputs are not kept in the repository.

## Gate matrix

Load average 1.8 to 3.2.

| Source | Variant | Exit code | Cases failed | Steps that differ | Failing layers (differences) | Screenshots identical / different / masked | Wall time, s |
|---|---|---|---|---|---|---|---|
| react | clean port | 0 | 0 of 9 | 0 of 29 | none | 29 / 0 / 0 | 10.3 |
| vue | clean port | 0 | 0 of 9 | 0 of 29 | none | 29 / 0 / 0 | 10.4 |
| angularjs | clean port | 0 | 0 of 9 | 0 of 29 | none | 29 / 0 / 0 | 10.3 |
| react | ?bug=double-event | 1 | 1 of 9 | 2 of 29 | events (2) | 29 / 0 / 0 | 10.4 |
| react | ?bug=missing-class | 1 | 9 of 9 | 27 of 29 | DOM (28), style and geometry (560) | 2 / 27 / 0 | 10.4 |
| react | ?bug=aria | 1 | 1 of 9 | 1 of 29 | accessibility (2), DOM (1) | 29 / 0 / 0 | 10.3 |
| react | ?bug=text | 1 | 9 of 9 | 21 of 29 | accessibility (21), DOM (21) | 8 / 21 / 0 | 10.1 |
| react | ?bug=request | 1 | 2 of 9 | 2 of 29 | side effects (2) | 29 / 0 / 0 | 10.4 |
| react | ?bug=storage | 1 | 4 of 9 | 9 of 29 | accessibility (3), DOM (2), style and geometry (33), side effects (9) | 28 / 1 / 0 | 10.2 |
| react | ?bug=focus | 1 | 1 of 9 | 2 of 29 | style and geometry (8), side effects (2) | 27 / 2 / 0 | 10.1 |
| react | ?bug=style | 1 | 9 of 9 | 29 of 29 | style and geometry (232) | 0 / 29 / 0 | 10.1 |
| vue | ?bug=double-event | 1 | 1 of 9 | 2 of 29 | events (2) | 29 / 0 / 0 | 10.3 |
| vue | ?bug=missing-class | 1 | 9 of 9 | 27 of 29 | DOM (28), style and geometry (560) | 2 / 27 / 0 | 10.4 |
| vue | ?bug=aria | 1 | 1 of 9 | 1 of 29 | accessibility (2), DOM (1) | 29 / 0 / 0 | 10.3 |
| vue | ?bug=text | 1 | 9 of 9 | 21 of 29 | accessibility (21), DOM (21) | 8 / 21 / 0 | 10.3 |
| vue | ?bug=request | 1 | 2 of 9 | 2 of 29 | side effects (2) | 29 / 0 / 0 | 10.5 |
| vue | ?bug=storage | 1 | 4 of 9 | 9 of 29 | accessibility (3), DOM (2), style and geometry (33), side effects (9) | 28 / 1 / 0 | 10.3 |
| vue | ?bug=focus | 1 | 1 of 9 | 2 of 29 | style and geometry (8), side effects (2) | 27 / 2 / 0 | 10.2 |
| vue | ?bug=style | 1 | 9 of 9 | 29 of 29 | style and geometry (232) | 0 / 29 / 0 | 10.2 |
| angularjs | ?bug=double-event | 1 | 1 of 9 | 2 of 29 | events (2) | 29 / 0 / 0 | 10.3 |
| angularjs | ?bug=missing-class | 1 | 9 of 9 | 27 of 29 | DOM (28), style and geometry (560) | 2 / 27 / 0 | 10.4 |
| angularjs | ?bug=aria | 1 | 1 of 9 | 1 of 29 | accessibility (2), DOM (1) | 29 / 0 / 0 | 10.3 |
| angularjs | ?bug=text | 1 | 9 of 9 | 21 of 29 | accessibility (21), DOM (21) | 8 / 21 / 0 | 10.2 |
| angularjs | ?bug=request | 1 | 2 of 9 | 2 of 29 | side effects (2) | 29 / 0 / 0 | 10.3 |
| angularjs | ?bug=storage | 1 | 4 of 9 | 9 of 29 | accessibility (3), DOM (2), style and geometry (33), side effects (9) | 28 / 1 / 0 | 10.2 |
| angularjs | ?bug=focus | 1 | 1 of 9 | 2 of 29 | style and geometry (8), side effects (2) | 27 / 2 / 0 | 10.2 |
| angularjs | ?bug=style | 1 | 9 of 9 | 29 of 29 | style and geometry (232) | 0 / 29 / 0 | 10.2 |
| react | empty stub page (port 4105) | 1 | 9 of 9 | 9 of 9 | accessibility (189), DOM (90), style and geometry (405) | 0 / 9 / 0 | 2.3 |
| vue | empty stub page (port 4105) | 1 | 9 of 9 | 9 of 9 | accessibility (189), DOM (90), style and geometry (405) | 0 / 9 / 0 | 2.3 |
| angularjs | empty stub page (port 4105) | 1 | 9 of 9 | 9 of 9 | accessibility (189), DOM (90), style and geometry (405) | 0 / 9 / 0 | 2.2 |
| react | clean port, one recorded byte changed | 1 | 1 of 9 | 0 of 24 | none compared, lock error | 24 / 0 / 0 | 8.8 |
| react | clean port, byte restored | 0 | 0 of 9 | 0 of 29 | none | 29 / 0 / 0 | 10.3 |
| vue | clean port, one recorded byte changed | 1 | 1 of 9 | 0 of 24 | none compared, lock error | 24 / 0 / 0 | 8.7 |
| vue | clean port, byte restored | 0 | 0 of 9 | 0 of 29 | none | 29 / 0 / 0 | 10.3 |
| angularjs | clean port, one recorded byte changed | 1 | 1 of 9 | 0 of 24 | none compared, lock error | 24 / 0 / 0 | 8.9 |
| angularjs | clean port, byte restored | 0 | 0 of 9 | 0 of 29 | none | 29 / 0 / 0 | 10.3 |
| react | clean port, one byte of a case changed | 1 | 1 of 9 | 0 of 26 | none compared, lock error | 26 / 0 / 0 | 9.6 |
| react | clean port, case restored | 0 | 0 of 9 | 0 of 29 | none | 29 / 0 / 0 | 10.3 |

For each variant the exit code, the cases, the steps, the differences per layer and the screenshots are the same for all three sources. That follows from the recordings: all 29 recorded observations and all 29 screenshots are byte for byte the same in `recordings/react`, `recordings/vue` and `recordings/angularjs`.

The changed byte is in `recordings/<source>/add-task/03.json`. After restoring it the SHA-256 of the file was compared with its entry in `lock.json` before the gate ran again.

### Seeded bugs: expected layer against what failed

| Bug | Layer that must fail (SPIKE.md) | Layers that failed | First difference in the report |
|---|---|---|---|
| double-event | events | events | `toggle-task` step 2, `[1]`: expected nothing, actual `{"name":"taskToggled","payload":{"id":1,"done":true}}` |
| missing-class | DOM and style | DOM, style and geometry | `ul[1]/li[2].attrs.class`: expected `"is-done task"`, actual `"task"`. `li[2]/label[1].style.border-block-end-color`: expected `rgb(107, 114, 128)`, actual `rgb(17, 24, 39)` |
| aria | accessibility | accessibility, DOM | `details` step 2, `tree/main[1]/button[1].expanded`: expected `true`, actual nothing. `button[1].attrs.aria-expanded`: expected `"true"`, actual `"false"` |
| text | accessibility and DOM | accessibility, DOM | `tree/main[1]/paragraph[1].text`: expected `"1 task left"`, actual `"1 tasks left"` |
| request | side effects | side effects | `add-reload` step 3, `requests[0].body.title`: expected `"Call mom"`, actual nothing |
| storage | side effects | side effects, and after the reload also accessibility, DOM, style and geometry | `add-reload` step 3, `storage.tasks`: expected the list of three tasks, actual nothing |
| focus | focus | side effects (field `focus`), style and geometry | `delete-task` step 2, `focus`: expected `html[1]/body[1]/div[1]/main[1]/form[1]/input[1]`, actual `html[1]/body[1]`. Also `input[1].style.outline-color`: expected `rgb(29, 78, 216)`, actual `rgb(17, 24, 39)` |
| style | style and geometry | style and geometry | `p[1].style.inline-size`: expected `"448px"`, actual `"445px"` |

The `text` bug differs in 21 of 29 steps, not in all, because it only shows when exactly one task is active.

The first difference of a layer is the first in the order in which Chromium lists the longhands, which is alphabetical. So the `style` bug, `margin-left: 3px`, is reported first as `inline-size`, and the `missing-class` bug as a border color that follows the text color. `report.json` holds the first ten differences of each layer. For the `style` bug they are 8 per step: `inline-size`, `margin-inline-start`, `margin-left`, `perspective-origin`, `transform-origin`, `width` and the box values `x` and `width`.

### Other exit codes checked

| Run | Exit code | Output |
|---|---|---|
| `gate` on a suite folder with no cases | 1 | `FAIL  the suite none has no cases` |
| `gate` on a suite that does not exist | 2 | usage |
| `gate` for a source that was never recorded | 1 | `lock: no readable lock.json: record the case first`, 9 of 9 cases failed |
| `gate` after one byte of `cases/fixture/details/case.json` changed | 1 | `lock: stale: case.json changed after the recording` |
| `gate` with a `case.json` that is not JSON | 1 | `gate failed: ...case.json: ...`. No report is left from the run before |
| `gate` with `recordings/copy` copied from `recordings/react` | 1 | `error: cannot replay against the recording: it was made for suite fixture, source react, case add-empty`, 9 of 9 cases failed |
| `gate` on a second suite that reuses the case id `details` | 1 | the same message for that case |
| `gate` after `cases/fixture/toggle-task` was deleted and its recording kept | 1 | `FAIL  toggle-task`, `lock: the suite fixture has no case for this recording` |
| `replay fixture --source react` against the clean port | 0 | writes `reports/react/report.json` and `summary.txt` |

When one case is refused for its lock, the other eight are still replayed, and the exit code is 1.

## Timings

Wall time of the whole command, including the start of Node and Chromium.

| What | Load average | Time |
|---|---|---|
| `pnpm fixtures:build` (four fixtures) | 2.6 | 1.3 s |
| `pnpm typecheck` | 2.6 | 0.6 s |
| `pnpm test` (46 tests), five runs | 1.8 to 3.0 | 58.1 to 58.8 s |
| `record`, react (9 cases run twice, 58 steps) | 2.4 | 19.1 s |
| `record`, vue | 2.6 | 18.9 s |
| `record`, angularjs | 2.7 | 19.0 s |
| `record`, 15 more runs (5 per source) | 2.0 to 2.8 | 18.6 to 19.2 s |
| `gate`, clean port, per source | 2.4 to 2.5 | 10.3 s, 10.4 s, 10.3 s |
| `gate`, seeded bugs, 24 runs | 2.1 to 2.7 | 10.1 to 10.5 s |
| `gate`, stub page | 2.2 | 2.2 to 2.3 s |
| `gate`, clean port, 10 more runs per source | 1.6 to 2.9 | react mean 10.4 s (10.2 to 10.8), vue mean 10.3 s (10.2 to 10.6), angularjs mean 10.3 s (10.2 to 10.4) |

Before the review a gate took 5.8 s, a recording 9.5 s and the tests 30.4 s. A copy of the present verifier that takes one screenshot per step needs 6.1 s for a gate and 10.0 to 10.1 s for a recording. So reading every longhand costs about 0.3 s per gate, and the stable screenshot the rest.

Where the time of the stable screenshot goes, counted in three gate runs with the same result each time: 21 of 29 steps need 2 screenshots (78 to 169 ms), 7 steps need 3 (177 to 265 ms) and 1 step needs 14 (1.2 s), in total 4.8 s per run. The 7 steps are the ones that end with the focus in the text field (three fills, two adds, two deletes). There the second screenshot differs from the first in 2 pixels of the focus outline, with a largest channel difference of 7, and every later one equals the second. Playwright changes the `style` attribute of each input while it takes a screenshot (6 mutation records per screenshot on this page). The step with 14 screenshots is the validation bubble.

Settle time per step, from the 30 repeated clean gate runs (870 steps): median 119 ms, shortest 95 ms, longest 290 ms. Observations needed until two in a row matched: 2 in 510 steps, 3 in 282, 4 in 78. No step came near the 5000 ms limit.

| Kind of step | Median settle, ms | Median observations |
|---|---|---|
| goto, reload | 102 to 124 | 2 |
| fill | 102 to 107 | 2 |
| advance | 109 to 110 | 2 |
| click that changes nothing (`add-empty`) | 103 to 113 | 2 |
| click, check or uncheck that changes the page, no request | 172 to 192 | 3 |
| click Add (one POST) | 280 to 281 | 4 |
| click Load suggestions (one GET, 150 ms) | 285 | 4 |

A click that changes the page needs three observations against the Angular port and two against each original (last step of `details`, 20 runs per implementation, 20 of 20 each time). The port renders after the first observation, so that one still shows the old state.

Size: the three recordings hold 8,965,965 bytes in 228 files: 6,933,252 bytes of observation JSON, 2,003,523 of PNG and 29,190 of `recording.json` and `lock.json`. `du -sh recordings` prints 9.1M, because it counts allocated blocks. With 69 properties per element the same files held 9,544,829 bytes before the review. An element now lists only the longhands whose value differs from its parent element, 55 on average. In the first state that is 1,595 of 13,920 values (29 elements with 480 longhands each). Computed style is 91.6 percent of an observation, measured on compact JSON over the 29 observations of one source.

## Noise between runs and the A/A mask

`record` runs each case twice and masks what differs.

- The stored recordings have no masked path at all: 27 of 27 `recording.json` files hold an empty list.
- In all 68 gate runs of the matrix and its repeats the line "Differences ignored because the original itself varied between its two recording runs" says 0, and the screenshot line of the 37 clean runs says 29 identical.
- Recording again gives the same bytes. 15 more recordings (5 per source) matched the stored ones in 29 of 29 observations and 29 of 29 screenshots, with the same root hash for 27 of 27 cases each time.
- Recording the Angular port as if it were an original gives the same bytes too: 29 of 29 observations and 29 of 29 screenshots are identical in all four implementations.
- Before the review one screenshot was noise: Chromium's own "Please fill out this field." bubble at `add-empty` step 2. Measured now: after the click the bubble changes every 50 ms for about 1.2 s (25 different images in each of 3 runs) and then stays as it is, with the same final image in all 3 runs. One screenshot right after the step caught it halfway. Two recording runs could catch the same frame, and then the noise was stored and hashed without a mask.
- With a second screenshot one animation frame later and no further wait, the loop stopped on an image that was not the final one in 14 of 20 runs, because the bubble only changes every 50 ms. With the quiet period of the settle rule in between it reached the final image in 10 of 10 runs. That is why the screenshot waits a whole quiet period.

A masked path is not compared at all, and `record` prints every mask and still exits 0. No recording of this pass has a mask in a hard layer. The first version of this file said about an earlier recording with 23 hard layer masks that a port that never loads the suggestions would have passed. The review measured that this was too wide: with those masks a port that sends the request and never shows the answer passed, and one that never sends it failed at `gets[0]`. Against the recordings of this pass both ports fail, for all three sources. The only hard layer masks of this pass are the ones the end-to-end test provokes on purpose: its page has an attribute that differs on every load, and the gate then reports 8 ignored differences.

## Changes made in this step

No case was changed, and no tolerance. The fixture sources are untouched apart from the Angular clean-up listed below.

- `src/page.ts`. Reads every computed longhand of every element and stores, per element, the ones whose value differs from the parent element. Captures `::before` and `::after` when they have content. Starts at `html` and leaves out `head`. Returns the document title. Drops a framework mark only where the framework is proven for the element, and keeps an attribute of an AngularJS directive when the browser reads it too. The list of 69 properties, the three name rules without evidence and the `useId` rename are gone.
- `src/compare.ts`. Gives every element the longhands of its parent back before comparing, so a difference is reported with the path of the element and the name of the longhand. The side effects have the field `title`.
- `src/run.ts`. Takes the screenshot again after one quiet period until two in a row are identical. After 5000 ms it keeps the last one.
- `src/replay.ts`. Removes the old report before the suite is loaded. Refuses a recording that was made for another suite, source or case. With `gate`, a recording of the suite without a case fails the run.
- `test/`. 46 tests, 38 before. New: the proof for each framework mark, the native attributes of AngularJS directives, the `html` element and the title, every longhand and the pseudo-elements, the inherited longhands in the comparison, a page that never settles, a missing target while recording, a recording with the wrong number of steps or the wrong source, a recording without a case, a case that cannot be read, a lock in another format. The page of the end-to-end test now repaints a part of its canvas for 10 frames after two of its steps, so its tests fail when the screenshot is taken only once: 3 of 3 runs of a copy with one screenshot fail 3 tests each.
- `fixtures/angular`. `@angular/forms` and `@angular/router` are removed from `package.json` and the lockfile (together with `@standard-schema/spec`, which only the forms package needed), the unused generator defaults and the development configuration from `angular.json`, and the two comment lines from each tsconfig. The build output is byte for byte the same as before.
- `README.md`. Says what is compared and names `summary.txt`.
- `recordings/`. Recorded again with the final code.

### The settle rule from the first pass

The first pass changed the settle rule: two observations in a row must be identical, and between them no request may be in flight, start or end and the DOM may not mutate. Measured again on the final code:

- With the request counter removed in a copy, the end-to-end test file fails in 3 of 3 runs (6, 7 and 3 of its 20 tests). With the rule as it is, `pnpm test` passed in 5 of 5 runs.
- 400 runs of the `Load suggestions` step on the Vue fixture gave 0 wrong results with the rule, and 0 wrong results without the request counter as well. The first pass had seen 2 wrong results in 600 runs without it. An observation takes longer now, and the loop on this step no longer shows the fault. The test page does.
- Chromium reports a request whose answer is not read as finished 50 to 52 ms after the answer arrived (5 requests), against 0 ms when it is read (5 requests). The test page reads the answer for that reason.

Limit that stays: the rule waits one quiet period after a request and after an action (50 ms, one frame, one timer). A page that renders later than that is observed too early, see "Spike defaults, measured".

## Normalizer rules, with evidence

The column "without it" is measured: the rule was switched off in a copy of the verifier, the three originals were recorded again with that copy, and each recording was gated against the clean port. Paths are shortened, they start at `html[1]/body[1]`.

| Rule | What it meets in this fixture | Gate without it: react / vue / angularjs | First difference without it |
|---|---|---|---|
| Ignore `script`, `style` and `link` elements (from SPIKE.md) | Angular CLI puts `<script src="main-2ZB4IMST.js" type="module">` into `body`, AngularJS has two scripts there | fail / fail / fail | `body[1]/script[1]`: expected nothing, actual the script of the port |
| Leave out `head` | two `meta` elements and the `title`, the same in all four | pass / pass / pass | none. Not needed by this fixture, see open point 4 |
| Drop comment nodes | Angular: one `<!---->` at the end of `div.filters`, `ul.tasks` and `ul.suggestions`. AngularJS: `<!-- ngRepeat: ... -->` and `<!-- end ngRepeat: ... -->` | fail / fail / fail | `main[1]/div[1]/#comment[1]` |
| Drop empty text nodes | Vue: six, the first and last child of `div.filters`, `ul.tasks` and `ul.suggestions`. Angular and AngularJS: one inside `div.toast` while no toast shows | fail / fail / pass | `main[1]/div[2]/text()[1]`: expected nothing, actual `""` |
| Drop text that is only whitespace | Only in `body`, from the line breaks of `index.html` around the ignored scripts | pass / pass / fail | `body[1]/text()[2]` |
| `data-v-app`, on an element that has `__vue_app__` | `#root` of the Vue fixture | pass / fail / pass | `div[1].attrs.data-v-app`: expected `""`, actual nothing |
| `ng-*` and `data-ng-*` attributes, on an element with an AngularJS injector | `ng-submit`, `ng-model`, `ng-class`, `ng-click`, `ng-repeat`, `ng-checked`, `ng-disabled`, `ng-attr-hidden`, `ng-attr-aria-busy` | pass / pass / fail | `form[1].attrs.ng-submit`: expected `"$ctrl.add()"`, actual nothing |
| `ng-version`, on an element that has `__ngContext__` | `ng-version="22.3.0"` on `#root` of the port | fail / fail / fail | `div[1].attrs.ng-version`: expected nothing, actual `"22.3.0"` |
| AngularJS directive attributes, proven through the injector of the page | `tasks-app` on `#root`, and `task-row`, `task`, `on-toggle`, `on-delete` on each `li` | pass / pass / fail | `div[1].attrs.tasks-app` |
| AngularJS classes `ng-scope`, `ng-isolate-scope`, `ng-binding` and the form state classes, on an element with an AngularJS injector | on `#root`, each `li`, each label, `p.count`, `div.toast`, the form and its input | pass / pass / fail | `div[1].attrs.class`: expected `"ng-isolate-scope ng-scope"`, actual nothing |
| Drop an empty `class` attribute | what the rule above leaves on `#root`, the input, the labels and the suggestion items | pass / pass / fail | `div[1].attrs.class`: expected `""`, actual nothing |
| Form state from properties: the `checked`, `value` and `selected` attributes are dropped and the properties are recorded | React writes `checked=""` once and never updates it. AngularJS keeps `checked="checked"` in step with the state. Vue and Angular set only the property | fail / pass / fail | `ul[1]/li[2]/input[1].attrs.checked`: expected `""`, actual nothing |
| Sort and de-duplicate class tokens | nothing: all four write the same order | pass / pass / pass | |
| Drop an empty `style` attribute | nothing in a hard layer. `page.screenshot()` leaves `style=""` on inputs, on both sides alike | pass / pass / pass | |
| Boolean attributes compared by presence | AngularJS writes `disabled="disabled"` while the request is in flight, which no settled observation holds | pass / pass / pass | |

What this says:

- Eleven rules are needed by at least one source. Four are not exercised by this fixture: `head`, class token order, empty `style` and boolean attributes by presence. The last three are covered by unit tests with hand-written markup.
- With the three proofs switched off again, so that the name rules apply to every element as before the review, record and gate pass for all three sources as well. The proofs cost this fixture nothing.
- Inside an AngularJS app every attribute that starts with `ng-` or `data-ng-` is dropped, also one that is no directive, such as `ng-foo`. The proof is for the element, not for the attribute.
- The rule for an AngularJS directive now tells text from expressions. A binding with `<`, `=` or `&` holds an expression and is always dropped. The name of the directive and a binding with `@` are dropped unless the browser reads the attribute on that element.
- Attributes are compared by name, so their order never counts. The orders do differ: React writes `id, required, type, name` on the input, Angular writes `class` after the static attributes.

## What each layer caught

| | accessibility | DOM | style and geometry | events | side effects | screenshots (soft) |
|---|---|---|---|---|---|---|
| double-event | no | no | no | yes | no | no |
| missing-class | no | yes | yes | no | no | yes |
| aria | yes | yes | no | no | no | no |
| text | yes | yes | no | no | no | yes |
| request | no | no | no | no | yes | no |
| storage | only after a reload | only after a reload | only after a reload | no | yes | only after a reload |
| focus | no | no | yes, the outline of the input | no | yes, the field `focus` | yes |
| style | no | no | yes | no | no | yes |
| empty stub page | yes | yes | yes | no | no | yes |

- No single layer caught every bug. Events is the only layer that saw `double-event`, side effects the only one that saw `request`, style and geometry the only one that saw `style`.
- The stub page differs in three layers only. After `goto` its events, requests, storage, URL, title and focus are the same as those of an original. The other eight cases then stop at step 2 with `the target matches 0 elements`.
- Screenshots were byte identical for `double-event`, `aria` and `request`. Pixels alone would have passed three of the eight bugs.

The same count over the 53 ports with one defect (50 from the review, 3 added here), each gated for all three sources (159 gates, the result is the same for the three sources of every port):

- 40 ports fail and 13 pass.
- Layers that failed, in ports: style and geometry 23, DOM 14, side effects 12, accessibility 10, events 1.
- 27 of the 40 were caught by exactly one layer: style and geometry 15, side effects 8, DOM 3, events 1.
- 18 of the 40 have no different screenshot, so pixels alone would have passed them. None of the 13 passing ports has a different screenshot either.

## Spike defaults, measured

**Geometry tolerance, 0.5 px.** Never used. All 29 observations are byte for byte the same in React, Vue, AngularJS and the Angular port, with boxes rounded to 0.01 px, and with the tolerance set to 0 in a copy, record and gate pass for all three sources. The tolerance now only reaches the four box numbers. Sizes are also compared as exact strings, because `width`, `height`, `inline-size` and `block-size` are longhands with the used size in them. A port with a width of 100% minus 0.5 px passed before the review and fails now. What the tolerance still lets through is a shift of up to 0.5 px that leaves no trace in any longhand. No port of the review set does that.

**Screenshots, byte equality.** 29 of 29 are identical in all four implementations, in every one of the 37 clean gate runs and the 18 recordings of this pass. That holds only because the screenshot is repeated until it is stable. With one screenshot per step the bubble step is noise again: in a recording made with such a copy one source masked it and two stored it unmasked.

**Settle rule.** No run hit the 5000 ms limit, and a page that changes every 20 ms fails its step with `never settled in 5000 ms`, which a test now checks. The quiet period is 50 ms plus one frame plus one timer. How late a port may render after a click, `details` case alone, 10 gate runs per port: a port that renders 40 or 80 ms late passes 10 of 10. One that renders 120 ms late failed 8 of 10 in one batch and 2 of 10 in a second batch. One that renders 160 or 250 ms late fails 10 of 10. So the limit is about 100 ms, one observation and one quiet period. The scatter at 120 ms comes from the clock: under Playwright's flowing clock a page timer of 120 ms fired after 101 to 122 ms of real time (40 timers, median 102 ms), and after 120 to 123 ms when the page read `Date.now()` first.

**Clock that keeps flowing.** This is the weak default. Page timers run in real time while the runner works, so what is observed depends on how long the runner needs. Measured with the `add-task` case alone, React recording, 10 gate runs per port, load average 1.9 to 2.7. The original shows its toast for 2000 ms.

| Toast of the port, ms | 800 | 900 | 1000 | 1100 | 1200 | 1500 | 2000 | 2500 to 3200 | 3300 | 3500 | 4000 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gate runs that pass, of 10 | 0 | 0 | 0 | 8 | 10 | 10 | 10 | 10 each, 7 ports | 3 | 0 | 0 |

- A toast that lasts 60 percent as long or 60 percent longer passes every time. At 1100 and 3300 ms the same port gets both exit codes on the same machine.
- The window belongs to the verifier, not to the case. With one screenshot per step (5 runs per port) 800 ms fails 5 of 5, 900 and 1000 pass 5 of 5, 2900 fails 4 of 5 and 3000 fails 5 of 5. The stable screenshot moved both edges up, by roughly 250 to 400 ms.
- With the CPU of the renderer throttled (a copy of the verifier with two more lines), the clean port passes `add-task` at rates 1, 2, 4 and 8 (3 of 3 each), fails 2 of 3 at rate 20 and 3 of 3 at rate 40, each time at step 4: the toast is already gone. The review, before this change, saw it pass at rate 20 in its one run. The port with a 3000 ms toast passes at rate 1 and at rate 8 (3 of 3 each). `load-suggestions` alone passes 10 of 10 at rates 1, 12 and 25, so the settle rule itself held.
- No clean gate failed for this reason at normal load: 37 of 37 clean runs of this pass exit 0.

The planning notes hold the alternative (decision Q35: a paused clock that the runner advances in frames). It was not built here, because SPIKE.md names the flowing clock as the default to measure. Under a paused clock the stable screenshot would cost no page time.

## Fixtures

- All four build and agree in every observation and every screenshot of the suite.
- SPIKE.md contradicts itself in one place: its markup block shows one row and "2 tasks left", its Behavior section defines two initial tasks with one active. All four fixtures follow the Behavior section (two rows, "1 task left"). The block should be read as the shape, not as the first state.
- SPIKE.md leaves several behaviors open. Ten more cases (50 steps) on them were recorded from each original and gated against the port outside the project: add with the Enter key, a title with spaces around it, ids after a delete, a second add while the toast shows, a click on the selected tab, a toggle while a filter hides the row, an add while Done is selected, loading twice, Details and a reload, delete and reload down to an empty stored list. Nine pass for all three sources, with 0 masks and all 50 screenshots identical. `add-twice` fails for all three at step 5: the original still shows the toast and the port does not. That step comes after an advance of 1200 ms and two more steps, close to the end of the 2000 ms of the toast, and the port needs one observation more per click than an original. With `advance 600` in place of `advance 1200` before the second add the case passes for all three sources. With one screenshot per step all ten pass as they were written. The fixtures agree, the case was too close to a timer. They are not part of `cases/fixture`.
- Differences between the fixtures that the gate does not see, measured in the browser:
  - Order inside the Add handler. React and Angular: storage write, focus, POST, event. Vue: storage write, event, focus, POST. AngularJS: storage write, focus, event, POST. Vue also emits before it moves focus in Delete.
  - AngularJS sends its requests with XMLHttpRequest, `content-type: application/json;charset=UTF-8` and `accept: application/json, text/plain, */*`. The other three use `fetch` with `content-type: application/json`.
  - Attribute order and the `checked` attribute, as listed above.

## Failures seen along the way

- The first version of the new DOM tests passed for the wrong reason. All captures shared one page, a second script that declared the same `const` failed without a message, and the test then looked at a page that AngularJS had never rendered. Each capture has its own page now, and the test compares the rendered app as well.
- After the lockfile changed, `pnpm install --frozen-lockfile --offline` failed with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` for 10 entries that were not in the cached registry data. The same command without `--offline` passes ("Lockfile passes supply-chain policies") and changes no file.
- The first version of the capture handled a longhand that a parent has and a child has not. A probe showed that Chromium 159 always lists such a longhand, with an empty value, and no test needed the branch. It is removed.
- Ports with a toast of 900 and 1000 ms passed before the review and fail now, and one with 3000 ms failed and passes now. That is the moved window described above, not a change in the comparison.
- The extra case `add-twice` fails now, see "Fixtures".
- `check` on a checkbox whose row leaves the list fails after 5000 ms with `locator.check: Timeout 5000ms exceeded`, on all three originals. Such a case has to use `click`. The extra case `toggle-under-filter` does.

## Not covered

The gate did not check these, and a port that differs in them passes. Where a port is named, it was built and gated for all three sources, and all three gates exit 0.

- States that exist only between an action and the settled observation. `aria-busy` on Load suggestions is in none of the 87 recorded observations, and a port that never sets it passes. A port whose count shows "99 tasks left" for one frame after a toggle passes, and so does one that paints the suggestions in reverse order for one frame. A port that never disables the button is caught, but only because the disabled button loses focus in the originals.
- Effects after the last settle of a case. A port that emits `taskToggled` a second time 1.5 s after a toggle passes.
- A port that behaves differently when the verifier is present. One that sends its POST only when `window.__aa` is defined passes.
- Dialogs and new windows. A port that calls `alert` on every add passes, and so does one that calls `window.open`. Playwright dismisses a dialog that nobody listens for, so a flow behind `confirm()` would be recorded as cancelled. That last point was not tried.
- Exact timer lengths, and anything else that depends on real time. A toast of 1200 to 3200 ms passes for 2000 ms, see "Spike defaults, measured".
- Work the page starts later than about 100 ms after an action (a debounce, a delayed render). It lands in a later step or is missed.
- The order between events, requests, storage writes and focus changes inside one step. Each is its own list. The three originals already differ in it.
- Request headers, `fetch` against XMLHttpRequest, response status and body. A port with other POST headers passes. How often a GET is sent and in which order: a port that sends the GET twice passes. GET requests that are not `fetch` or XHR: a port that loads a tracking image on every add passes.
- How often `localStorage` is written, only its contents after each step count. `sessionStorage`, cookies, IndexedDB: a port that writes a cookie and `sessionStorage` on every add passes.
- Console messages and uncaught errors of the page. A port that logs an error and throws on every toggle passes.
- Events other than `window.__aa.emit`.
- `head` apart from the document title: `meta` and `base` elements. This fixture would also pass with `head` compared.
- Pseudo-elements other than `::before` and `::after` (`::marker`, `::placeholder`, `::selection`), hover and active states, scroll position, animations in mid-flight, shadow DOM, iframes, `template` content.
- Accessibility facts that Playwright's snapshot does not hold: description, `haspopup`, `controls`, `current`, `live`, and the difference between a false state and a missing one. The literal `aria-*`, `role`, `tabindex` and `required` attributes are compared next to the snapshot.
- In the DOM layer: comments, text that is only whitespace, the `value`, `checked` and `selected` attributes (the properties are compared in their place), empty `class` and `style`, the order of class tokens, and the framework marks named in the rule table where the framework is proven.
- Limits of the AngularJS directive rule, each checked on a small AngularJS page. An attribute that a directive reads without declaring a binding stays in the DOM, so a faithful port fails on it until it is declared or handled. A text binding written with a `data-` prefix is dropped even if a stylesheet reads it. A text binding named `for` on a label is dropped, because the property has another name (`htmlFor`). The same holds for `accept-charset` and `http-equiv`.
- A port that uses Angular's form classes (`ng-untouched`, `ng-pristine`, `ng-valid`). They are no longer dropped on the port side, so such a port would fail in the DOM layer. That was not tried, the port of this fixture has no forms package. The rule needs a proof on the Angular side once a port uses forms.
- Geometry shifts of up to 0.5 px that no longhand shows.
- Code in the verifier that no fixture and no case of the suite reaches: the properties of radio buttons, `select`, `textarea` and `option`, the `indeterminate` state, a payload that cannot be serialized, request bodies that are not JSON, URLs on another origin, `hidden="until-found"`, and the object form of `module.directive`. The `press` step is used by the end-to-end test only.
- Behaviors of the Tasks fixture that no case of the suite uses: the Enter key (a port whose Enter key is broken passes), trimming, ids after a delete, a second add while the toast shows, a toggle under a filter, a click on a label.
- Other viewports, other browsers, other operating systems. Recording on one machine and gating on another. The research says sizes and screenshots differ between macOS and Linux. That was not tried here, and with sizes compared as exact strings it matters more now.
- The lock is evidence, not protection. Someone who edits a file and recomputes every hash, the root included, is not caught. Removing a case together with its recording is not caught. A screenshot that still differs between the two recording runs is stored and hashed, so such a case would get a new root hash with every recording. That did not happen in this pass.
- Recordings hold input values and `localStorage` contents as they are. Nothing is redacted.
- Everything SPIKE.md lists under "Not in this milestone".

## Spec points

- SPIKE.md says "The verifier captures `document.body`". It now captures the `html` element as well: its attributes, its style and every child except `head`. Paths start with `html[1]/body[1]`. The review found that a port with a dark `html` background or another `lang` passed, and this closes it. The sentence in SPIKE.md was not edited.
- SPIKE.md calls the layer for the `focus` bug "focus". The verifier has no layer with that name. The focused element is the field `focus` of the side effects layer, and the report line reads `side effects: 1 difference, the first at focus`.
- A recording holds one thing more than SPIKE.md lists per step, the document title, and its computed style lists longhands relative to the parent element.

## Open points for the maintainer

1. The stable screenshot. It makes every screenshot and every root hash the same from run to run, and it costs 4.8 s of a 10.3 s gate and moves the timing windows of the flowing clock up by roughly 250 to 400 ms. Without it a gate takes 6.1 s and the bubble step is noise again. Other ways to get a stable root hash were not built: leaving screenshots out of the root hash, or masking and not storing a screenshot that is still changing. Under a paused clock the wait would cost no page time.
2. The clock. The flowing clock failed its measurement again, this time on the gate side. Decision Q35 is the candidate.
3. Scope of the capture: body as SPIKE.md says, `html` without `head` as it is now, or all of it.
4. `head`. The fixture passes with `head` compared. Not checked here: whether real ports need a rule there, for example for a `base` element that an Angular port with a router carries and an original may not.
5. Focus: keep it as a field of side effects, or make it a layer of its own as the bug table in SPIKE.md words it.
6. Hard layer masks at record time: `record` lists them and exits 0. None appeared in this pass.
7. Inside an AngularJS app the `ng-` name rule also drops attributes that are no directive. Narrow it to registered directives and the binding prefixes, or accept it.
8. Dialogs and new windows: log them in the side effects, and give a case a way to accept a dialog.
9. `replay` exits 1 on a mismatch. SPIKE.md only says it writes a report.
10. The tolerance: 0 passes this fixture, and sizes are exact now anyway.
11. The ten extra cases: add them to the suite or not. One of them is too close to a timer as written.
