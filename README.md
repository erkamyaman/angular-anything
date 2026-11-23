# angular-anything

Replays every recorded interaction of the original against the port.

**Status: spike. Not published, not stable.** The plan for the current milestone is in [SPIKE.md](SPIKE.md). What was measured is in [SPIKE-RESULTS.md](SPIKE-RESULTS.md).

## What exists so far

- A pnpm workspace with one install for the tool and the fixtures.
- `src/`, the CLI and the verifier. `doctor`, `record`, `replay` and `gate` work.
- `test/`, the unit tests and one end-to-end test that drives the CLI against a small page.
- `fixtures/react`, `fixtures/vue` and `fixtures/angularjs`, the Tasks fixture written three times as an original, and `fixtures/angular`, its Angular port. The port misbehaves on purpose when the URL has `?bug=<name>`.
- `fixtures/shared/fixture.css`, the one stylesheet that all four load.
- `fixtures/server.ts`, which serves the built fixtures and the mock API.
- `cases/fixture`, nineteen cases for the Tasks fixture.
- `recordings/react`, `recordings/vue` and `recordings/angularjs`, the locked recordings of the three originals.

## Commands

You need Node 24 or newer and pnpm.

```sh
pnpm install                            # the tool and all four fixtures
pnpm exec playwright install chromium   # the Chromium build that Playwright 1.65.1 expects
pnpm aa doctor                          # checks Node, the Playwright version and Chromium
pnpm fixtures:build                     # builds each fixture into fixtures/<name>/dist
pnpm fixtures:serve                     # serves the fixtures and the mock API
pnpm fixtures:serve --only react        # serves one: react, vue, angularjs, angular or stub
pnpm typecheck
pnpm test
```

The fixture server listens on 127.0.0.1: React on port 4101, Vue on 4102, AngularJS on 4103, Angular on 4104, and a stub page with an empty `<main>` on 4105.

With the fixtures built and served:

```sh
pnpm aa record fixture --source react --url http://localhost:4101             # runs the original twice, writes recordings/react
pnpm aa gate fixture --source react --url http://localhost:4104               # checks the lock, then replays against the port
pnpm aa replay fixture --source react --url http://localhost:4104             # the same without the lock check
pnpm aa gate fixture --source react --url 'http://localhost:4104/?bug=aria'   # a seeded bug, exits 1
```

The sources are `react`, `vue` and `angularjs`. The seeded bugs are `double-event`, `missing-class`, `aria`, `text`, `request`, `storage`, `focus` and `style`.

`record` exits 0 when every case was recorded. It exits 1, and leaves no recording of that case (also not the one from before), when the two runs of the original differ where the case does not allow it (see "Masks and noise"). `gate` and `replay` exit 0 when every step of every case matches the recording, 1 on a mismatch or a refused recording, and 2 on a wrong command line. Both print a summary and write it to `reports/<source>/summary.txt` next to `reports/<source>/report.json`. `gate` also exits 1 when `recordings/<source>` holds a recording of the suite whose case is gone, and `record` removes such a recording (it prints the case) and leaves the recordings of other suites alone, and removes nothing when the suite has no case at all. A command that stops at the command line (exit 2) removes the report of the source it names, so no report of an earlier run is left. `--source` and `--url` may be given once. The query of `--url` is added to the path of every `goto` as it is written. A `goto` path starts with one `/` and not with `//` or `/\`, so a case never leaves the page under test, and a case folder that is a symbolic link is refused by name. `doctor` exits 1 when Node, Playwright or Chromium is not what it needs.

## Page time

A case is a `case.json` in the format `angular-anything/case@1`. The clock of the page is installed paused at 2026-01-01T00:00:00Z. `Date`, `performance.now()`, timers and `requestAnimationFrame` follow it, and it moves only when the runner moves it, in frames of 16 ms. A case moves it with `{ "action": "advance", "frames": 125 }`. `"ms"` is no longer accepted: 2000 ms are 125 frames.

- Before each observation and before each frame the page comes to rest. Timers that are due run, every animation that has an end is finished, every endless animation is held at one point, and the browser gets a frame of its own when something moved. That covers CSS animations and transitions, `element.animate()` and SVG animations, in the document and in every shadow root, open or closed. A CSS or script animation is held at its start. The timeline of an `svg` element is paused and set to its next full hour, which ends every animation in it that has an end. An animation with playback rate 0 and an animation that follows the scroll position stay as the page has them.
- A request that the page sends is held back until the page is at rest. Then it goes out and the runner waits for the answer in real time, without moving the clock. Answers reach the page one at a time, in the order in which the requests were sent, each when the page is at rest again, while recording and on the port. Three kinds are not held: the request for the document of the page, what that document asks for while it loads apart from `fetch` and XHR, and a synchronous XMLHttpRequest.
- Motion that neither the clock nor the animation API reaches, smooth scrolling for example, is waited out in real time and moves no page time. An observation counts only when the page has shown the same state in 4 browser frames in a row (the scroll position and the box of every element, the number of DOM changes, the events and the requests) and the observation itself, taken after them, is still that state. The wait stands at the page time of the action before the first frame of a step, before every observation of a step, and again after the stable screenshot: the step is observed once more, and while it differs from the one before the screenshot the runner waits again and takes the screenshot again. Recording and replay wait at the page time of the action alike, so the page time at which a smooth scroll ends is the same on both. Motion that a timer starts in the middle of a step is waited out at the next observation, so the page time at which it ends can differ between the original and the port. After 5000 ms the step fails with `the page moves without page time: still changing after 5000 ms of real time (style)`. How many frames a step takes does not depend on how long such motion lasts. The same holds on the port.
- When the page goes to another document by itself (a link, a form, `location`, a redirect after an answer or after a timer), the runner waits until that document has loaded before it looks at the page again.
- While a step is recorded it stays open until 4 frames in a row were quiet. A frame is quiet when the observation after it equals the one before it, no finite animation was finished in it, no request started or ended in it, and no one-shot timer of the page (`setTimeout`) is due within 500 ms of page time. So a step that ends on a timer waits for it: Vue changes its classes two animation frames after the action and arms its fallback timer only then, and a closing timer of ngAnimate is armed a frame after the action. A timer that is further away than 500 ms is not waited for, and a state shortly before a timer fires can not be recorded, because the step stays open until the timer has fired. `setInterval` never keeps a step open. A one-shot timer stops keeping a step open once timers with the same delay have fired at two earlier page times in that step, which is what keeps a page that polls from holding every step for ever. A step that is not quiet after 300 frames fails, counted from its action or from the last frame of an `advance`.
- `record` stores the frames each step took, the frames of an `advance` included, in `recording.json`, under the lock. Its two runs must take the same number of frames in every step, or `record` exits 1 and names the step and both numbers. `replay` and `gate` run exactly the stored frames on the port and compare then, so no side settles on its own. The port has to be at rest after them: its last frame must have been quiet by the rule above. Else the step fails with `not settled within the frames of the original` and the message names what was not quiet. A port may therefore show its last change up to 3 frames (48 ms) later than the original and still pass. A recording without stored frames is refused and has to be recorded again. The report prints the frames of each step.
- The browser context does not ask for reduced motion. The runner finishes animations itself.
- No page can keep the runner waiting for good. Counted per step: the page gets 100 rounds in which it still moves (finishing an animation starts the next) before the clock moves, and 100 rounds of answers (the page asks again as soon as it is answered); the counts start again when the clock moves. The requests that are in flight together share 5000 ms, one window of real time, and a wait of the runner on the page (for a frame, for a document) ends after 5000 ms. The settle of a step and the screenshot loop fail after 30 s in which the clock of the page did not move by a frame, so a step is limited by its 300 frames and not by the time they take (a slow machine runs the same frames), and the screenshot loop has 30 s of its own. Each of these fails the step and names what was waited for, for example `1 requests still in flight after 5000 ms, the first: GET /api/never`, `1 requests in flight after 100 rounds of answers, the first: GET /api/poll` or `the page did not come to rest in 100 rounds, the last to move: an animation`. The limits in milliseconds are real time, so on a machine that is slow enough they decide a result. A chain of 12 animations that ends, and 12 answers one after another, are recorded. Measured on the Tasks fixture with the CPU throttled 40 times: the gate passes, and the longest step takes about 6 s.
- The screenshot is taken again until two in a row are identical. That wait is real time and moves no page time.

Not under the clock and not held: an animated image, a video, a canvas that a worker repaints and an animation inside an `iframe` (they show in screenshots only), and work outside page time that is no motion: a meta refresh, `document.timeline.currentTime`, and whatever a Worker, a WebSocket, `scheduler.postTask` with a delay or a job that hops through `MessageChannel` delivers. That work can change what a step sees from run to run, and the exit code can then follow the load of the machine. An animation with playback rate 0 and an animation on a scroll timeline are left as the page has them and keep no step open.

## What is compared

After each step the page settles and one observation is captured:

- the accessibility snapshot and the literal `aria-*`, `role`, `tabindex` and `required` attributes
- the DOM from the `html` element down, without `head`, `script`, `style` and `link`, and without the marks a framework leaves where that framework is proven for the element (see "The canonical DOM")
- every computed CSS longhand of each element and of each `::before` and `::after` that has content, and the border box of each element (rounded to 0.01 px at capture and compared exactly: there is no tolerance, a box 0.01 px wider differs)
- the events sent through `window.__aa.emit`
- the requests, `localStorage`, the URL, the document title and the focused element, with every string that has structure compared by its parts (see "Masks and noise")
- the dialogs and windows of the page, in the order in which they happened (see "Dialogs and windows")
- a screenshot, which is reported and never fails the gate

In a recorded observation an element lists only the longhands whose value differs from its parent element. The `html` element lists all of them.

## The canonical DOM

The DOM is compared as the browser means it, and the browser is asked for what it knows. No CSS is implemented a second time.

- Text. Adjacent text nodes are joined. Where the parent collapses whitespace (`white-space-collapse` is `collapse`), a run of space, tab and line break counts as one space. A space counts at the start or the end of a text where the browser renders it, or would on a wider line (`<span>a</span> <span>b</span>` is not `<span>a</span><span>b</span>`). It does not count at the start or the end of a block, next to a `br`, next to a block-level or out-of-flow element, after another space, or in whitespace between the items of a list, a table or a flex container. Where a line wraps is never the reason, so the same text gives the same DOM at every width. Which element is a block, an inline box or an atomic inline (an image, a button, an inline block) comes from `getComputedStyle`. Where the parent preserves whitespace (`pre`, `pre-wrap`, `break-spaces`) the text is compared as written. Under `pre-line` a line break counts as written, a run of spaces and tabs counts as one space, and spaces around a line break are removed. A no-break space is text.
- The `style` attribute is compared as the declarations the browser parsed: each property with its value and priority, in no order. `color: red` and `color: red !important` differ, `color: red; margin: 0` and `margin: 0; color: red` do not. A declaration the browser dropped is not there.
- A `textarea` is compared by its value. Its text child is not part of the DOM.
- A boolean attribute (`disabled`, `hidden`, `required`, `selected` and the others of the list) loses its value only on an element that has a boolean property of that name, so `selected="1"` on a custom element still differs from `selected="2"`. `hidden="until-found"` keeps its value.
- Inside an AngularJS app an attribute is dropped when the injector of the page has an attribute directive of that name (built-in ones included), when it is a declared binding of a directive on that element (`.component()` and element directives included), when its name starts with `ng-attr-`, `ng-prop-` or `ng-on-`, or when AngularJS reads it without a directive: `ng-app`, `ng-strict-di`, `ng-csp`, `ng-jq`, `<name>-start` and `<name>-end` of a directive that spans elements, `ng-true-value`, `ng-false-value`, `ng-trim`, `ng-ref-read`, `ng-switch-when-separator`, `ng-transclude-slot` and `ng-animate-ref`. Any other `ng-` attribute stays. The name of a directive and a text binding (`@`) stay when the browser reads the attribute: a property of the element (without case, and `class` is `className`, `for` is `htmlFor`, `accept-charset` is `acceptCharset`, `http-equiv` is `httpEquiv`), a global HTML attribute, `aria-*`, `role` or an SVG presentation attribute on an SVG element. A text binding written with a `data-` prefix is dropped even when the browser reads it.
- In a computed value the origin of the page inside `url()` is replaced by `[page-origin]`, so a relative `url()` compares equal on two origins. A URL to another host stays as it is, and so does a URL in an attribute. An Angular CLI build rewrites the file name of an asset in a global stylesheet (`logo.png` becomes `media/logo-<hash>.png`), and that port fails.
- A custom property registered with `inherits: false` is compared per element: a property that the parent lists and the child does not is recorded as missing (an empty value) on the child.
- An event payload is recorded with what it holds: a `Set` and a `Map` with their entries, `NaN`, `Infinity` and `undefined` in a list as themselves. A key with the value `undefined` equals a missing key.

## Choosing the selector of a component in the Angular port

An Angular component is mounted on an element that the original already has, so that no wrapper element appears. Its selector decides what Angular leaves on that element, and the gate compares attributes. The convention:

- The selector is something the original element already matches. A tag and a class (`li.task`, with `<li class="task" [task]="task">` in the parent template), or an attribute the element already has (`[id=root]` for the root component).
- If the original element has nothing to match, the selector is an attribute and the input that carries the value is an alias that is bound: `selector: 'li[appTaskRow]'` with `input.required<Task>({ alias: 'appTaskRow' })` and `<li [appTaskRow]="task">`. A bound alias is a property binding and leaves no attribute in the DOM.
- A plain attribute selector (`<li appTaskRow [task]="task">`) leaves `apptaskrow=""` on the element. The original does not have it and the gate fails on it.

When the only differences of a step in the DOM are attributes with an empty value that only the port has and that the browser does not read on that element, the summary of the gate names this convention under the step. The line says that an attribute is not what it seems and lists the attribute names. It does not appear when anything else differs in the DOM of that step, when the attribute has a value, when the original has it too, or when the browser reads it on that element (`hidden`, `title`, `tabindex`, `aria-*` and the others that are properties or global attributes). It is a hint, it does not change the result.

The Tasks fixture port uses `li.task` for its row component, and every observation and screenshot of the 19 cases is the same as with the aliased input.

## Dialogs and windows

`alert`, `confirm`, `prompt`, `window.print` and `window.open` are logged in the side effects (`popups`) of the step in which the page calls them, in the order of the calls, with what a user can tell apart: the kind and the message, for `prompt` the default value, for `window.open` the URL (resolved against the page), the target and the features, for `print` nothing else.

- The runner does not answer a dialog. Chromium dismisses it as it did before: `alert` returns, `confirm` returns `false`, `prompt` returns `null`. A page that asks before a delete is recorded as cancelled. A step that answers a dialog is not built.
- A dialog does not stop the clock. The call is logged when it returns, and the step settles in the frames it would have taken without it.
- A window that `window.open` opens is real: the page gets a window object back (`typeof` is `object`, `closed` is `false`, `opener` is the page), the same for the original and for the port. Its network requests are refused, nothing in it is observed, and the runner closes it at the end of the step, so the page sees `closed` become `true` in the next step.
- Not logged, and a port that differs there passes: the dialog that a browser shows when a page with a `beforeunload` handler is left (Chromium leaves the page without a question), and a window that a link with `target="_blank"` opens when it is clicked (the DOM layer holds its `href`, `target` and `rel`, but a port that cancels the click of the link passes). A call inside the window that `window.open` opened is not logged.
- A noise entry can name `popups[n].message`, `.default`, `.target`, `.features` and the parts of `.url`.

## Masks and noise

`record` runs every case twice and compares the two runs. A value that differs between them is noise of the page itself (a random id, a cache buster). The gate never decides alone that something is noise: the case names it.

```json
{
  "format": "angular-anything/case@1",
  "id": "add-note",
  "viewport": { "width": 800, "height": 600 },
  "steps": [{ "action": "goto", "path": "/" }],
  "noise": [
    { "layer": "effects", "path": "storage.notes[1].id" },
    { "layer": "events", "path": "[0].payload.id" },
    { "layer": "dom", "path": "html[1]/body[1]/main[1]/ul[1]/li[*]/input[1].attrs.id" }
  ]
}
```

- A case without `noise` means what it did, and the format stays `case@1`. A key of the case that is not known is refused, and so is a `noise` entry with a key other than `layer` and `path`, a layer that is not `accessibility`, `dom`, `style`, `events` or `effects`, a path that is not a path, a path that is listed twice, and a path to an object, a list or an element: an entry names one value, a string, a number or a boolean. A screenshot needs no entry, it never fails the gate.
- A path is what the report prints. Elements are `tag[n]` joined by `/`, fields and keys follow after `.`, list entries are `[n]`, and `*` in place of an `n` stands for every index. A key that holds `.`, `/`, `[`, `]`, `*`, a quote, a backslash or white space is written as a quoted JSON string: `storage["visit.count"]`. So `storage.visit` is the key `visit` and nothing that only begins like it (`visit.count`, `visit/last`, `visit[0]` and `visitor` are other keys), and a key named `*` is `storage["*"]`.
- When the two runs differ at a path that the case does not name, `record` exits 1 and prints each such path as the entry the case needs, one JSON object per line, ready to copy. An entry that matches nothing in any step fails as well (it would mask something later that nobody looked at). A value that exists in one run only, a value of another kind in the second run, and a list of another length fail `record` with or without an entry: that is a page that does not hold still, not noise.
- A path that the case names is masked in every step in which it exists, also where the two runs happen to agree, so the exit code does not depend on the draw. `record` lists the entries at which the two runs did not differ.
- The recording holds no value at a masked path: only its kind (`string`, `empty string`, `number`, `boolean`) and a group number. A mask never hides a missing value. At a masked path the port must have a value of the same kind: a missing value, a number for a string, an object for a string and an empty string for a string with text all fail.
- Masked strings of 8 or more characters that were equal to each other in both runs (the id in `localStorage` and the id in the event, the `id` and the `for` of an input and its label, the same token in two steps) must be equal to each other on the port, within a step and across the steps of a case. Shorter values are not tied together, because two of them can agree by chance. A page that picks one of two long strings at random for two paths can tie them by chance.
- `gate` and `replay` apply no mask that the case does not name, and refuse a recording that masks a value the case does not name. A recording of another format is refused and has to be recorded again.

Strings with structure are compared by their parts, and a difference or a mask names the part:

- A `localStorage` value that parses as JSON to an object or a list is compared by its parts: spaces and escapes do not count, the order of the keys does count (`storage.settings.$order`), and a number counts as written (`1.1` and `1.10` differ, so do `1e2` and `100`). Any other value is a string: `7`, `"seven"`, `null` and text that is not JSON. A value that parses on one side and not on the other is a difference at the key. Keys of integer form are ordered by the JavaScript engine, so the order of those among themselves is not told.
- The URL of a request or of a GET is `path` (segments as sent), `query` and `origin` (only when it is not the origin of the page). Query parameters are decoded, `+` and `%20` are both a space, the order of parameters with different names does not count, and repeated names keep their order (`?tag=a&tag=b` differs from `?tag=b&tag=a`). The URL of the page has its path segments decoded, its query compared like that of a request, and its fragment as sent. A string is a URL only at those places: a stored value or a field that looks like a URL is a string, and an attribute that holds a URL is compared as written.
- A body is a form (`application/x-www-form-urlencoded`) compared like a query, a multipart body, or JSON (an object or a list, parsed, in no key order). A multipart body is compared by its parts: the name, the file name, the type, the size and the content of a file (as a SHA-256), the text of a field. The boundary is never compared, and neither is the order of parts with different names. Parts with one name keep their order. Anything else is a string.

A port that stores `7` where the original stores its random token passes: a stored value that is no JSON object or list is a string, and so is the token, so their kinds cannot tell them apart.

## Notes

angular-anything is not affiliated with Angular or Google.

angular-anything collects no telemetry.

## License

MIT. See [LICENSE](LICENSE).
