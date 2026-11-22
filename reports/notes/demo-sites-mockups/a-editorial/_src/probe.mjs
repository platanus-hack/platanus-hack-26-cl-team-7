import { chromium } from '/Users/lp1/.local/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file://' + process.argv[2]);
await p.waitForTimeout(1500);
await p.evaluate(() => document.fonts.ready);
console.log(await p.evaluate(() => ['a','b','c','d','e','f'].map(i => i + ':' + document.getElementById(i).getBoundingClientRect().width)));
await b.close();
