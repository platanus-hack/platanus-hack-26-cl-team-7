import { test, expect } from '@playwright/test';
import { login, getJson, categoryId, accountId, uniqueTag, findTransactions, deleteTransactionsMatching } from './helpers.js';

const PROTECTED = [
  ['GET', '/api/auth/me'], ['POST', '/api/auth/logout'], ['PUT', '/api/auth/password'],
  ['GET', '/api/accounts'], ['POST', '/api/accounts'], ['PUT', '/api/accounts/1'],
  ['PUT', '/api/accounts/1/sync'], ['DELETE', '/api/accounts/1'],
  ['GET', '/api/categories'], ['POST', '/api/categories'], ['PUT', '/api/categories/1'], ['DELETE', '/api/categories/1'],
  ['GET', '/api/budget/2026/5'], ['PUT', '/api/budget/2026/5/5'], ['GET', '/api/budget/trends'],
  ['GET', '/api/budget/category/5/history'], ['POST', '/api/budget/rollover'], ['POST', '/api/budget/copy'],
  ['POST', '/api/budget/transfer'],
  ['GET', '/api/transactions'], ['GET', '/api/transactions/latest-date'], ['POST', '/api/transactions'],
  ['PUT', '/api/transactions/1'], ['DELETE', '/api/transactions/1'], ['GET', '/api/transactions/1/splits'],
  ['PUT', '/api/transactions/1/splits'],
  ['POST', '/api/import/parse'], ['POST', '/api/import/suggest'], ['POST', '/api/import/confirm'],
  ['GET', '/api/debts'], ['GET', '/api/debts/projection'], ['POST', '/api/debts'], ['PUT', '/api/debts/1'], ['DELETE', '/api/debts/1'],
  ['GET', '/api/goals'], ['POST', '/api/goals'], ['PUT', '/api/goals/1'], ['PUT', '/api/goals/1/complete'], ['DELETE', '/api/goals/1'],
  ['GET', '/api/rules'], ['POST', '/api/rules'], ['DELETE', '/api/rules/1'],
  ['GET', '/api/calendar/2026/5'],
  ['GET', '/api/investments'], ['GET', '/api/investments/history/AAPL'], ['POST', '/api/investments'],
  ['PUT', '/api/investments/1'], ['DELETE', '/api/investments/1'],
];

test('every API route answers 401 without a session', async ({ request }) => {
  for (const [method, path] of PROTECTED) {
    const res = await request.fetch(path, method === 'GET' ? { method } : { method, data: {} });
    expect(res.status(), `${method} ${path}`).toBe(401);
    expect(await res.json(), `${method} ${path}`).toEqual({ error: 'Unauthorized' });
  }
});

test.describe('API with a session', () => {
  test.beforeEach(async ({ request }) => {
    await login(request);
  });

  test('mock data is loaded', async ({ request }) => {
    const accounts = await getJson(request, '/api/accounts');
    expect(accounts.map(a => a.name)).toEqual(expect.arrayContaining([
      'Chase Sapphire Checking', 'Marcus High-Yield Savings', 'Fidelity Brokerage', 'Amex Platinum', 'Tesla Financing',
    ]));
    const categories = await getJson(request, '/api/categories');
    expect(categories.length).toBeGreaterThanOrEqual(26);
    expect((await getJson(request, '/api/transactions/latest-date')).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const txs = await getJson(request, '/api/transactions?start=2025-12-01&end=2026-05-31&limit=200');
    expect(txs.transactions.length).toBe(200);
    expect(txs.hasMore).toBe(true);
  });

  test('accounts: create, update, sync, delete and validation', async ({ request }) => {
    const name = uniqueTag('Acct ');
    const created = await request.post('/api/accounts', { data: { name, type: 'checking', balance: 100 } });
    expect(created.status()).toBe(201);
    const account = await created.json();
    expect(account).toMatchObject({ name, type: 'checking', balance: 100, current_balance: 100 });

    const updated = await request.put(`/api/accounts/${account.id}`, { data: { name: `${name} B`, type: 'savings', balance: 250 } });
    expect(updated.status()).toBe(200);
    expect(await updated.json()).toMatchObject({ name: `${name} B`, type: 'savings', balance: 250 });

    const synced = await request.put(`/api/accounts/${account.id}/sync`, { data: { current_balance: 999.5 } });
    expect(synced.status()).toBe(200);
    expect((await synced.json()).current_balance).toBe(999.5);

    expect((await request.put(`/api/accounts/${account.id}/sync`, { data: { current_balance: 'abc' } })).status()).toBe(400);
    expect((await request.put('/api/accounts/999999/sync', { data: { current_balance: 1 } })).status()).toBe(404);
    expect((await request.post('/api/accounts', { data: { name: 'No type' } })).status()).toBe(400);
    expect((await request.post('/api/accounts', { data: { type: 'checking' } })).status()).toBe(400);
    expect((await request.put('/api/accounts/999999', { data: { name: 'x', type: 'checking', balance: 0 } })).status()).toBe(404);

    expect((await request.delete(`/api/accounts/${account.id}`)).status()).toBe(200);
    expect((await request.delete(`/api/accounts/${account.id}`)).status()).toBe(404);
  });

  test('categories: create, update, delete and validation', async ({ request }) => {
    const name = uniqueTag('Cat ');
    const created = await request.post('/api/categories', { data: { name, type: 'expense', default_allocation: 150, rollover: true } });
    expect(created.status()).toBe(201);
    const cat = await created.json();
    expect(cat).toMatchObject({ name, type: 'expense', default_allocation: 150, rollover: 1 });

    const updated = await request.put(`/api/categories/${cat.id}`, { data: { name: `${name} B`, type: 'expense', default_allocation: 175, rollover: false } });
    expect(await updated.json()).toMatchObject({ name: `${name} B`, default_allocation: 175, rollover: 0 });

    expect((await request.post('/api/categories', { data: { name: 'No type' } })).status()).toBe(400);
    expect((await request.put('/api/categories/999999', { data: { name: 'x', type: 'expense', default_allocation: 0 } })).status()).toBe(404);
    expect((await request.delete(`/api/categories/${cat.id}`)).status()).toBe(200);
    expect((await request.delete(`/api/categories/${cat.id}`)).status()).toBe(404);
  });

  test('budget envelopes: month view, allocation, transfer, copy, rollover', async ({ request }) => {
    const may = await getJson(request, '/api/budget/2026/5');
    const groceries = may.find(e => e.name === 'Groceries');
    const gas = may.find(e => e.name === 'Gas');
    expect(groceries.spent).toBeLessThan(0);
    expect(may.find(e => e.name === 'Salary').spent).toBeGreaterThan(0);

    // Allocation update, then put it back.
    const original = groceries.allocated;
    const put = await request.put(`/api/budget/2026/5/${groceries.category_id}`, { data: { allocated: original + 11 } });
    expect((await put.json()).allocated).toBe(original + 11);
    await request.put(`/api/budget/2026/5/${groceries.category_id}`, { data: { allocated: original } });
    expect((await request.put(`/api/budget/2026/5/${groceries.category_id}`, { data: {} })).status()).toBe(400);
    expect((await request.put('/api/budget/2026/5/999999', { data: { allocated: 1 } })).status()).toBe(404);

    // Transfer there and back.
    const transfer = body => request.post('/api/budget/transfer', { data: { year: 2026, month: 5, ...body } });
    const moved = await transfer({ fromCategoryId: groceries.category_id, toCategoryId: gas.category_id, amount: 50 });
    expect(moved.status()).toBe(200);
    expect(await moved.json()).toEqual({
      from: { category_id: groceries.category_id, allocated: original - 50 },
      to: { category_id: gas.category_id, allocated: gas.allocated + 50 },
    });
    expect((await transfer({ fromCategoryId: gas.category_id, toCategoryId: groceries.category_id, amount: 50 })).status()).toBe(200);
    const tooMuch = await transfer({ fromCategoryId: groceries.category_id, toCategoryId: gas.category_id, amount: 1e9 });
    expect(await tooMuch.json()).toEqual({ error: 'Insufficient allocated budget in source envelope' });
    expect((await transfer({ fromCategoryId: gas.category_id, toCategoryId: gas.category_id, amount: 5 })).status()).toBe(400);
    expect((await transfer({ fromCategoryId: gas.category_id, toCategoryId: groceries.category_id, amount: -5 })).status()).toBe(400);
    expect((await transfer({})).status()).toBe(400);

    // Copy and rollover on months far from the mock data.
    const savingsId = await categoryId(request, 'Savings');
    await getJson(request, '/api/budget/2030/1');
    await getJson(request, '/api/budget/2030/2');
    await request.put(`/api/budget/2030/1/${gas.category_id}`, { data: { allocated: 777 } });
    const copy = await request.post('/api/budget/copy', { data: { fromYear: 2030, fromMonth: 1, toYear: 2030, toMonth: 2 } });
    expect((await copy.json()).updated).toBeGreaterThan(0);
    expect((await getJson(request, '/api/budget/2030/2')).find(e => e.category_id === gas.category_id).allocated).toBe(777);
    expect((await request.post('/api/budget/copy', { data: { fromYear: 2030 } })).status()).toBe(400);

    const rollover = await request.post('/api/budget/rollover', { data: { fromYear: 2030, fromMonth: 2, toYear: 2030, toMonth: 3 } });
    expect(await rollover.json()).toEqual({ ok: true });
    const march = await getJson(request, '/api/budget/2030/3');
    expect(march.find(e => e.category_id === savingsId).rolled_over).toBeGreaterThan(0);
  });

  test('trends and envelope history', async ({ request }) => {
    expect(await getJson(request, '/api/budget/trends')).toEqual({ labels: [], series: [] });
    const groceriesId = await categoryId(request, 'Groceries');
    const trends = await getJson(request, `/api/budget/trends?months=24&category_ids=${groceriesId}`);
    expect(trends.labels).toHaveLength(24);
    expect(trends.series[0].name).toBe('Groceries');
    expect(trends.series[0].data.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    const history = await getJson(request, `/api/budget/category/${groceriesId}/history?months=3&year=2026&month=5`);
    expect(history.history).toHaveLength(3);
    expect(history.allTime.count).toBeGreaterThan(0);
    expect(history.largest.amount).toBeLessThan(0);
    expect(history.recentTxs.length).toBeGreaterThan(0);
  });

  test('transactions: create, edit, list, filter, splits, delete and validation', async ({ request }) => {
    const tag = uniqueTag();
    const groceriesId = await categoryId(request, 'Groceries');
    const restaurantsId = await categoryId(request, 'Restaurants');
    const chaseId = await accountId(request, 'Chase Sapphire Checking');
    try {
      const created = await request.post('/api/transactions', {
        data: { date: '2026-05-20', amount: -42.5, description: `${tag} Coffee`, category_id: groceriesId, account_id: chaseId },
      });
      expect(created.status()).toBe(201);
      const tx = await created.json();
      expect(tx).toMatchObject({ amount: -42.5, source: 'manual', is_recurring: 0 });

      const edited = await request.put(`/api/transactions/${tx.id}`, {
        data: { date: '2026-05-21', amount: -45, description: `${tag} Coffee edited`, category_id: restaurantsId, account_id: chaseId, is_recurring: true },
      });
      expect(await edited.json()).toMatchObject({ date: '2026-05-21', amount: -45, is_recurring: 1, category_id: restaurantsId });

      const listed = await findTransactions(request, tag);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ category_name: 'Restaurants', account_name: 'Chase Sapphire Checking', has_splits: 0 });

      // Filters
      const income = await getJson(request, '/api/transactions?type=income&limit=20');
      expect(income.transactions.every(t => t.amount > 0)).toBe(true);
      const expense = await getJson(request, '/api/transactions?type=expense&limit=20');
      expect(expense.transactions.every(t => t.amount < 0)).toBe(true);
      const amexId = await accountId(request, 'Amex Platinum');
      const combo = await getJson(request, `/api/transactions?start=2026-03-01&end=2026-03-31&category_id=${groceriesId}&account_id=${amexId}&limit=200`);
      expect(combo.transactions.length).toBeGreaterThan(0);
      expect(combo.transactions.every(t => t.date.startsWith('2026-03') && t.category_id === groceriesId && t.account_id === amexId)).toBe(true);
      const uncategorized = await getJson(request, '/api/transactions?category_id=none&limit=200');
      expect(uncategorized.transactions.every(t => t.category_id === null)).toBe(true);
      const page1 = await getJson(request, '/api/transactions?limit=1&offset=0');
      const page2 = await getJson(request, '/api/transactions?limit=1&offset=1');
      expect(page1.hasMore).toBe(true);
      expect(page1.transactions[0].id).not.toBe(page2.transactions[0].id);
      expect((await request.get('/api/transactions?start=03/01/2026')).status()).toBe(400);
      expect((await request.get('/api/transactions?end=bad')).status()).toBe(400);

      // Splits
      const splits = await request.put(`/api/transactions/${tx.id}/splits`, {
        data: { splits: [{ category_id: groceriesId, amount: 30 }, { category_id: restaurantsId, amount: 15 }] },
      });
      expect(splits.status()).toBe(200);
      expect((await splits.json()).map(s => s.category_name)).toEqual(['Groceries', 'Restaurants']);
      expect((await findTransactions(request, tag))[0].has_splits).toBe(1);
      const unbalanced = await request.put(`/api/transactions/${tx.id}/splits`, { data: { splits: [{ category_id: groceriesId, amount: 10 }] } });
      expect(unbalanced.status()).toBe(400);
      expect((await unbalanced.json()).error).toMatch(/must equal transaction total/);
      expect((await request.put(`/api/transactions/${tx.id}/splits`, { data: { splits: [{ amount: -45 }] } })).status()).toBe(400);
      expect((await request.put(`/api/transactions/${tx.id}/splits`, { data: { splits: 'no' } })).status()).toBe(400);
      expect((await request.put('/api/transactions/999999/splits', { data: { splits: [] } })).status()).toBe(404);
      expect((await request.get('/api/transactions/abc/splits')).status()).toBe(400);
      expect(await (await request.put(`/api/transactions/${tx.id}/splits`, { data: { splits: [] } })).json()).toEqual([]);

      // Validation
      for (const data of [{ amount: -1, description: 'x' }, { date: '2026-05-20', description: 'x' }, { date: '2026-05-20', amount: -1 }]) {
        const res = await request.post('/api/transactions', { data });
        expect(res.status()).toBe(400);
        expect(await res.json()).toEqual({ error: 'date, amount, and description required' });
      }
      expect((await request.put('/api/transactions/999999', { data: { date: '2026-05-20', amount: -1, description: 'x' } })).status()).toBe(404);

      expect((await request.delete(`/api/transactions/${tx.id}`)).status()).toBe(200);
      expect((await request.delete(`/api/transactions/${tx.id}`)).status()).toBe(404);
      expect(await findTransactions(request, tag)).toHaveLength(0);
    } finally {
      await deleteTransactionsMatching(request, tag);
    }
  });

  test('rules and CSV import API: parse, suggest, confirm, duplicates', async ({ request }) => {
    const tag = uniqueTag();
    const groceriesId = await categoryId(request, 'Groceries');
    const salaryId = await categoryId(request, 'Salary');
    const chaseId = await accountId(request, 'Chase Sapphire Checking');
    let ruleId;
    try {
      const rule = await request.post('/api/rules', { data: { keyword: `  ${tag}MART  `, category_id: groceriesId } });
      expect(rule.status()).toBe(201);
      const ruleBody = await rule.json();
      ruleId = ruleBody.id;
      expect(ruleBody).toMatchObject({ keyword: `${tag}MART`, category_name: 'Groceries' });
      expect((await getJson(request, '/api/rules')).some(r => r.id === ruleId)).toBe(true);
      expect((await request.post('/api/rules', { data: { keyword: '   ', category_id: groceriesId } })).status()).toBe(400);
      expect((await request.post('/api/rules', { data: { keyword: 'X' } })).status()).toBe(400);
      expect(await (await request.post('/api/rules', { data: { keyword: 'X', category_id: 999999 } })).json()).toEqual({ error: 'category not found' });

      const csv = [
        'Mock Bank Export - statement',
        'Date,Amount,Description',
        `05/22/2026,-18.75,${tag}MART Store 12`,
        `05/23/2026,-64.10,${tag} Corner Shop`,
        `20260524,1250.00,${tag} Freelance Payment`,
      ].join('\n');
      const parsed = await request.post('/api/import/parse', {
        multipart: { file: { name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } },
      });
      expect(parsed.status()).toBe(200);
      const { headers, rows, preview } = await parsed.json();
      expect(headers).toEqual(['Date', 'Amount', 'Description']);
      expect(rows).toHaveLength(3);
      expect(preview).toHaveLength(3);

      const suggest = await request.post('/api/import/suggest', { data: { descriptions: rows.map(r => r.Description) } });
      expect((await suggest.json()).suggestions).toEqual({ [`${tag}MART Store 12`]: groceriesId });
      expect((await request.post('/api/import/suggest', { data: { descriptions: 'x' } })).status()).toBe(400);

      const mapping = { date: 'Date', amount: 'Amount', description: 'Description' };
      const confirm = await request.post('/api/import/confirm', {
        data: { rows, mapping, account_id: chaseId, assignments: [{ index: 2, category_id: salaryId }] },
      });
      expect(await confirm.json()).toEqual({ inserted: 3, duplicates: 0 });
      const again = await request.post('/api/import/confirm', { data: { rows, mapping, account_id: chaseId } });
      expect(await again.json()).toEqual({ inserted: 0, duplicates: 3 });
      expect((await request.post('/api/import/confirm', { data: { rows: [] } })).status()).toBe(400);

      const imported = await findTransactions(request, tag);
      const byDesc = Object.fromEntries(imported.map(t => [t.description, t]));
      expect(byDesc[`${tag}MART Store 12`]).toMatchObject({ date: '2026-05-22', amount: -18.75, category_name: 'Groceries', source: 'imported' });
      expect(byDesc[`${tag} Corner Shop`]).toMatchObject({ date: '2026-05-23', category_id: null });
      expect(byDesc[`${tag} Freelance Payment`]).toMatchObject({ date: '2026-05-24', amount: 1250, category_name: 'Salary' });

      // Failure cases
      expect(await (await request.post('/api/import/parse')).json()).toEqual({ error: 'No file uploaded' });
      const broken = await request.post('/api/import/parse', {
        multipart: { file: { name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Amount,Description\n05/22/2026,"-1.00\n') } },
      });
      expect(broken.status()).toBe(400);
      expect((await broken.json()).error).toMatch(/^Failed to parse CSV/);
    } finally {
      await deleteTransactionsMatching(request, tag);
      if (ruleId) await request.delete(`/api/rules/${ruleId}`);
    }
    expect((await request.delete(`/api/rules/${ruleId}`)).status()).toBe(404);
  });

  test('debts and payoff projection', async ({ request }) => {
    const name = uniqueTag('Debt ');
    const before = await getJson(request, '/api/debts/projection?extraPayment=0&method=avalanche');
    expect(before.months.length).toBeGreaterThan(0);
    expect(before.payoffDate).toMatch(/^\d{4}-\d{2}$/);
    const faster = await getJson(request, '/api/debts/projection?extraPayment=500&method=avalanche');
    expect(faster.months.length).toBeLessThan(before.months.length);
    expect(faster.totalInterest).toBeLessThan(before.totalInterest);
    const snowball = await getJson(request, '/api/debts/projection?extraPayment=500&method=snowball');
    expect(snowball.months.length).toBeGreaterThan(0);

    const created = await request.post('/api/debts', { data: { name, balance: 1200, apr: 24.99, credit_limit: 3000, minimum_payment: 40, due_day: 12 } });
    expect(created.status()).toBe(201);
    const debt = await created.json();
    const updated = await request.put(`/api/debts/${debt.id}`, { data: { name, balance: 900, apr: 24.99, credit_limit: 3000, minimum_payment: 40, due_day: 12 } });
    expect((await updated.json()).balance).toBe(900);
    expect((await getJson(request, '/api/debts')).some(d => d.name === name)).toBe(true);
    expect((await request.post('/api/debts', { data: { balance: 5 } })).status()).toBe(400);
    expect((await request.put('/api/debts/999999', { data: { name: 'x', balance: 1, apr: 1, credit_limit: 0, minimum_payment: 1 } })).status()).toBe(404);
    expect((await request.delete(`/api/debts/${debt.id}`)).status()).toBe(200);
    expect((await request.delete(`/api/debts/${debt.id}`)).status()).toBe(404);
  });

  test('savings goals: create, edit, complete, reopen, delete and validation', async ({ request }) => {
    const name = uniqueTag('Goal ');
    const savingsAcct = await accountId(request, 'Marcus High-Yield Savings');
    const created = await request.post('/api/goals', { data: { name, target_amount: 2500, account_id: savingsAcct, target_date: '2027-03-01' } });
    expect(created.status()).toBe(201);
    const goal = await created.json();
    const listed = (await getJson(request, '/api/goals')).find(g => g.id === goal.id);
    expect(listed).toMatchObject({ account_name: 'Marcus High-Yield Savings', target_amount: 2500 });
    expect(typeof listed.account_balance).toBe('number');

    const edited = await request.put(`/api/goals/${goal.id}`, { data: { name: `${name} B`, target_amount: 3200, account_id: savingsAcct, target_date: '2027-04-01' } });
    expect(await edited.json()).toMatchObject({ name: `${name} B`, target_amount: 3200 });
    const done = await request.put(`/api/goals/${goal.id}/complete`, { data: {} });
    expect((await done.json()).completed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const reopened = await request.put(`/api/goals/${goal.id}/complete`, { data: {} });
    expect((await reopened.json()).completed_at).toBeNull();

    expect(await (await request.post('/api/goals', { data: { name: '', target_amount: 10 } })).json()).toEqual({ error: 'name required' });
    for (const target_amount of [-5, 'abc']) {
      expect(await (await request.post('/api/goals', { data: { name: 'x', target_amount } })).json()).toEqual({ error: 'target_amount must be a positive number' });
    }
    expect((await request.put('/api/goals/999999', { data: { name: 'x', target_amount: 1 } })).status()).toBe(404);
    expect((await request.put('/api/goals/999999/complete', { data: {} })).status()).toBe(404);
    expect((await request.delete(`/api/goals/${goal.id}`)).status()).toBe(200);
    expect((await request.delete(`/api/goals/${goal.id}`)).status()).toBe(404);
  });

  test('investments: list with prices, history, create, edit, delete and validation', async ({ request }) => {
    test.setTimeout(90_000);
    const holdings = await getJson(request, '/api/investments');
    expect(holdings.map(h => h.ticker)).toEqual(expect.arrayContaining(['AAPL', 'MSFT', 'VTI']));
    // Prices come from Yahoo Finance; offline they are null and the list still works.
    for (const h of holdings) expect(h.price).toHaveProperty('current');
    const history = await request.get('/api/investments/history/AAPL?range=1mo');
    expect([200, 404, 500]).toContain(history.status());

    const notes = uniqueTag('lot ');
    const created = await request.post('/api/investments', { data: { ticker: ' qqq ', shares: '10', purchase_price: '380.5', purchase_date: '2024-01-02', notes } });
    expect(created.status()).toBe(201);
    const holding = await created.json();
    expect(holding).toMatchObject({ ticker: 'QQQ', shares: 10, purchase_price: 380.5 });
    const edited = await request.put(`/api/investments/${holding.id}`, { data: { ticker: 'QQQ', shares: 12, purchase_price: 381, purchase_date: '2024-01-03', notes } });
    expect(await edited.json()).toMatchObject({ shares: 12, purchase_price: 381 });
    expect(await (await request.post('/api/investments', { data: { ticker: 'QQQ' } })).json()).toEqual({ error: 'ticker, shares, purchase_price, purchase_date required' });
    expect((await request.put('/api/investments/999999', { data: { ticker: 'QQQ', shares: 1, purchase_price: 1, purchase_date: '2024-01-01' } })).status()).toBe(404);
    expect((await request.delete(`/api/investments/${holding.id}`)).status()).toBe(200);
    expect((await request.delete(`/api/investments/${holding.id}`)).status()).toBe(404);
  });

  test('calendar: actual transactions and projected recurring ones', async ({ request }) => {
    const may = await getJson(request, '/api/calendar/2026/5');
    expect(may.actual.length).toBeGreaterThan(0);
    expect(may.actual.every(t => t.date.startsWith('2026-05'))).toBe(true);
    const next = new Date();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const future = await getJson(request, `/api/calendar/${next.getFullYear()}/${next.getMonth() + 1}`);
    expect(future.projected.length).toBeGreaterThan(0);
    expect(future.projected.every(t => t.projected === true && String(t.id).startsWith('proj-'))).toBe(true);
  });

  test('password change: validation, change, log in with new password, change back', async ({ request, playwright, baseURL }) => {
    const put = data => request.put('/api/auth/password', { data });
    expect(await (await put({ currentPassword: 'changeme' })).json()).toEqual({ error: 'Both passwords required' });
    expect(await (await put({ currentPassword: 'changeme', newPassword: 'short' })).json()).toEqual({ error: 'Password must be at least 8 characters' });
    const wrong = await put({ currentPassword: 'WRONG-pass', newPassword: 'newpassword123' });
    expect(wrong.status()).toBe(401);

    const fresh = await playwright.request.newContext({ baseURL });
    try {
      expect((await put({ currentPassword: 'changeme', newPassword: 'newpassword123' })).status()).toBe(200);
      expect((await fresh.post('/api/auth/login', { data: { username: 'admin', password: 'changeme' } })).status()).toBe(401);
      expect((await fresh.post('/api/auth/login', { data: { username: 'admin', password: 'newpassword123' } })).status()).toBe(200);
    } finally {
      await put({ currentPassword: 'newpassword123', newPassword: 'changeme' });
      await fresh.dispose();
    }
    expect((await request.post('/api/auth/login', { data: { username: 'admin', password: 'changeme' } })).status()).toBe(200);
  });
});

// What a client must never see in an error answer: stack frames, file paths, SQL error text.
const LEAK = /node_modules|\.js:\d+:\d+|\n\s+at |\/Users\/|\/home\/|SqliteError|SyntaxError|CHECK constraint|<pre>/;

test.describe('error answers', () => {
  const invalid = [
    ['POST', '/api/accounts', { name: 'Bad', type: 'brokerage' }],
    ['POST', '/api/categories', { name: 'Groceries', type: 'transfer' }],
    ['POST', '/api/debts', { name: 'Card', due_day: 40 }],
    ['POST', '/api/transactions', { date: '2026-05-20', amount: -1, description: 'x', category_id: 99999 }],
    ['POST', '/api/transactions', { date: '2026-05-20', amount: -1, description: 'x', account_id: 99999 }],
    ['PUT', '/api/investments/1', { shares: 1, purchase_price: 1, purchase_date: '2024-01-01' }],
    ['POST', '/api/investments', { ticker: 5, shares: 1, purchase_price: 1, purchase_date: '2024-01-01' }],
    ['POST', '/api/budget/transfer', { fromCategoryId: 1, toCategoryId: {}, amount: 5, year: 2026, month: 5 }],
  ];

  test('invalid input gets a short JSON 400 without a stack trace or file path', async ({ request }) => {
    await login(request);
    for (const [method, path, data] of invalid) {
      const res = await request.fetch(path, { method, data });
      const body = await res.text();
      const label = `${method} ${path} ${JSON.stringify(data)}`;
      expect(res.status(), label).toBe(400);
      expect(res.headers()['content-type'], label).toMatch(/json/);
      expect(body, label).not.toMatch(LEAK);
      expect(typeof JSON.parse(body).error, label).toBe('string');
    }
  });

  test('bad paging values are rejected before the query', async ({ request }) => {
    await login(request);
    for (const query of ['limit=abc', 'limit=0', 'limit=-1', 'limit=1.5', 'offset=abc']) {
      const res = await request.get(`/api/transactions?${query}`);
      expect(res.status(), query).toBe(400);
      expect(res.headers()['content-type'], query).toMatch(/json/);
      expect(await res.text(), query).not.toMatch(LEAK);
    }
    expect((await request.get('/api/transactions?limit=1000&offset=-3')).status()).toBe(200);
  });

  test('malformed JSON gets a JSON 400, with or without a session', async ({ request, playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    for (const path of ['/api/auth/login', '/api/auth/signup', '/api/accounts']) {
      const res = await anon.post(path, { headers: { 'Content-Type': 'application/json' }, data: '{"username":' });
      expect(res.status(), path).toBe(400);
      expect(res.headers()['content-type'], path).toMatch(/json/);
      expect(await res.json(), path).toEqual({ error: 'Invalid request' });
    }
    await anon.dispose();
    await login(request);
    const res = await request.post('/api/accounts', { headers: { 'Content-Type': 'application/json' }, data: '{"name": "x", ' });
    expect(res.status()).toBe(400);
    expect(await res.text()).not.toMatch(LEAK);
  });

  test('an oversized body gets a JSON 413', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { username: 'x'.repeat(300_000), password: 'y' } });
    expect(res.status()).toBe(413);
    expect(res.headers()['content-type']).toMatch(/json/);
    expect(await res.text()).not.toMatch(LEAK);
  });

  test('a rejected request changes nothing', async ({ request }) => {
    await login(request);
    const before = (await getJson(request, '/api/accounts')).length;
    await request.post('/api/accounts', { data: { name: 'Bad', type: 'brokerage' } });
    expect((await getJson(request, '/api/accounts')).length).toBe(before);
  });

  test('the app still serves normally afterwards', async ({ request }) => {
    expect((await request.get('/status')).status()).toBe(200);
  });
});

test('status endpoint: JSON and HTML', async ({ request }) => {
  const json = await request.get('/status', { headers: { Accept: 'application/json' } });
  expect(json.status()).toBe(200);
  expect(await json.json()).toMatchObject({ status: 'ok', checks: { server: { status: 'ok' }, database: { status: 'ok' } } });
  const html = await request.get('/status', { headers: { Accept: 'text/html' } });
  expect(html.headers()['content-type']).toMatch(/text\/html/);
  expect(await html.text()).toContain('OPERATIONAL');
});
