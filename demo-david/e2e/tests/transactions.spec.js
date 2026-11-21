import { test, expect } from '@playwright/test';
import { login, getJson, accountId, categoryId, uniqueTag, findTransactions, deleteTransactionsMatching, acceptNextDialog, shot } from './helpers.js';

const rows = page => page.locator('main .divide-y > div');

test.describe('transactions page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page.request);
  });

  test('add, edit, split and delete a transaction', async ({ page }, testInfo) => {
    const tag = uniqueTag();
    try {
      await page.goto('/transactions');
      await page.getByRole('button', { name: '+ Add' }).click();
      await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
      await page.locator('#tx-date').fill('2026-05-27');
      await page.locator('#tx-amount').fill('-33.25');
      await page.locator('#tx-desc').fill(`${tag} Bakery`);
      await page.locator('#tx-cat').selectOption({ label: 'Groceries' });
      await page.locator('#tx-acc').selectOption({ label: 'Chase Sapphire Checking' });
      await shot(page, testInfo, 'transactions-01-new-form');
      await page.getByRole('button', { name: 'Save' }).click();
      const row = rows(page).filter({ hasText: `${tag} Bakery` });
      await expect(row).toContainText('-$33.25');
      const [saved] = await findTransactions(page.request, tag);
      expect(saved).toMatchObject({ date: '2026-05-27', amount: -33.25, category_name: 'Groceries', account_name: 'Chase Sapphire Checking', source: 'manual' });

      // After a reload the row shows its category and account.
      await page.reload();
      await page.getByPlaceholder('Search transactions…').fill(tag);
      await expect(rows(page)).toHaveCount(1);
      await expect(row).toContainText('2026-05-27 · Groceries · Chase Sapphire Checking');
      await shot(page, testInfo, 'transactions-02-created');

      // Edit
      await row.getByRole('button', { name: 'Edit' }).click();
      await expect(page.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible();
      await expect(page.locator('#tx-desc')).toHaveValue(`${tag} Bakery`);
      await page.locator('#tx-desc').fill(`${tag} Bakery edited`);
      await page.locator('#tx-amount').fill('-40');
      await page.locator('#tx-cat').selectOption({ label: 'Restaurants' });
      await page.getByLabel('Recurring transaction').check();
      await page.getByRole('button', { name: 'Save' }).click();
      const edited = rows(page).filter({ hasText: `${tag} Bakery edited` });
      await expect(edited).toContainText('-$40.00');
      await expect(edited).toContainText('Recurring');
      expect((await findTransactions(page.request, tag))[0]).toMatchObject({ amount: -40, category_name: 'Restaurants', is_recurring: 1 });

      // Split: an unbalanced split is refused, a balanced one is saved.
      await edited.getByRole('button', { name: 'Edit' }).click();
      await page.getByRole('button', { name: '+ Split' }).click();
      const form = page.locator('main form');
      const splitSelects = form.locator('select:not(#tx-acc)');
      const splitAmounts = form.locator('input[type=number][min="0.01"]');
      await expect(splitSelects).toHaveCount(2);
      await splitSelects.nth(0).selectOption({ label: 'Groceries' });
      await splitSelects.nth(1).selectOption({ label: 'Restaurants' });
      await splitAmounts.nth(0).fill('30');
      await splitAmounts.nth(1).fill('5');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Split amounts ($35.00) must equal transaction total ($40.00)')).toBeVisible();
      await shot(page, testInfo, 'transactions-03-split-unbalanced');
      await splitAmounts.nth(1).fill('10');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(edited).toContainText('Split');
      const [withSplits] = await findTransactions(page.request, tag);
      expect(withSplits.has_splits).toBe(1);
      const splits = await getJson(page.request, `/api/transactions/${withSplits.id}/splits`);
      expect(splits.map(s => [s.category_name, s.amount])).toEqual([['Groceries', 30], ['Restaurants', 10]]);
      await shot(page, testInfo, 'transactions-04-split-saved');

      // Delete (confirm dialog)
      const dialogs = acceptNextDialog(page);
      await edited.getByRole('button', { name: 'Delete' }).click();
      await expect(edited).toHaveCount(0);
      expect(dialogs).toEqual(['confirm: Delete this transaction?']);
      expect(await findTransactions(page.request, tag)).toHaveLength(0);
    } finally {
      await deleteTransactionsMatching(page.request, tag);
    }
  });

  test('cancel keeps nothing and required fields block saving', async ({ page }) => {
    await page.goto('/transactions');
    await page.getByRole('button', { name: '+ Add' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    // The browser blocks the submit because amount and description are required.
    await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
    expect(await page.locator('#tx-amount').evaluate(el => el.validity.valueMissing)).toBe(true);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'New Transaction' })).toHaveCount(0);
  });

  test('filters: date range, sign, envelope, account and search', async ({ page }, testInfo) => {
    const groceriesId = await categoryId(page.request, 'Groceries');
    const amexId = await accountId(page.request, 'Amex Platinum');
    await page.goto('/transactions');
    const selects = page.locator('main select');
    await selects.nth(0).selectOption('custom');
    await page.locator('main input[type=date]').nth(0).fill('2026-03-01');
    await page.locator('main input[type=date]').nth(1).fill('2026-03-31');
    await selects.nth(1).selectOption('negative');
    await selects.nth(2).selectOption({ label: 'Groceries' });
    await selects.nth(3).selectOption({ label: 'Amex Platinum' });
    const api = await getJson(page.request, `/api/transactions?start=2026-03-01&end=2026-03-31&type=expense&category_id=${groceriesId}&account_id=${amexId}&limit=50`);
    expect(api.transactions.length).toBeGreaterThan(0);
    await expect(rows(page)).toHaveCount(api.transactions.length);
    for (const text of await rows(page).allInnerTexts()) {
      expect(text).toMatch(/2026-03-\d\d · Groceries · Amex Platinum/);
      expect(text).toContain('-$');
    }
    await shot(page, testInfo, 'transactions-05-filtered');

    await selects.nth(0).selectOption('all_time');
    await selects.nth(1).selectOption('positive');
    await selects.nth(2).selectOption('all');
    await selects.nth(3).selectOption('all');
    await page.getByPlaceholder('Search transactions…').fill('Payroll');
    const payroll = await getJson(page.request, '/api/transactions?type=income&q=Payroll&limit=50');
    expect(payroll.transactions.length).toBeGreaterThan(0);
    await expect(rows(page)).toHaveCount(payroll.transactions.length);
    await expect(rows(page).first()).toContainText('Direct Deposit - Acme Corp Payroll');
    for (const text of await rows(page).allInnerTexts()) {
      expect(text).toContain('Payroll');
      expect(text).toContain('+$');
    }

    await page.getByPlaceholder('Search transactions…').fill('zz-no-such-transaction-zz');
    await expect(page.getByText('No transactions.')).toBeVisible();
  });

  test('infinite scroll loads every transaction', async ({ page }) => {
    let total = 0;
    for (let offset = 0; ; offset += 200) {
      const body = await getJson(page.request, `/api/transactions?limit=200&offset=${offset}`);
      total += body.transactions.length;
      if (!body.hasMore) break;
    }
    await page.goto('/transactions');
    await expect(rows(page)).toHaveCount(50);
    const done = page.getByText('All transactions loaded');
    for (let i = 0; i < 20 && !(await done.isVisible()); i++) {
      await page.mouse.wheel(0, 20_000);
      await page.waitForTimeout(300);
    }
    await expect(done).toBeVisible();
    await expect(rows(page)).toHaveCount(total);
  });
});
