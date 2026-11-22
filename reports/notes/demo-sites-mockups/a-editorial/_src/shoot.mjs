// node shoot.mjs [name ...]  -> shots/<name>.png (1440x900), shots/<name>-movil.png (390x844), shots/full/<name>.png
import { chromium } from '/Users/lp1/.local/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const all = ['n1-login','n2-resumen','n3-colaboradores','n4-error-reaper','v1-inicio','v2-liquidacion','v3-archivo-expuesto','v4-error-reaper'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : all;
fs.mkdirSync(path.join(root, 'shots/full'), { recursive: true });
const b = await chromium.launch();
const sizes = [['', 1440, 900, 1], ['-movil', 390, 844, 2]];
for (const [suf, w, h, dpr] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr === 2 ? 2 : 1, locale: 'es-CL' });
  const p = await ctx.newPage();
  for (const n of names) {
    await p.goto('file://' + path.join(root, n + '.html'), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    if (!n.startsWith('v3')) await p.waitForFunction(() => document.fonts.check('16px "Inter Tight"') && document.fonts.check('16px "Newsreader"'), null, { timeout: 8000 }).catch(() => console.log('font wait failed', n));
    await p.waitForTimeout(500);
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (sw[0] > sw[1]) console.log('HSCROLL', n + suf, sw);
    await p.screenshot({ path: path.join(root, 'shots', n + suf + '.png') });
    if (!suf) await p.screenshot({ path: path.join(root, 'shots/full', n + '.png'), fullPage: true });
    else await p.screenshot({ path: path.join(root, 'shots/full', n + '-movil.png'), fullPage: true });
  }
  await ctx.close();
}
await b.close();
console.log('ok', names.join(' '));
