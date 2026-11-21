import { test, expect } from '@playwright/test';
import { login, getJson, accountId, goToMonth, monthLabel, shot } from './helpers.js';

function summary(envelopes) {
  const expenses = envelopes.filter(e => e.type === 'expense');
  const income = envelopes.filter(e => e.type === 'income');
  return {
    budgeted: expenses.reduce((s, e) => s + e.allocated + e.rolled_over, 0),
    earned: income.reduce((s, e) => s + e.spent, 0),
    spent: expenses.reduce((s, e) => s + Math.max(0, -e.spent), 0),
  };
}

async function expectCard(page, label, amount) {
  await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toContainText(`$${amount.toFixed(2)}`);
}

test('dashboard: month navigation, summary cards, account filter and sections', async ({ page }, testInfo) => {
  await login(page.request);
  await page.goto('/dashboard');
  const now = new Date();
  await expect(page.getByText(monthLabel(now.getFullYear(), now.getMonth() + 1), { exact: true })).toBeVisible();
  const latest = await getJson(page.request, '/api/transactions/latest-date');
  await expect(page.getByText(`as of ${latest.date}`)).toBeVisible();

  await goToMonth(page, 2026, 5);
  const all = summary(await getJson(page.request, '/api/budget/2026/5'));
  expect(all.earned).toBeGreaterThan(0);
  expect(all.spent).toBeGreaterThan(0);
  await expectCard(page, 'Budgeted', all.budgeted);
  await expectCard(page, 'Earned', all.earned);
  await expectCard(page, 'Spent', all.spent);
  await expect(page.getByRole('button', { name: /^Net/ })).toContainText((all.earned - all.spent).toFixed(2));

  const groceriesCard = page.locator('main section').first().locator('div.rounded-xl').filter({ hasText: 'Groceries' });
  await expect(groceriesCard).toContainText('spent');
  await expect(groceriesCard).toContainText('budgeted');
  await expect(page.getByRole('heading', { name: 'Debts' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Savings Goals' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Investments' })).toBeVisible({ timeout: 30_000 });
  await shot(page, testInfo, 'dashboard-01-may-2026');

  // Summary modal
  await page.getByRole('button', { name: /^Spent/ }).click();
  await expect(page.getByText('Spending by envelope this month')).toBeVisible();
  await shot(page, testInfo, 'dashboard-02-spent-modal');
  await page.getByRole('button', { name: '✕' }).click();
  await expect(page.getByText('Spending by envelope this month')).toHaveCount(0);

  // Account filter
  const amexId = await accountId(page.request, 'Amex Platinum');
  await page.locator('main select').first().selectOption({ label: 'Amex Platinum' });
  const amex = summary(await getJson(page.request, `/api/budget/2026/5?account_id=${amexId}`));
  await expectCard(page, 'Spent', amex.spent);
  await expectCard(page, 'Earned', amex.earned);
  const amexBalance = (await getJson(page.request, '/api/accounts')).find(a => a.id === amexId).current_balance;
  await expect(page.locator('main').getByText(`$${amexBalance.toFixed(2)}`).first()).toBeVisible();
  await shot(page, testInfo, 'dashboard-03-amex-filter');
});
