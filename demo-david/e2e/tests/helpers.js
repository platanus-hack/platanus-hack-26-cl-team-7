import { expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Test login from the mock data (see demo-david/README.md).
export const ADMIN = { username: 'admin', password: 'changeme' };

// A short unique tag so every run creates its own records and can find them again.
export function uniqueTag(prefix = 'E2E') {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

// Logs in through the API. With page.request the cookie lands in the page's
// browser context, so the next page.goto is already signed in.
export async function login(request, credentials = ADMIN) {
  const res = await request.post('/api/auth/login', { data: credentials });
  expect(res.status(), 'login status').toBe(200);
}

export async function getJson(request, path) {
  const res = await request.get(path);
  expect(res.status(), `GET ${path}`).toBe(200);
  return res.json();
}

export async function categoryId(request, name) {
  const cats = await getJson(request, '/api/categories');
  const cat = cats.find(c => c.name === name);
  expect(cat, `category ${name}`).toBeTruthy();
  return cat.id;
}

export async function accountId(request, name) {
  const accounts = await getJson(request, '/api/accounts');
  const account = accounts.find(a => a.name === name);
  expect(account, `account ${name}`).toBeTruthy();
  return account.id;
}

export async function findTransactions(request, query) {
  const body = await getJson(request, `/api/transactions?limit=200&q=${encodeURIComponent(query)}`);
  return body.transactions;
}

export async function deleteTransactionsMatching(request, query) {
  for (const tx of await findTransactions(request, query)) {
    await request.delete(`/api/transactions/${tx.id}`);
  }
}

// Saves a full-page screenshot. E2E_SHOTS_DIR puts it in a fixed folder;
// otherwise it goes to the test's output folder. Either way it is attached.
export async function shot(page, testInfo, name) {
  const dir = process.env.E2E_SHOTS_DIR;
  let path;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    path = join(dir, `${name}.png`);
  } else {
    path = testInfo.outputPath(`${name}.png`);
  }
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  return path;
}

export function topNav(page) {
  return page.getByRole('navigation').first();
}

// Month label as the client renders it ("May 2026").
export function monthLabel(year, month) {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Clicks the ‹ / › month buttons from the shown month (default: the current one)
// to the given month.
export async function goToMonth(page, year, month, from = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }) {
  const diff = (year - from.year) * 12 + (month - from.month);
  const button = page.getByRole('button', { name: diff < 0 ? '‹' : '›', exact: true });
  for (let i = 0; i < Math.abs(diff); i++) await button.click();
  await expect(page.getByText(monthLabel(year, month), { exact: true })).toBeVisible();
}

export function acceptNextDialog(page, messages = []) {
  page.once('dialog', dialog => {
    messages.push(`${dialog.type()}: ${dialog.message()}`);
    dialog.accept();
  });
  return messages;
}

// Reads what the visitor sees, from the computed styles: the page title's colour
// against the colour behind it (WCAG contrast ratio), and every piece of visible
// text or form control whose contrast is so low that it is effectively invisible.
export function readability(page) {
  return page.evaluate(() => {
    const parse = value => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const luminance = ({ r, g, b }) => {
      const channel = v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const mix = (top, below) => ({
      r: top.r * top.a + below.r * (1 - top.a),
      g: top.g * top.a + below.g * (1 - top.a),
      b: top.b * top.a + below.b * (1 - top.a),
      a: 1,
    });
    // The colour behind an element: its own and its ancestors' backgrounds, stacked.
    const backdrop = element => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color && color.a > 0) {
          layers.push(color);
          if (color.a === 1) break;
        }
      }
      let result = { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of layers.reverse()) result = mix(layer, result);
      return result;
    };
    const ratio = element => {
      const style = getComputedStyle(element);
      const back = backdrop(element);
      const text = parse(style.color);
      const front = mix({ ...text, a: text.a * Number(style.opacity) }, back);
      const [light, dark] = [luminance(front), luminance(back)].sort((a, b) => b - a);
      return (light + 0.05) / (dark + 0.05);
    };
    const visible = element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // Off-screen elements (Recharts parks a hidden measuring span above the page) do not count.
      const onScreen = box.bottom > 0 && box.right > 0;
      return onScreen && box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const hasOwnText = element => [...element.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    const candidates = [...document.querySelectorAll('body *')].filter(element =>
      !(element instanceof SVGElement) && !['SCRIPT', 'STYLE', 'OPTION'].includes(element.tagName)
      && (hasOwnText(element) || ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName))
      && visible(element));
    const invisible = candidates
      .map(element => ({ element, ratio: ratio(element) }))
      .filter(({ ratio: r }) => r < 1.5)
      .map(({ element, ratio: r }) => `${element.tagName.toLowerCase()} "${(element.textContent || element.value || '').trim().slice(0, 40)}" ratio ${r.toFixed(2)}`);

    const h1 = document.querySelector('h1');
    return {
      title: h1 ? { text: h1.textContent, ratio: ratio(h1) } : null,
      invisible,
      checked: candidates.length,
    };
  });
}
