#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import playwrightPackage from 'playwright/package.json' with { type: 'json' };
import { checkName, UsageError } from './case.ts';
import { record } from './record.ts';
import { replay } from './replay.ts';

const PLAYWRIGHT_VERSION = '1.65.1';

const usage = `Usage: angular-anything <command>

Commands:
  doctor                                               Check Node, Playwright and Chromium
  record <suite> --source <name> --url <original-url>  Record the original
  replay <suite> --source <name> --url <port-url>      Replay against the port and write a report
  gate   <suite> --source <name> --url <port-url>      Replay, check the lock, exit 1 on a mismatch

Cases are read from cases/<suite>, recordings are kept in recordings/<source>,
reports are written to reports/<source>, all below the current directory.
A query in the url, such as ?bug=aria, is added to every page the cases open.`;

async function doctor(): Promise<number> {
  let failed = false;
  const report = (ok: boolean, text: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${text}`);
    if (!ok) failed = true;
  };

  const node = process.versions.node;
  report(Number(node.split('.')[0]) >= 24, `Node ${node} (needs 24 or newer)`);

  const playwright = playwrightPackage.version;
  report(
    playwright === PLAYWRIGHT_VERSION,
    `Playwright ${playwright} (needs exactly ${PLAYWRIGHT_VERSION})`,
  );

  try {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto('data:text/html,<title>doctor</title>');
      report(
        (await page.title()) === 'doctor',
        `Chromium ${browser.version()} launches headless and loads a page`,
      );
    } finally {
      await browser.close();
    }
  } catch (error) {
    report(false, `Chromium does not launch: ${String(error).split('\n')[0]}`);
    console.log('      Run: pnpm exec playwright install chromium');
  }

  return failed ? 1 : 0;
}

async function verify(command: 'record' | 'replay' | 'gate', args: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { source: { type: 'string' }, url: { type: 'string' } },
      allowPositionals: true,
    });
    if (positionals.length !== 1 || !values.source || !values.url) {
      throw new UsageError(`${command} needs one <suite>, --source <name> and --url <url>`);
    }
    const url = URL.parse(values.url);
    if (!url || !/^https?:$/.test(url.protocol) || url.pathname !== '/' || url.hash) {
      throw new UsageError(`--url must be an http or https address without a path, such as http://localhost:4104`);
    }
    const options = { root: process.cwd(), suite: positionals[0], source: checkName('source', values.source), url };
    return command === 'record' ? await record(options) : await replay({ ...options, gate: command === 'gate' });
  } catch (error) {
    const { code, message } = error as Error & { code?: string };
    if (error instanceof UsageError || code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`${message}\n\n${usage}`);
      return 2;
    }
    console.error(`${command} failed: ${message}`);
    return 1;
  }
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'doctor':
    process.exitCode = await doctor();
    break;
  case 'record':
  case 'replay':
  case 'gate':
    process.exitCode = await verify(command, args);
    break;
  case '--help':
  case '-h':
    console.log(usage);
    break;
  default:
    console.error(usage);
    process.exitCode = 2;
}
