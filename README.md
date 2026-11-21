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
- `cases/fixture`, nine cases for the Tasks fixture.
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

`record` exits 0 when every case was recorded. `gate` and `replay` exit 0 when every step of every case matches the recording, 1 on a mismatch or a refused recording, and 2 on a wrong command line. Both print a summary and write it to `reports/<source>/summary.txt` next to `reports/<source>/report.json`. `gate` also exits 1 when `recordings/<source>` holds a recording of the suite whose case is gone.

## What is compared

After each step the page settles and one observation is captured:

- the accessibility snapshot and the literal `aria-*`, `role`, `tabindex` and `required` attributes
- the DOM from the `html` element down, without `head`, `script`, `style` and `link`, and without the marks a framework leaves where that framework is proven for the element
- every computed CSS longhand and the border box of each element, and of each `::before` and `::after` that has content
- the events sent through `window.__aa.emit`
- the requests, `localStorage`, the URL, the document title and the focused element
- a screenshot, which is reported and never fails the gate

In a recorded observation an element lists only the longhands whose value differs from its parent element. The `html` element lists all of them.

## Notes

angular-anything is not affiliated with Angular or Google.

angular-anything collects no telemetry.

## License

MIT. See [LICENSE](LICENSE).
