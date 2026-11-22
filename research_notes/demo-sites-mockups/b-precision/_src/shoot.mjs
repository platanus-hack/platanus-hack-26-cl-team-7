// node _src/shoot.mjs [name...] : 1440x900 and 390x844 shots into shots/ (full-page review copies into shots/full/).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/Users/lp1/.local/lib/node_modules/@playwright/cli/package.json');
const { chromium } = require('playwright-core');

const root = path.resolve(import.meta.dirname, '..');
fs.mkdirSync(path.join(root, 'shots/full'), { recursive: true });
const all = ['n1-login', 'n2-resumen', 'n3-colaboradores', 'n4-error-reaper', 'v1-inicio', 'v2-liquidacion', 'v3-archivo-expuesto', 'v4-error-reaper'];
const names = process.argv.length > 2 ? process.argv.slice(2) : all;

const browser = await chromium.launch();
for (const [suffix, w, h] of [['', 1440, 900], ['-movil', 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'es-CL' });
  const pg = await ctx.newPage();
  for (const n of names) {
    await pg.goto(`file://${root}/${n}.html`, { waitUntil: 'networkidle' });
    if (!n.startsWith('v3')) {
      await pg.waitForFunction(() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(document.body).backgroundColor !== 'rgb(255, 255, 255)' || document.title.includes('Inicia') || document.title.includes('Error'), null, { timeout: 15000 });
      await pg.evaluate(() => document.fonts.ready);
    }
    await pg.waitForTimeout(400);
    await pg.screenshot({ path: path.join(root, `shots/${n}${suffix}.png`) });
    await pg.screenshot({ path: path.join(root, `shots/full/${n}${suffix}-full.png`), fullPage: true });
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const font = await pg.evaluate(() => document.fonts.check('14px Geist'));
    console.log(n + suffix, 'hscroll:', over, 'geist:', font);
  }
  await ctx.close();
}
await browser.close();
