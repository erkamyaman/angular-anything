import { chromium } from 'playwright';
import playwrightPackage from 'playwright/package.json' with { type: 'json' };

export const PLAYWRIGHT_VERSION = '1.65.1';

export type Found = {
  node: string;
  playwright: string;
  launch: () => Promise<{ title: string; version: string }>;
};

export const real: Found = {
  node: process.versions.node,
  playwright: playwrightPackage.version,
  async launch() {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto('data:text/html,<title>doctor</title>');
      return { title: await page.title(), version: browser.version() };
    } finally {
      await browser.close();
    }
  },
};

export async function doctor(found: Found = real, print: (line: string) => void = console.log): Promise<number> {
  let failed = false;
  const report = (ok: boolean, text: string) => {
    print(`${ok ? 'ok  ' : 'FAIL'}  ${text}`);
    if (!ok) failed = true;
  };

  report(Number(found.node.split('.')[0]) >= 24, `Node ${found.node} (needs 24 or newer)`);
  report(
    found.playwright === PLAYWRIGHT_VERSION,
    `Playwright ${found.playwright} (needs exactly ${PLAYWRIGHT_VERSION})`,
  );

  try {
    const { title, version } = await found.launch();
    report(title === 'doctor', `Chromium ${version} launches headless and loads a page`);
  } catch (error) {
    report(false, `Chromium does not launch: ${String(error).split('\n')[0]}`);
    print('      Run: pnpm exec playwright install chromium');
  }

  return failed ? 1 : 0;
}
