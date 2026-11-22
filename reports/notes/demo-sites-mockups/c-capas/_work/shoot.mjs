import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire('/Users/lp1/.local/lib/node_modules/@playwright/cli/node_modules/playwright-core/package.json');
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const full = args.includes('--full');
const names = args.filter((a) => !a.startsWith('--'));
const all = ['n1-login', 'n2-resumen', 'n3-colaboradores', 'n4-error-reaper', 'v1-inicio', 'v2-liquidacion', 'v3-archivo-expuesto', 'v4-error-reaper'];
const list = names.length ? names : all;
const browser = await chromium.launch();
try {
  for (const name of list) {
    for (const [suffix, vp] of [['', { width: 1440, height: 900 }], ['-movil', { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto('file://' + path.join(root, name + '.html'), { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const info = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i).join(','),
      }));
      const bad = info.sw > info.cw ? ' HSCROLL ' + info.sw + '>' + info.cw : '';
      await page.screenshot({ path: path.join(root, 'shots', name + suffix + '.png') });
      if (full) {
        // pagina completa para revision: expande el contenedor de scroll interno
        await page.addStyleTag({ content: 'html,body{height:auto!important;overflow:visible!important} .h-dvh{height:auto!important;overflow:visible!important} main{overflow:visible!important} aside{height:auto!important}' });
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(here, 'full-' + name + suffix + '.png'), fullPage: true });
      }
      console.log(name + suffix, 'fonts:', info.fonts + bad);
      await ctx.close();
    }
  }
} finally { await browser.close(); }
