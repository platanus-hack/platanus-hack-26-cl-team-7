// Each test here states the correct behaviour and is marked test.fail() because
// the app does not do it yet. The run stays green while the bug is present; when
// a bug is fixed its test "unexpectedly passes" and the marker must be removed.
import { test, expect } from '@playwright/test';
import { login, getJson, uniqueTag, goToMonth, deleteTransactionsMatching, shot } from './helpers.js';

test.describe('known bugs', () => {
  test.beforeEach(async ({ page }) => {
    await login(page.request);
  });

  test('dashboard: clicking an envelope card opens its detail panel', async ({ page }, testInfo) => {
    test.fail(true, 'EnvelopeCard ignores the onClick prop, so EnvelopeDetail never opens');
    await page.goto('/dashboard');
    await goToMonth(page, 2026, 5);
    await page.locator('main section').first().getByText('Groceries', { exact: true }).click();
    await shot(page, testInfo, 'bug-01-envelope-click-no-detail');
    await expect(page.locator('.fixed.inset-0')).toBeVisible({ timeout: 3_000 });
  });

  test('transactions: a new row shows its category and account right after saving', async ({ page }, testInfo) => {
    test.fail(true, 'POST /api/transactions returns the row without category_name/account_name');
    const tag = uniqueTag();
    try {
      await page.goto('/transactions');
      await page.getByRole('button', { name: '+ Add' }).click();
      await page.locator('#tx-date').fill('2026-05-27');
      await page.locator('#tx-amount').fill('-12.34');
      await page.locator('#tx-desc').fill(`${tag} Lunch`);
      await page.locator('#tx-cat').selectOption({ label: 'Restaurants' });
      await page.locator('#tx-acc').selectOption({ label: 'Chase Sapphire Checking' });
      await page.getByRole('button', { name: 'Save' }).click();
      const row = page.locator('main .divide-y > div').filter({ hasText: `${tag} Lunch` });
      await expect(row).toContainText('-$12.34');
      await shot(page, testInfo, 'bug-02-new-row-uncategorized');
      await expect(row).toContainText('Restaurants · Chase Sapphire Checking', { timeout: 3_000 });
    } finally {
      await deleteTransactionsMatching(page.request, tag);
    }
  });

  test('envelopes: choosing the current "To" envelope as "From" still allows the transfer shown on screen', async ({ page }, testInfo) => {
    test.fail(true, 'toCategoryId keeps the old value while the To list hides it');
    await page.goto('/envelopes');
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    const modal = page.locator('.fixed.inset-0').filter({ hasText: 'Transfer Budget' });
    const [from, to] = [modal.locator('select').nth(0), modal.locator('select').nth(1)];
    const originalTo = await to.inputValue();
    await from.selectOption(originalTo);
    await modal.locator('input[type=number]').fill('1');
    await modal.getByRole('button', { name: 'Transfer' }).click();
    await shot(page, testInfo, 'bug-03-transfer-from-to');
    // The To list now shows a different envelope, so the form must not claim they are equal.
    expect(await to.inputValue()).not.toBe(originalTo);
    await expect(modal.getByText('From and To must be different.')).toHaveCount(0, { timeout: 2_000 });
  });

  test('API: a non-numeric transaction amount is rejected', async ({ page }) => {
    test.fail(true, 'POST /api/transactions stores amount "abc" as text');
    const tag = uniqueTag();
    const res = await page.request.post('/api/transactions', { data: { date: '2026-05-20', amount: 'abc', description: `${tag} text amount` } });
    const status = res.status();
    await deleteTransactionsMatching(page.request, tag);
    expect(status).toBe(400);
  });

  test('API: logging out ends the session token on the server', async ({ playwright, baseURL }) => {
    test.fail(true, 'logout only clears the cookie; the JWT stays valid for 7 days');
    const ctx = await playwright.request.newContext({ baseURL });
    await login(ctx);
    const token = (await ctx.storageState()).cookies.find(c => c.name === 'budget_token').value;
    expect((await ctx.post('/api/auth/logout', { data: {} })).status()).toBe(200);
    await ctx.dispose();
    const anon = await playwright.request.newContext({ baseURL });
    const replay = await anon.get('/api/auth/me', { headers: { Cookie: `budget_token=${token}` } });
    await anon.dispose();
    expect(replay.status()).toBe(401);
  });

  test('API: an unknown /api path answers 404, not the app HTML', async ({ page }) => {
    test.fail(true, 'the client catch-all route serves index.html for every GET');
    const res = await page.request.get('/api/does-not-exist');
    expect(res.status()).toBe(404);
  });

  test('API: login accepts the username in another letter case, as sign-up does', async ({ playwright, baseURL }) => {
    test.fail(true, 'sign-up treats names case-insensitively (Admin is taken), but login matches the exact case');
    const anon = await playwright.request.newContext({ baseURL });
    const res = await anon.post('/api/auth/login', { data: { username: 'ADMIN', password: 'changeme' } });
    await anon.dispose();
    expect(res.status()).toBe(200);
  });

  test('API: splits with an unknown category or a null entry get a 400, not a 500', async ({ page }) => {
    test.fail(true, 'PUT /api/transactions/:id/splits answers 500 for these inputs');
    const tag = uniqueTag();
    const created = await page.request.post('/api/transactions', { data: { date: '2026-05-20', amount: -20, description: `${tag} split check` } });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    try {
      const statuses = [];
      for (const splits of [[{ category_id: 99999, amount: 20 }], [null]]) {
        const res = await page.request.put(`/api/transactions/${id}/splits`, { data: { splits } });
        expect(res.headers()['content-type']).toMatch(/json/);
        statuses.push(res.status());
      }
      expect(statuses).toEqual([400, 400]);
    } finally {
      await deleteTransactionsMatching(page.request, tag);
    }
  });
});

test('calendar and dashboard open on the current month, which has no mock activity', async ({ page }) => {
  // Not a failure: documents that the mock data ends in May 2026, so the default
  // month views are empty on later dates.
  await login(page.request);
  const latest = (await getJson(page.request, '/api/transactions/latest-date')).date;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  test.skip(latest >= currentMonth, 'mock data reaches the current month');
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: /^Spent/ })).toContainText('$0.00');
});
