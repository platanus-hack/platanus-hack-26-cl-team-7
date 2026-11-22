import { test, expect } from '@playwright/test';
import { login, getJson, uniqueTag, findTransactions, deleteTransactionsMatching, shot } from './helpers.js';

function mockCsv(tag) {
  return Buffer.from([
    'Mock Bank Export - statement',
    'Date,Amount,Description',
    `05/22/2026,-18.75,${tag}MART Store 12`,
    `05/23/2026,-64.10,${tag} Corner Shop`,
    `05/23/2026,-12.00,${tag} Corner Shop`,
    `20260524,1250.00,${tag} Freelance Payment`,
  ].join('\n'));
}

async function uploadAndMap(page, tag) {
  await page.locator('#csv-acc').selectOption({ label: 'Chase Sapphire Checking' });
  await page.locator('input[type=file]').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: mockCsv(tag) });
  await page.getByRole('button', { name: 'Upload & Parse' }).click();
  await expect(page.getByRole('heading', { name: 'Map Columns' })).toBeVisible();
  await expect(page.locator('#map-date')).toHaveValue('Date');
  await expect(page.locator('#map-amount')).toHaveValue('Amount');
  await expect(page.locator('#map-description')).toHaveValue('Description');
  await expect(page.locator('main table tbody tr')).toHaveCount(4);
}

test.describe('rules and CSV import', () => {
  test.beforeEach(async ({ page }) => {
    await login(page.request);
  });

  test('rules page: validation, add and delete a rule', async ({ page }, testInfo) => {
    const keyword = uniqueTag('KW');
    await page.goto('/rules');
    await expect(page.getByRole('heading', { name: 'Categorization Rules' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Rule' }).click();
    await expect(page.getByText('Keyword is required')).toBeVisible();
    await page.getByPlaceholder('e.g. RUNPOD').fill(keyword);
    await page.getByRole('button', { name: 'Add Rule' }).click();
    await expect(page.getByText('Category is required')).toBeVisible();
    await page.locator('main select').selectOption({ label: 'Groceries' });
    await page.getByRole('button', { name: 'Add Rule' }).click();
    const row = page.locator('main .divide-y > div').filter({ hasText: keyword });
    await expect(row).toContainText('Groceries');
    await expect(page.getByPlaceholder('e.g. RUNPOD')).toHaveValue('');
    await shot(page, testInfo, 'rules-01-added');

    await page.reload();
    await expect(row).toContainText('Groceries');
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);
    expect((await getJson(page.request, '/api/rules')).some(r => r.keyword === keyword)).toBe(false);
  });

  test('import a mock CSV: map, auto-categorize from a rule, import, then skip duplicates', async ({ page }, testInfo) => {
    const tag = uniqueTag();
    const groceries = (await getJson(page.request, '/api/categories')).find(c => c.name === 'Groceries');
    const rule = await (await page.request.post('/api/rules', { data: { keyword: `${tag}MART`, category_id: groceries.id } })).json();
    try {
      await page.goto('/import');
      await uploadAndMap(page, tag);
      await shot(page, testInfo, 'import-01-map-columns');
      await page.getByRole('button', { name: 'Confirm mapping' }).click();

      await expect(page.getByRole('heading', { name: 'Assign Categories' })).toBeVisible();
      await expect(page.getByText('1 of 3 groups auto-categorized from your transaction history.', { exact: false })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Manage rules →' })).toHaveAttribute('href', '/rules');
      const group = desc => page.locator('main .max-h-96 > div').filter({ hasText: desc });
      await expect(group(`${tag}MART Store 12`)).toContainText('auto');
      await expect(group(`${tag}MART Store 12`).locator('select')).toHaveValue(String(groceries.id));
      await expect(group(`${tag} Corner Shop`)).toContainText('2 transactions');
      await group(`${tag} Corner Shop`).locator('select').selectOption({ label: 'Shopping' });
      await group(`${tag} Freelance Payment`).locator('select').selectOption({ label: 'Salary' });
      await shot(page, testInfo, 'import-02-assign-categories');
      await page.getByRole('button', { name: 'Import 4 transactions' }).click();

      await expect(page.getByText('Import complete!')).toBeVisible();
      await expect(page.getByText('4 transactions imported · 0 duplicates skipped')).toBeVisible();
      await shot(page, testInfo, 'import-03-done');

      const imported = await findTransactions(page.request, tag);
      expect(imported).toHaveLength(4);
      const summary = imported.map(t => `${t.date} ${t.amount} ${t.category_name} ${t.account_name} ${t.source}`).sort();
      expect(summary).toEqual([
        '2026-05-22 -18.75 Groceries Chase Sapphire Checking imported',
        '2026-05-23 -12 Shopping Chase Sapphire Checking imported',
        '2026-05-23 -64.1 Shopping Chase Sapphire Checking imported',
        '2026-05-24 1250 Salary Chase Sapphire Checking imported',
      ]);

      // Same file again: every row is a duplicate.
      await page.getByRole('button', { name: 'Import another file' }).click();
      await uploadAndMap(page, tag);
      await page.getByRole('button', { name: 'Confirm mapping' }).click();
      await page.getByRole('button', { name: 'Import 4 transactions' }).click();
      await expect(page.getByText('0 transactions imported · 4 duplicates skipped')).toBeVisible();
      expect(await findTransactions(page.request, tag)).toHaveLength(4);
    } finally {
      await deleteTransactionsMatching(page.request, tag);
      await page.request.delete(`/api/rules/${rule.id}`);
    }
  });

  test('import: a malformed CSV shows the parse error', async ({ page }, testInfo) => {
    await page.goto('/import');
    await expect(page.getByRole('button', { name: 'Upload & Parse' })).toBeDisabled();
    await page.locator('input[type=file]').setInputFiles({
      name: 'broken.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Date,Amount,Description\n05/22/2026,"-1.00\n'),
    });
    await page.getByRole('button', { name: 'Upload & Parse' }).click();
    await expect(page.getByText(/^Failed to parse CSV: Quote Not Closed/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Map Columns' })).toHaveCount(0);
    await shot(page, testInfo, 'import-04-parse-error');
  });
});
