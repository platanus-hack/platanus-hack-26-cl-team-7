import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire('/Users/lp1/.local/lib/node_modules/@playwright/cli/node_modules/playwright-core/package.json');
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('file://' + path.resolve(here, '../index.html'), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(here, 'full-index.png'), fullPage: true });
} finally { await b.close(); }
