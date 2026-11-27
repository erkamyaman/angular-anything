<h1 align="center">Angular Anything</h1>

<p align="center">
<a href="https://github.com/erkamyaman/angular-anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-111111?style=flat&colorA=111111&colorB=c3002f" alt="MIT license"></a>
<img src="https://img.shields.io/badge/status-early-111111?style=flat&colorA=111111&colorB=c3002f" alt="Status: early">
<img src="https://img.shields.io/badge/Angular-22-111111?style=flat&colorA=111111&colorB=c3002f" alt="Angular 22">
</p>

<p align="center">
Move your app to Angular, and prove it still behaves the same.
</p>

<p align="center">
<b>Documentation:</b> <a href="https://github.com/erkamyaman/angular-anything/blob/main/docs/reference.md">reference</a>
</p>

## Sponsors

<p align="center">
  Made in Türkiye 🇹🇷 by <a href="https://github.com/erkamyaman">erKam Yaman</a><br>
  Angular Anything is free and open source. If it helps your work, sponsoring keeps it going.
</p>

<p align="center"><sub>Your safety comes first: sponsors get a logo and a link here, nothing more. No paid recommendations and no setup guides for third-party AI API resellers, so nothing here steers your code, keys or data somewhere you didn't choose.</sub></p>

<p align="center">
  <a href="https://github.com/sponsors/erkamyaman"><img src="https://img.shields.io/badge/Become_a_sponsor-%E2%9D%A4-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Become a sponsor"></a>
  <a href="https://buymeacoffee.com/erkamyaman"><img src="https://img.shields.io/badge/Buy_me_a_coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy me a coffee"></a>
</p>

<p align="center">Sponsoring as a company, or anything else? <a href="mailto:erkamyaman35@gmail.com">erkamyaman35@gmail.com</a></p>

<p align="center">Moving an app to modern Angular? I offer consulting for Angular migrations: <a href="mailto:erkamyaman35@gmail.com">erkamyaman35@gmail.com</a></p>

## Quick start

Angular Anything is not on npm yet, so run it from a clone. You need Node 24 or newer and pnpm.

```sh
git clone https://github.com/erkamyaman/angular-anything
cd angular-anything
pnpm install
pnpm exec playwright install chromium
pnpm fixtures:build
pnpm fixtures:serve
```

In a second terminal, check the Angular port of the sample app against the recording of its React original:

```sh
pnpm aa gate fixture --source react --url http://localhost:4104                # passes
pnpm aa gate fixture --source react --url 'http://localhost:4104/?bug=aria'    # a seeded bug, fails
```

## How it works

1. **Describe** what users do, as short cases ([an example](https://github.com/erkamyaman/angular-anything/blob/main/cases/fixture/add-task/case.json)).
2. **Record** the original (React, Vue or AngularJS). `record` runs each case twice and locks what happened.
3. **Port** it to Angular, by hand or with your coding agent. This tool does not write the port.
4. **Gate** the port. It replays every case and fails on any difference.

**What is compared.** After each step: the accessibility tree, the DOM, computed styles, events, requests that change data, `localStorage`, the URL, the title, focus, dialogs and windows. Sizes and positions are compared when the original runs alongside. Screenshots are reported and never fail the gate.

**No backend needed to check.** Requests the original made with `fetch` or XMLHttpRequest are recorded and answered from that recording.

**Secrets.** `record` refuses to save a case in which it detects a secret (`credential`, `jwt`, `pem`, `bearer-or-basic`, `url-password`, `named-value`, `secret-field`). Detection has limits, so record against test data.

**Limits.** Early software, tested on macOS only. Read the [reference](https://github.com/erkamyaman/angular-anything/blob/main/docs/reference.md) before relying on it.

## Notes

Angular Anything is not affiliated with Angular or Google, and collects no telemetry.

## License

MIT. See [LICENSE](https://github.com/erkamyaman/angular-anything/blob/main/LICENSE).

`trials/` and parts of `recordings/` include third-party work, among it [TodoMVC](https://github.com/tastejs/todomvc) and [Sonner](https://github.com/emilkowalski/sonner) by Emil Kowalski, which `trials/sonner/angular` ports to Angular.
Each keeps its own license (todomvc-app-css is CC BY 4.0). See [THIRD_PARTY_NOTICES.md](https://github.com/erkamyaman/angular-anything/blob/main/THIRD_PARTY_NOTICES.md).
