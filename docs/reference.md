# Reference

**Status: early, not stable.** The plan for the current milestone is in [SPIKE.md](../SPIKE.md). What was measured is in [SPIKE-RESULTS.md](../SPIKE-RESULTS.md).

Tested on macOS only. Linux is untested. The fixes of 2026-11-27 were reviewed once. What that review found is fixed, and those fixes have not had a second review.

## What exists so far

- A pnpm workspace with one install for the tool, the fixtures and the trial packages.
- `src/`, the CLI and the verifier. `doctor`, `record`, `replay`, `gate` and `drift` work.
- `test/`, the unit tests and end-to-end tests that drive the CLI against small pages.
- `fixtures/react`, `fixtures/vue` and `fixtures/angularjs`, the Tasks fixture written three times as an original, and `fixtures/angular`, its Angular port. The port misbehaves on purpose when the URL has `?bug=<name>`.
- `fixtures/shared/fixture.css`, the one stylesheet that all four load.
- `fixtures/server.ts`, which serves the built fixtures and the mock API. `record` asks that API, `gate` and `replay` do not (see "The network tape").
- `cases/fixture`, nineteen cases for the Tasks fixture.
- `recordings/react`, `recordings/vue` and `recordings/angularjs`, the locked recordings of the three originals.
- `trials/todomvc` and `trials/sonner`, the two trial ports (an original and its Angular port each), with `cases/todomvc`, `cases/sonner`, `recordings/todomvc-react` and `recordings/sonner-react`.

## Commands

Run these from the root of the repository. You need Node 24 or newer and pnpm.

```sh
pnpm install                            # the tool, the four fixtures and the three trial packages
pnpm exec playwright install chromium   # the Chromium build that Playwright 1.65.1 expects
pnpm aa doctor                          # checks Node, the Playwright version and Chromium
pnpm fixtures:build                     # builds each fixture into fixtures/<name>/dist
pnpm fixtures:serve                     # serves the fixtures and the mock API
pnpm fixtures:serve --only react        # serves one: react, vue, angularjs, angular or stub
pnpm typecheck
pnpm test
pnpm build                              # compiles src into dist, which the package ships (packing runs it)
```

The fixture server listens on 127.0.0.1: React on port 4101, Vue on 4102, AngularJS on 4103, Angular on 4104, and a stub page with an empty `<main>` on 4105.

With the fixtures built and served:

```sh
pnpm aa record fixture --source react --url http://localhost:4101             # runs the original twice, writes recordings/react
pnpm aa gate fixture --source react --url http://localhost:4104               # checks the lock, then replays against the port
pnpm aa replay fixture --source react --url http://localhost:4104             # the same without the lock check
pnpm aa gate fixture --source react --url 'http://localhost:4104/?bug=aria'   # a seeded bug, exits 1
pnpm aa gate fixture --source react --url http://localhost:4104 --original-url http://localhost:4101   # also sizes, positions and screenshots
pnpm aa gate fixture --source react --url http://localhost:4104 --redact      # shapes only, no values and no screenshots
pnpm aa gate fixture --source react --url http://localhost:4104 --original-source fixtures/react --port-source fixtures/angular
pnpm aa drift fixture --source react --url http://localhost:4104 --original-url http://localhost:4101  # which side moved
```

The sources are `react`, `vue` and `angularjs`. The seeded bugs are `double-event`, `missing-class`, `aria`, `text`, `request`, `storage`, `focus` and `style`.

`record` exits 0 when every case was recorded. Two suites can share a source, but not a case id within it: `record` fails a case whose folder below `recordings/<source>` holds the recording of another suite, and leaves that recording as it is. It exits 1, and leaves no recording of that case (also not the one from before), when the two runs of the original differ where the case does not allow it (see "Masks and noise"), when the page does something the tape cannot hold (see "The network tape"), and when it finds a secret (see "Secrets"). `record` does not reset a backend: a case is recorded in the state the backend is in when the case starts. `gate` and `replay` exit 0 when every step of every case matches the recording, 1 on a mismatch or a refused recording, and 2 on a wrong command line. Both print a summary and write it to `reports/<source>/summary.txt` next to `reports/<source>/report.json`. `gate` also exits 1 when `recordings/<source>` holds a recording of the suite whose case is gone, and `record` removes such a recording (it prints the case) and leaves the recordings of other suites alone, and removes nothing when the suite has no case at all. A command that stops at the command line (exit 2) removes the report of the source it names, so no report of an earlier run is left. `--source` and `--url` may be given once. The query of `--url` is added to the path of every `goto` as it is written. `replay`, `gate` and `drift` print and store `--url` and `--original-url` without their query (`recording.json` holds the `--url` of `record` as it was given). A `goto` path starts with one `/` and not with `//` or `/\`, so a case never leaves the page under test, and a case folder that is a symbolic link is refused by name. `doctor` exits 1 when Node, Playwright or Chromium is not what it needs. When Chromium does not launch, it prints the command that installs it with the Playwright the tool itself uses (`node "<path to playwright>/cli.js" install chromium`), which works from a checkout and from an installed package.

## Steps and targets

A case is a list of steps: `goto` (a path), `click`, `dblclick`, `hover`, `check`, `uncheck` (a target), `fill` (a target and a `value`), `press` (a target and a `key`, for example `Enter` or `Tab`), `reload` and `advance` (a number of `frames`). A target is an element of the accessibility tree: a `role`, and as needed a `name` (matched exactly, including text that CSS adds with `::before` or `::after`), an `index` from 1 among the matches in page order, and a `within` target that the element must be inside. Without an `index` the target must match one element, and so must each `within` target; else the step fails and says how many it matched. When nothing matches, the message lists the names that elements of that role have there (`the checkbox elements here: "❯ Toggle All Input", 2 without a name`), or says that there is none. A `goto` or `reload` whose page answers with a status of 400 or more fails its step (`the page answered 404 Not Found`). An element that is hidden (for example a button that shows only while its row is hovered) is not in the tree, so the case hovers first:

```json
{ "action": "hover", "target": { "role": "listitem", "index": 1 } },
{ "action": "click", "target": { "role": "button", "name": "Delete todo", "within": { "role": "listitem", "index": 1 } } }
```

`hover` leaves the mouse where it is until the next step that uses it. `dblclick` is one step and sends the events of two clicks. These steps and target fields were added to the format `angular-anything/case@1` without a new version: a case without them reads as before.

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
- every computed CSS longhand of each element and of each `::before` and `::after` that has content, and the border box of each element (rounded to 0.01 px at capture and compared exactly: there is no tolerance, a box 0.01 px wider differs). Sizes and positions are split off, see "Sizes, positions and screenshots"
- the events sent through `window.__aa.emit`
- the requests that are no reads (see "The network tape"), `localStorage`, the URL, the document title and the focused element, with every string that has structure compared by its parts (see "Masks and noise")
- the dialogs and windows of the page, in the order in which they happened (see "Dialogs and windows")
- a screenshot, which is reported and never fails the gate

In a recorded observation an element lists only the longhands whose value differs from its parent element. The `html` element lists all of them.

## The network tape

`record` stores every request that the page sends with `fetch` or XMLHttpRequest to its own origin, with the answer, in `tape.json` under the lock. `replay` and `gate` answer these requests of the port from the tape, so they need no API. Every other request (the document, scripts, styles, images, fonts, a posted form, `EventSource`) goes to the server of the page as before, except a request that the page sends as it leaves (below). A beacon (`sendBeacon`, a link with `ping`) goes to the server in the first run of `record` only: in the second run of `record`, in `replay` and in `gate` it is aborted before it leaves the browser, and it is still listed in the side effects.

- Of a request the tape holds the step, the epoch, the method, the path, the query, the body by its parts (see "Masks and noise") and the names of the credential headers it carried. Of an answer it holds the status, the body and the headers `content-type` and `location`. No other header reaches the page, while recording or from the tape, so a page that reads another header is not supported.
- The key of a request is its method, its origin (the origin of the page is one fixed word), its path as sent, its query with the names sorted (a repeated name keeps its order, `+` and `%20` are both a space) and its body (JSON and form fields in no key order, arrays in their order, multipart without the boundary, any other body as its exact text). No body and `{}` differ. Headers are not part of the key. A part that the tape stores as its kind only (see below on noise) is not part of the key, another value of that kind fits it.
- `POST`, `PUT`, `PATCH` and `DELETE` are mutations. Every other request is a read. The epoch starts at 0 in each case and goes up each time the answer of a mutation is handed to the page (not for a mutation that the page has cancelled by then). A request has the epoch of the moment it is let go.
- A read gets the answer of its key in the same epoch and step: the Nth read the Nth answer, and the last one repeats. If the step recorded none, the latest answer of an earlier step of the epoch, else the first of the epoch.
- A read that the tape holds only in another epoch gets the nearest earlier answer (else the next one), and the gate fails: the tape has no answer for this state, and the case needs a step in which the original asks. A read whose key the tape does not hold is aborted and fails the gate.
- A mutation gets the Nth answer of its key, and one more than recorded is aborted. A changed mutation gets the next unused one with the same method and path, and the report shows both. With none left it is aborted. A mutation that is changed, missing, sent once more or sent in another order fails the gate. Missing also means that the page of a step that ran did not send a mutation of the tape for that step, or cancelled it before it was let go, which includes sending it with `sendBeacon` in its place.
- Reads are soft. They are not in the side effects. The summary lists, per step, each read that the port sent more or less often than the original, with both counts, and a different order. This never fails the gate, also not a read that the port never sends.
- The credential headers are `authorization`, `x-xsrf-token` and `x-csrf-token`. Their values are never stored and never compared. A request of the port that has one where the recorded one had none, or the other way round, fails the gate and the report names the header.
- Requests in flight together are answered one at a time, in the order in which the page sent them, also those of one task. The order is the one Chromium reports from the page (`Network.requestWillBeSent`), not the one in which Playwright hears of the requests, and the side effects list the requests in it. Nothing is added to the page for this. A synchronous XMLHttpRequest is answered at once.
- A request that the page cancels before it is let go is not on the tape. A request that the page announces and that has not reached the runner after 1000 ms is not waited for. A request of a worker is not announced and keeps the place in which it reached the runner. Frames that run in a process of their own were not measured. Where the announcement holds no body (a `Blob`, a form with a file), the body is taken from the interception of the request, so two such requests to one URL are told apart (measured up to 5 MB).
- The second run of `record` is answered from the tape of the first, so the backend is asked once per case. A request in the second run that does not fit that tape fails `record`, which names it and the parts that differ. A part that differs between the runs and is meant to is named as noise: `gets[n].query.<name>[i]` or `gets[n].path[i]` for a read, `requests[n].body.<key>` or `requests[n].url...` for a mutation. Such an entry holds for that part of every read (or every mutation), whatever `n` is, in the second run. In `tape.json` each request keeps the value of that part when the two runs sent the same one, and only a value that differed (or a request that the second run did not send) is stored as its kind. So with `gets[0].path[2]` a recorded `/api/user/1` stays checked, and a port that asks `/api/user/999` fails. A request of the tape takes a value of the same kind only where it stores the kind, and when two requests of the tape fit, the one that keeps more answers. This has limits. A part that stores the kind accepts any value, so a wrong request of the same shape as a random one is answered by it (a read without a finding; a mutation then leaves another one missing or sent once more). A value that agrees by chance or only today (a small random range, a date of the server) is kept, and the gate fails a port that sends another: record again. A recording from before this rule stores the kind everywhere and has to be recorded again to be checked. The tape never keeps, at a noise path, a value that is typed by a case of the suite, that holds a detected secret, or that stands under a name holding `token`, `secret`, `password`, `api_key` or `session`; it stores the kind there. A secret that none of these find, and that both runs send, is kept, unless the entry says `"keep": false` (`{ "layer": "effects", "path": "requests[0].body.code", "keep": false }`): then the tape stores the kind at that path whatever the runs sent, and the gate takes any value of that kind there. `keep` takes no other value and no other layer. It holds for the requests of the tape only, not for an answer body that repeats the value.
- `record` refuses a case, and names the request without its query, body or headers, when the page opens a WebSocket, sends a `fetch` or XHR request to another origin, or gets an answer that sets a cookie, redirects to another origin or redirects more than 20 times (nothing past the twentieth redirect is asked). A request that is still open when its step ends (an event stream, a long poll) fails the step. `gate` and `replay` fail the step in which the port opens a WebSocket.
- A WebSocket that a page, a frame or a window opens is answered by the runner and never connects. A WebSocket of a worker of the page connects to its server, and the case is refused or fails. One of a worker that another window starts reaches the server too, and fails the same way.
- A request that Chromium sends past the tape, which is what a `keepalive` `fetch` or a `sendBeacon` in a `pagehide` handler does, is aborted before it leaves the browser. `record` refuses the case (`the page sends a request past the tape`), and `gate` and `replay` fail the step. An XMLHttpRequest or a `fetch` without `keepalive` that is all a `pagehide` handler sends never leaves Chromium and is not reported. A call that comes after the last step has been observed is not reported either: Chromium sent nothing for a `pagehide` handler when the case ended.
- A `SharedWorker` is never run. `record`, `replay` and `gate` start Chromium without it (`--disable-shared-workers`), so no request or socket of one leaves the browser, from no frame or window. In its place the page finds a constructor that throws a `SecurityError` and reports the call: `record` refuses the case (`the page uses a SharedWorker`, with the path of its script or `blob:`), and `gate` and `replay` fail the port with `tape SharedWorker`. A call goes unreported, and the case can pass, when it comes after the last step has been observed (a `pagehide` handler when the case ends), or from the `pagehide` handler of a sandboxed frame or a frame of another site while the whole page navigates. Nothing reaches a server then either.
- A redirect on the origin of the page is followed by `record`, and the final answer is stored for the request that the page sent. The page sees that answer with the URL it asked for and `redirected` false, on both sides. Each address of the redirect gets its own cookies.
- `record` fetches these requests itself. It sends no cookie where Chromium put none on the request although the browser holds one for its address (`credentials: 'omit'`), and adds `sec-fetch-site: same-origin`, `sec-fetch-mode: cors` and `sec-fetch-dest: empty`. A page that sets another `mode` is still sent as `cors`. A redirect to a path that has cookies of its own, after an `omit` request whose first address has none, gets those cookies.
- Not covered: the order of reads and mutations among each other beyond what the epochs tell, what the HTTP cache would have answered (routing switches the cache off), preflights, and an answer body that holds the origin of the recording (a port on another origin that follows such a URL fails).

The tape holds answer bodies and request bodies as they are. Nothing is redacted: `record` refuses a case instead (see "Secrets").

## Secrets

`record` refuses to write a recording that holds a detected secret. It checks everything it is about to write for a case (observations after the noise masks, the tape, request and answer bodies as the page sent or got them, an answer of `content-type` `application/x-www-form-urlencoded` by its field names), keys as well as values. A JSON body that repeats a key is also a finding at the body as a whole, so accepting one value does not hide another, and the values that a repeat hides are checked by their names too. Credentials are shared by the cases of one `record`: after the last case, each recording that was written is checked again, and one that holds a credential another case showed is removed (lines already printed are not taken back). A line that it is about to print about a failed case is left out if it holds one of the first five kinds, or a value that a finding of that case names by `named-value`.

| Kind | What is detected |
|---|---|
| `credential` | A value the run itself saw: a cookie value, or the value of `authorization` (the part after the scheme word), `x-xsrf-token` or `x-csrf-token`. Also searched: a cookie value without its quotes and percent-decoded, and the `user:password` pair and the password of `Basic`, decoded. Searched as it is, JSON-escaped, URL-encoded (escapes in either case, and a space as `+`), as base64 and base64url, also inside a longer base64 text at any offset, and as hex. Values shorter than 16 characters are not searched. |
| `jwt` | `eyJ...` `.` `eyJ...` `.`, two base64url parts that start with `eyJ`, each followed by a dot. |
| `pem` | `-----BEGIN <LABEL>-----`. |
| `bearer-or-basic` | `Bearer` or `Basic` (without case), spaces, and a value of 8 or more characters of `A-Z a-z 0-9 . _ ~ + / = -` (final dots not counted). After `Bearer` it holds a digit, one of `. _ ~ + / =` or a capital letter after its first character. After `Basic` it is base64 of a text with a `:` and no control character. |
| `url-password` | `scheme://user:password@`, with both parts not empty and without white space, `/ ? # @ " < >` (the user also without `:`). |
| `named-value` | A value of 16 or more characters without white space that holds a letter and a digit, under a key whose name holds `token`, `secret`, `password`, `api_key` or `session` (without case). The key is the nearest name above the value. |
| `secret-field` | A value in a field of type `password`, or in a field whose `autocomplete` holds `current-password`, `new-password`, `one-time-code`, `cc-number` or `cc-csc`, whether the case typed it or the page filled it, also in a shadow tree, open or closed (its path goes through `shadow-root[1]`), and in a frame, of the same or another site (its path starts with `frame[n]/`, the frames in the order in which they were attached). A frame is searched when its step ends, also one that has not loaded: one that was removed before is not, and one that cannot be searched in 5000 ms (it does not answer, or it is a sandboxed frame that has not loaded) refuses the case. |

- A `localStorage` value is a finding only when one of these finds it.
- A case that uses `fill` or `press` on such a field is refused before anything is typed, and the message names the step and the target. So is a case whose typing reaches such a field another way (a label, a field that turns into one on focus, focus that moves on a key into a field of the page or of a frame, `delegatesFocus`): the key or the input is stopped in the page before it is inserted, and no handler of the page hears of it. A field that turns into a secret field only after the value is in it (in its `input` handler) is refused right after the action, also when the handler then removes it or leaves the page, and one that turns before its typing step has ended (after a timer, a frame or an answer) refuses the case too. Typed fields are watched until that step ends: a later step may turn one into a password field. The page has had the value by then. A synchronous XMLHttpRequest sent after the change throws instead, and once the runner has heard of the change no request leaves the browser (measured for a navigation that carries the value). What the handler sends synchronously before it changes the field reaches the server. An error about any other step names the step and the target and never the typed value.
- Typed values are not printed. A step is described without the value of `fill`, and `press` shows a named key (`Enter`, `Shift+Tab`) or `a typed key`. In what `record`, `replay`, `gate` and `drift` print, and in `summary.txt` and `report.json`, every value that a case of the suite types stands as `[typed]` wherever it shows up again: in a target name, an error, an address, a difference or a literal. It is found as written, without regard to case, with collapsed white space, line by line, and in its JSON and URL encodings. A value shorter than 4 characters is replaced only where it stands alone. Keys of one character are found when two or more `press` steps in a row on one target make them up, not one at a time. Not found: a value that the page cuts, splits or encodes in another way, and what screenshots show. The recordings hold what the page showed and sent, and the log that Playwright writes with `DEBUG=pw:api` holds the values.
- A refused case exits 1 and leaves no recording of it, also not the one from before. The message names the case, the step, the layer, the path and the kind, and no value, part of a value or hash of one. A key that is itself a finding is shown as its kind (`storage["<jwt>"]`). The layers are those of `noise` and `tape` (`[n]` is the entry of `tape.json`).
- The query of `--url` is checked before the first line is printed, and `record` does not print it. An error about a step, from any command, holds no query of an address (and no summary or `report.json` holds the query of `--url` or `--original-url`). A finding there refuses every case of the suite. A user name or a password in `--url` or `--original-url` is a usage error (exit 2).
- A false alarm is accepted in the case, one finding per entry, with `*` for any index. The lock covers it. There is no option that accepts everything, and a case that types into a secret field cannot be accepted.

```json
"accept": [
  { "layer": "dom", "path": "html[1]/body[1]/main[1]/p[1].attrs[\"data-session\"]", "kind": "named-value", "reason": "a made-up id of the demo" }
]
```

- Not covered: replacing secrets by fakes, personal data, screenshots (none is written), a credential shorter than 16 characters (a short cookie or a short decoded password) or encoded in any way not listed above (HTML entities, encoded twice, base64 broken into lines, compressed, hashed, split), a form-encoded text that is not an answer of that content type or a request body (for `named-value`), a cookie that a script sets and removes within one step. What `replay` and `gate` print and store is not searched for secrets, only typed values are replaced there. `--redact` keeps values out of it (see "Redacted reports").

## Sizes, positions and screenshots

Sizes, positions and screenshots change with the fonts and the machine while the page and its CSS stay the same. So they are compared only against the original run again in the same command: `gate` and `replay` take `--original-url`. Everything else is compared against the stored recording, on any machine.

- A longhand whose value the browser took from layout is split. The capture asks the browser twice: `getComputedStyle` for the laid-out value and `computedStyleMap()` for the declared one (`auto`, `50%`, `3px`). Where both give the same text, the value is stored as before. Where they differ, the declared value is stored at `.style.<longhand>` and compared anywhere, and the laid-out value is kept at `.layout.<longhand>` and compared only in the same session. A probe on the `html` element checks first that the browser gives a declared value; where it does not, and always for `::before` and `::after`, a fixed list of names is used instead (`width`, `height`, `inline-size`, `block-size`, `perspective-origin`, `transform-origin`, `top`, `right`, `bottom`, `left` and the four `inset-*`), stored as `[laid out]`.
- A custom property whose value is a length in pixels (`--initial-height: 58px`, often measured by a script) counts as a size: stored as `[laid out]`, in the computed style and in a `style` attribute, with its value compared only in the same session.
- The border box of each element (`.box.x`, `.y`, `.width`, `.height`) and the screenshot of each step are compared only in the same session.
- `record` stores none of these: the recording (format `angular-anything/recording@4`) holds no box, no laid-out value and no PNG, so its lock covers only what a gate compares from it, and a recording made on one machine gates on another. `record` still runs the original twice and fails on sizes or screenshots that differ between the runs, as before; a case names such sizes as noise (`.box.width`, `.layout.width`). A recording in an older format is refused with a message that says to record it again.
- With `--original-url` the original is run first, the way the port is run: the same case, the stored frames, a fresh browser context. Its stored layers must equal the recording in every step and it must be at rest after the stored frames. If not, the case fails with `the original at <url> does not match its recording`, the first difference, and no size, position or screenshot is compared. Then the port runs, and its sizes, positions and screenshots are compared with those of the original's run, with the case's noise masked on both. When a screenshot differs, the report folder gets both images (`03.png` and `03.original.png`). Its `fetch` and XHR requests are answered from the same tape as those of the port, by the same rules, so `--original-url` only has to serve the page and its files. A finding of the tape in that run counts as a mismatch with the recording.
- Without `--original-url` none of this is compared. The summary says so (`Sizes, positions and screenshots were not compared: no --original-url was given.`), `report.json` has `"original": null`, and the screenshots count as not compared. The stable screenshot is still taken on the port, so both sides wait the same way.

A page can measure a size in a script and write it into another property (`height: var(--front-toast-height)`), which the browser then reports as a fixed length. The tool cannot tell it from a length in the CSS, so the case lists it in `measured`:

```json
"measured": [
  { "layer": "style", "path": "html[1]/body[1]/main[1]/ol[1]/li[*].style.height" },
  { "layer": "style", "path": "html[1]/body[1]/main[1]/ol[1]/li[*].style.block-size" },
  { "layer": "dom", "path": "html[1]/body[1]/main[1]/ol[1]/li[*].inline.top" }
]
```

The browser reports one size under more than one name (`height` is also `block-size`), and each name that the report shows is listed. A listed value is stored as `[laid out]` and compared only with `--original-url`, like any other size. The path ends in `.style.<property>` (a computed value) or `.inline.<property>` (a `style` attribute). A port that lacks the property still fails, and `record` fails on an entry that matches nothing. A changed list needs a new recording, because the lock covers the case.

## Differences and groups

Every difference in `report.json` has a `layer`, a `path`, and a `kind`: `text` (two strings), `value` (another value of the same kind, also a broken tie between masked values), `type` (another kind of value), `missing`, `extra` or `tape` (a finding of the network tape). A `text` difference also has `at`: the `offset` of the first differing character, counted in code points from 0, and up to 16 characters on each side of it, with the differing character in `⟨ ⟩` (`⟨⟩` where one text ends).

Differences are grouped over all cases and steps, before the report cuts each layer to its first 10. The group of a difference is its layer, its path with every index replaced by `*`, and its kind. Its `id` is the first 8 hex digits of the SHA-256 of those three. The summary says `N distinct differences in M cases` and lists the groups by their number of differences (then by the number of cases), each with its first example: the first 20 in the summary and the console, all in `report.json` under `distinct`. The differences between the original and its recording are not in the groups.

## Redacted reports

`replay` and `gate` take `--redact`. The console, `summary.txt` and `report.json` then say where something differs and what shape it has, and hold no recorded value, no typed value and no text of a page:

- A value is its type, for a string, a list or an object also its length and the first 8 hex digits of a SHA-256. A number, a boolean and `null` are their type only.
- A path keeps the names of elements made of letters and digits only, the field names of the tool, the standard ARIA names, a short list of attribute names and CSS properties that are no custom properties. Every other name is `<hash>`, and so is every key below `payload`, `body`, `storage` and `query`, and the address of a tape finding.
- A step keeps its action, its roles, indices and named keys. Names, values and paths are `<hash>`.
- Error messages and notes on reads are `hidden, length N, hash H`, after the step number where there is one. Addresses are cut to their origin (their query is in no report, also without `--redact`). No screenshot is written.

Kept as they are: the names of suites, sources, cases, recording files and port source files, lengths, offsets, counts, frames and timings, and a message about the command line (exit 2), which repeats what was typed there. A hash of a short value can be guessed by trying values. `record` and `drift` take no `--redact`, and the recordings themselves are not redacted.

## Drift

`drift` takes both addresses, `--url` and `--original-url`. It is a `gate` with the original run again, and it says which side moved:

- `the original changed`: the original no longer matches its recording.
- `the port regressed`: the port no longer matches the recording.
- Both for one case: record again, then gate the port against the new recording. The recording cannot tell whether the port followed the original.
- `sizes or positions differ between the original and the port`: both match what the recording holds, or the port was not reached further, and their sizes or positions differ from each other. The recording holds no size, so which side moved is not known. `report.json` has `drift.sizes: "differ"`. A port that differs from the recording is listed as regressed only.
- `not checked`: the lock or the recording is refused, or a side gave no answer and nothing differed before: its address cannot be reached (a refused connection, a connection reset before the case got any answer, a name that is not resolved, an address error, a network timeout) or a navigation got no answer within the time limit. Differences found before such an error count. A side that has answered and then fails differs: a navigation that it redirects to an address that fails or does not answer, a connection that it resets after it answered earlier in the case, a page that arrives and does not finish loading, and a server that closes a connection without any answer (`net::ERR_EMPTY_RESPONSE`). So a route that resets or hangs is told from a dead server only as far as this: a reset in the first request of a case, and a navigation that is not redirected and gets no answer, are `not checked`.

`drift` does not see a change of an API. The original and the port get the answers to their `fetch` and XHR requests from the tape, so a backend that answers differently today, or not at all, changes nothing. Only what is not on the tape, such as the page, its scripts, styles and images, comes from the two servers.

It exits 0 only when every case matches on both sides and their sizes and positions agree, and writes `reports/<source>/summary.txt` and `report.json` (`command` is `drift`, and each checked case has `drift.original` and `drift.port`). While the original of a case differs, its sizes, positions and screenshots are not compared.

A GitHub Actions workflow for the Tasks fixture in this repository. For another project, replace the two build and serve lines by the ones that start its original and its port. The workflow has not been run yet. The report holds page text and, when screenshots differ, images, so upload it only where that is allowed.

```yaml
name: drift
on:
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:
  push:
    branches: [main]
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 12.18.0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm fixtures:build
      - run: |
          node fixtures/server.ts &
          timeout 60 bash -c 'until curl -sf http://localhost:4101 >/dev/null && curl -sf http://localhost:4104 >/dev/null; do sleep 1; done'
          node src/cli.ts drift fixture --source react --url http://localhost:4104 --original-url http://localhost:4101
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: drift-report
          path: reports/
```

## Recorded values in the port

A port can pass by holding the recorded answers. `gate` looks for that when it is given both `--original-source <dir>` and `--port-source <dir>` (one alone is a usage error, none means no check).

- A literal is a quoted string, a template string, a number, the text between two tags or a quoted attribute, also inside an inline template. In a template with `{{ }}`, a control flow block or an ICU message (`plural`, `select`, `selectordinal`), the text beside the braces and block headers counts on its own, so also each branch of a message. Numbered character references and the common named ones (the Latin-1 set and the usual punctuation, quotes, arrows, `&euro;` and `&trade;`) are read in the port and in the original. A quoted attribute may span lines. It counts when it is a string of 8 or more characters or a number of 5 or more significant digits, equals a value of a step file or of the tape of a case of the suite (white space joined and trimmed, a number by its value), and the original source does not hold it.
- 3 or more distinct ones fail the gate. 1 or 2 are noted. A value that the port may hold as it is stays with a comment `recorded-literal: reason` on its line. The reason must not be empty, and the same words in a string or in text are no comment. In an inline template, `<!-- recorded-literal: reason -->` counts. A `<!--` right before `recorded-literal:` makes it count wherever it stands, also inside a string.
- A port source that names `recording.json`, `tape.json`, `lock.json` or `recordings/<source>` outside a comment fails. This has no escape.
- Read in the port: `.ts`, `.js` (also `.mts`, `.cjs` and the like), `.tsx`, `.jsx`, `.html`, `.css`, `.scss`, `.less`, `.json`, `.vue`, `.svelte` and `.svg`. Not read, on both sides: `node_modules`, `dist`, `test`, `tests`, `__tests__`, folders whose name starts with a dot, and `*.test.*` and `*.spec.*` files.
- The original source folder must not be or hold the port source, and must not hold the project's `recordings` folder or lie inside it, because every value would then count as the original's. Both are usage errors, so the root of a project that holds the port or the recordings is refused. The port source may hold the original. A file elsewhere in the original source that equals, as JSON, a file below `recordings` is not counted as part of the original.
- The original source folder has to hold everything the port may take from. A port of a library needs the library's code there too: with only the app of the sonner trial, 12 constants of the library (class names, SVG paths, labels) are reported. This is intended, because the check cannot tell a constant of a library from a copied value. `node_modules` and `dist` are not read, so copy the app's source and the library's code into one folder outside them and name that folder; the sonner trial then passes.
- Not caught: a value that is split, joined, encoded or computed, a value in a file that is not read or outside the port folder, a rarer named character reference, fewer than 3 values, a value that also appears anywhere in the original source, a copy of recordings in the original source that was changed or made from an older recording, and a literal hidden by something that only looks like a comment or a quote. Comments, strings and regular expressions are told apart by simple rules, not by a parser: `//` and `/*` in the text of a JSX, Vue or Svelte element count as text only when a tag stands before them and a closing tag after them on the same line, and a regular expression is seen only where an operator, an opening bracket, `return` or the start of a line comes before it.

## The canonical DOM

The DOM is compared as the browser means it, and the browser is asked for what it knows. No CSS is implemented a second time.

- Text. Adjacent text nodes are joined. Where the parent collapses whitespace (`white-space-collapse` is `collapse`), a run of space, tab and line break counts as one space. A space counts at the start or the end of a text where the browser renders it, or would on a wider line (`<span>a</span> <span>b</span>` is not `<span>a</span><span>b</span>`). It does not count at the start or the end of a block, next to a `br`, next to a block-level or out-of-flow element, after another space, or in whitespace between the items of a list, a table or a flex container. Where a line wraps is never the reason, so the same text gives the same DOM at every width. Which element is a block, an inline box or an atomic inline (an image, a button, an inline block) comes from `getComputedStyle`. Where the parent preserves whitespace (`pre`, `pre-wrap`, `break-spaces`) the text is compared as written. Under `pre-line` a line break counts as written, a run of spaces and tabs counts as one space, and spaces around a line break are removed. A no-break space is text.
- The `style` attribute is compared as the declarations the browser parsed: each property with its value and priority, in no order. `color: red` and `color: red !important` differ, `color: red; margin: 0` and `margin: 0; color: red` do not. A declaration the browser dropped is not there. A colour in a property that accepts a single colour (`color`, `fill`, `border-top-color`, so also a `border` shorthand) compares as the colour the browser reads, so `red`, `#f00`, `rgb(255, 0, 0)` and `hsl(0 100% 50%)` are equal. The browser is asked through a canvas. `currentcolor`, a value with `var()`, a keyword such as `inherit` and a custom property stay as written. In `box-shadow`, `text-shadow`, `scrollbar-color` and a gradient a colour keyword and the same colour in numbers still differ. A `url()` is resolved against the base URL of the document and the origin of the page in it is replaced by `[page-origin]`, so `url(a.png)`, `url(./a.png)` and the absolute URL on the own origin are equal. A `url(#id)` stays as written, and so does text in a CSS string that only looks like a `url()`.
- A `textarea` is compared by its value. Its text child is not part of the DOM.
- A boolean attribute (`disabled`, `hidden`, `required`, `selected` and the others of the list) loses its value only on an element that has a boolean property of that name, so `selected="1"` on a custom element still differs from `selected="2"`. `hidden="until-found"` keeps its value.
- Inside an AngularJS app an attribute is dropped when the injector of the page has an attribute directive of that name (built-in ones included), when it is a declared binding of a directive on that element (`.component()` and element directives included), when its name starts with `ng-attr-`, `ng-prop-` or `ng-on-`, or when AngularJS reads it without a directive: `ng-app`, `ng-strict-di`, `ng-csp`, `ng-jq`, `<name>-start` and `<name>-end` of a directive that spans elements, `ng-true-value`, `ng-false-value`, `ng-trim`, `ng-ref-read`, `ng-switch-when-separator`, `ng-transclude-slot` and `ng-animate-ref`. Any other `ng-` attribute stays. The name of a directive and a text binding (`@`) stay when the browser reads the attribute: a property of the element (without case, and `class` is `className`, `for` is `htmlFor`, `accept-charset` is `acceptCharset`, `http-equiv` is `httpEquiv`), a global HTML attribute, `aria-*`, `role` or an SVG presentation attribute on an SVG element. A text binding written with a `data-` prefix is dropped even when the browser reads it.
- In a computed value the origin of the page inside `url()` is replaced by `[page-origin]`, also in a value that holds lengths, so a relative `url()` compares equal on two origins. The browser leaves the `url()` of a computed custom property as written, so the capture resolves it as in a `style` attribute, against the base URL of the document and not against the stylesheet that declares it. A URL to another host stays as it is, and so does a URL in an attribute. An Angular CLI build rewrites the file name of an asset in a global stylesheet (`logo.png` becomes `media/logo-<hash>.png`), and that port fails.
- A custom property registered with `inherits: false` is compared per element: a property that the parent lists and the child does not is recorded as missing (an empty value) on the child.
- An event payload is recorded with what it holds, read as JSON reads it (`toJSON`, own enumerable keys). A `Set` and a `Map` are recorded with their entries. `NaN`, `Infinity`, `-Infinity`, `-0`, a `BigInt`, and `undefined` and a hole in a list are told apart. A `RegExp` is its source and flags. An `Error` is its name, its message, its own enumerable fields, and `cause` and `errors` when it has them, not its stack. A getter or a `toJSON` that throws is marked where it is, and the other fields stay. A DOM node is marked with its node name and a window is marked, and neither is walked. A reference back to an object that holds it is marked as circular. An object that appears twice is written out twice, unless the payload has more than 10,000 values: then each object is written once and every later appearance is marked as repeated. A key with the value `undefined` equals a missing key.

## Choosing the selector of a component in the Angular port

An Angular component is mounted on an element that the original already has, so that no wrapper element appears. Its selector decides what Angular leaves on that element, and the gate compares attributes. The convention:

- The selector is something the original element already matches. A tag and a class (`li.task`, with `<li class="task" [task]="task">` in the parent template), or an attribute the element already has (`[id=root]` for the root component).
- If the original element has nothing to match, the selector is an attribute and the input that carries the value is an alias that is bound: `selector: 'li[appTaskRow]'` with `input.required<Task>({ alias: 'appTaskRow' })` and `<li [appTaskRow]="task">`. A bound alias is a property binding and leaves no attribute in the DOM.
- A plain attribute selector (`<li appTaskRow [task]="task">`) leaves `apptaskrow=""` on the element. The original does not have it and the gate fails on it.

When the only differences of a step in the DOM are attributes with an empty value that only the port has and that the browser does not read on that element, the summary of the gate names this convention under the step. The line says that an attribute is not what it seems and lists the attribute names. It does not appear when anything else differs in the DOM of that step, when the attribute has a value, when the original has it too, or when the browser reads it on that element (`hidden`, `title`, `tabindex`, `aria-*` and the others that are properties or global attributes). It is a hint, it does not change the result.

The Tasks fixture port uses `li.task` for its row component, and every observation and screenshot of the 19 cases is the same as with the aliased input.

A library port may keep the API of a component of its own (`<ngx-toaster>` that renders the `section` of the original inside it) when its element leaves no trace: the capture leaves out an element, and keeps its children in its place, when its name holds a dash, Angular created it, no custom element of that name is registered, it has no attribute, and it renders as `display: contents` (for example with `styles: 'ngx-toaster { display: contents }'` and `ViewEncapsulation.None`). Anything else about such an element, an attribute or a style that it passes on to its children, still shows as a difference.

## Dialogs and windows

`alert`, `confirm`, `prompt`, `window.print` and `window.open` are logged in the side effects (`popups`) of the step in which the page calls them, in the order of the calls, with what a user can tell apart: the kind and the message, for `prompt` the default value, for `window.open` the URL (resolved against the page), the target and the features, for `print` nothing else.

- The runner does not answer a dialog. Chromium dismisses it as it did before: `alert` returns, `confirm` returns `false`, `prompt` returns `null`. A page that asks before a delete is recorded as cancelled. A step that answers a dialog is not built.
- A dialog does not stop the clock. The call is logged when it returns, and the step settles in the frames it would have taken without it.
- A window that `window.open` opens is real: the page gets a window object back (`typeof` is `object`, `closed` is `false`, `opener` is the page), the same for the original and for the port. Its network requests are refused, nothing in it is observed, and the runner closes it at the end of the step, so the page sees `closed` become `true` in the next step.
- Not logged, and a port that differs there passes: the dialog that a browser shows when a page with a `beforeunload` handler is left (Chromium leaves the page without a question), and a window that a link with `target="_blank"` opens when it is clicked (the DOM layer holds its `href`, `target` and `rel`, but a port that cancels the click of the link passes). A call inside the window that `window.open` opened is not logged, and neither is what a page writes into that window, nor an `alert` or `confirm` in a `pagehide` handler.
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
- A path that the case names is masked in every step in which it exists, also where the two runs happen to agree, so the exit code does not depend on the draw (the tape is the exception, see below). `record` lists the entries at which the two runs did not differ.
- The step files hold no value at a masked path: only its kind (`string`, `empty string`, `number`, `boolean`) and a group number. The tape keeps a request part that both runs sent (see "The network tape"). A mask never hides a missing value. At a masked path the port must have a value of the same kind: a missing value, a number for a string, an object for a string and an empty string for a string with text all fail.
- Masked strings of 8 or more characters that were equal to each other in both runs (the id in `localStorage` and the id in the event, the `id` and the `for` of an input and its label, the same token in two steps) must be equal to each other on the port, within a step and across the steps of a case. Shorter values are not tied together, because two of them can agree by chance. A page that picks one of two long strings at random for two paths can tie them by chance.
- `gate` and `replay` apply no mask that the case does not name, and refuse a recording that masks a value the case does not name. A recording of another format is refused and has to be recorded again.

Strings with structure are compared by their parts, and a difference or a mask names the part:

- A `localStorage` value that parses as JSON to an object or a list is compared by its parts: spaces and escapes do not count, the order of the keys does count (`storage.settings.$order`), and a number counts as written (`1.1` and `1.10` differ, so do `1e2` and `100`). Any other value is a string: `7`, `"seven"`, `null` and text that is not JSON. A value that parses on one side and not on the other is a difference at the key. Keys of integer form are ordered by the JavaScript engine, so the order of those among themselves is not told.
- The URL of a request or of a read is `path` (segments as sent), `query` and `origin` (only when it is not the origin of the page). Query parameters are decoded, `+` and `%20` are both a space, the order of parameters with different names does not count, and repeated names keep their order (`?tag=a&tag=b` differs from `?tag=b&tag=a`). The URL of the page has its path segments decoded, its query compared like that of a request, and its fragment as sent. A string is a URL only at those places: a stored value or a field that looks like a URL is a string, and an attribute that holds a URL is compared as written.
- A body is a form (`application/x-www-form-urlencoded`) compared like a query, a multipart body, or JSON (an object or a list, parsed, in no key order). A multipart body is compared by its parts: the name, the file name, the type, the size and the content of a file (as a SHA-256), the text of a field. The boundary is never compared, and neither is the order of parts with different names. Parts with one name keep their order. Anything else is a string. A name, a file name, a value or a whole body whose bytes are not UTF-8 is `base64:` and its bytes, and so is such a percent sequence in a query.

A port that stores `7` where the original stores its random token passes: a stored value that is no JSON object or list is a string, and so is the token, so their kinds cannot tell them apart.

## Notes

angular-anything is not affiliated with Angular or Google.

angular-anything collects no telemetry.
