import { test, expect } from '@playwright/test';
import { login, getJson, uniqueTag, acceptNextDialog, shot } from './helpers.js';

// Reads the three projection tiles; null while the projection is recalculating.
async function readProjection(page) {
  const text = await page.locator('main').innerText();
  const months = text.match(/Months remaining\s+(\d+)/);
  const interest = text.match(/Total interest\s+\$([\d.]+)/);
  const payoff = text.match(/Payoff date\s+(\d{4}-\d{2})/);
  if (!months || !interest || !payoff) return null;
  return { months: Number(months[1]), interest: Number(interest[1]), payoff: payoff[1] };
}

test.describe('debt planner and goals', () => {
  test.beforeEach(async ({ page }) => {
    await login(page.request);
  });

  test('debt planner: add, edit, payoff projection, method, delete', async ({ page }, testInfo) => {
    const name = uniqueTag('Store Card ');
    try {
      await page.goto('/debt');
      await expect(page.getByRole('heading', { name: 'Payoff Projection' })).toBeVisible();
      await expect(page.locator('.recharts-surface').first()).toBeVisible();

      await page.getByRole('button', { name: '+ Add Debt' }).click();
      const form = page.locator('main > div > div').filter({ hasText: 'New Debt' });
      const inputs = form.locator('input');
      await inputs.nth(0).fill(name);
      await inputs.nth(1).fill('800');
      await inputs.nth(2).fill('26.99');
      await inputs.nth(3).fill('2000');
      await inputs.nth(4).fill('35');
      await inputs.nth(5).fill('9');
      await form.getByRole('button', { name: 'Save' }).click();
      const card = page.locator('main .space-y-3 > div').filter({ hasText: name });
      await expect(card).toContainText('$800.00');
      await expect(card).toContainText('26.99%');
      await expect(card).toContainText('Due day 9 of month');
      await expect(card).toContainText('40%');
      const saved = (await getJson(page.request, '/api/debts')).find(d => d.name === name);
      expect(saved).toMatchObject({ balance: 800, apr: 26.99, credit_limit: 2000, minimum_payment: 35, due_day: 9 });

      const apiBase = await getJson(page.request, '/api/debts/projection?extraPayment=0&method=avalanche');
      const base = { months: apiBase.months.length, interest: apiBase.totalInterest, payoff: apiBase.payoffDate };
      await expect.poll(() => readProjection(page)).toEqual(base);

      await page.locator('input[type=range]').fill('250');
      await expect(page.getByText('$250', { exact: true })).toBeVisible();
      await expect.poll(async () => (await readProjection(page))?.months ?? Infinity).toBeLessThan(base.months);
      await page.getByRole('button', { name: 'snowball' }).click();
      await expect(page.getByRole('button', { name: 'snowball' })).toHaveClass(/bg-indigo-600/);
      const apiSnowball = await getJson(page.request, '/api/debts/projection?extraPayment=250&method=snowball');
      await expect.poll(async () => (await readProjection(page))?.months).toBe(apiSnowball.months.length);
      await shot(page, testInfo, 'debt-01-projection-snowball-250');

      await card.getByRole('button', { name: 'Edit' }).click();
      const editCard = page.locator('main .space-y-3 > div').filter({ has: page.getByRole('button', { name: 'Cancel' }) });
      await editCard.locator('input').nth(1).fill('650');
      await editCard.getByRole('button', { name: 'Save' }).click();
      await expect(card).toContainText('$650.00');
      expect((await getJson(page.request, '/api/debts')).find(d => d.name === name).balance).toBe(650);

      const dialogs = acceptNextDialog(page);
      await card.getByRole('button', { name: 'Delete' }).click();
      await expect(card).toHaveCount(0);
      expect(dialogs).toEqual(['confirm: Remove this debt?']);
    } finally {
      const left = (await getJson(page.request, '/api/debts')).filter(d => d.name === name);
      for (const d of left) await page.request.delete(`/api/debts/${d.id}`);
    }
  });

  test('goals: add with validation, edit, complete, reopen, delete', async ({ page }, testInfo) => {
    const name = uniqueTag('New Laptop ');
    try {
      await page.goto('/goals');
      await expect(page.getByText('Lake Tahoe Cabin')).toBeVisible();

      await page.getByRole('button', { name: '+ Add Goal' }).click();
      await page.getByPlaceholder('Emergency Fund').fill(name);
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('target_amount must be a positive number')).toBeVisible();
      await page.getByPlaceholder('5000').fill('2500');
      await page.locator('main input[type=date]').fill('2027-03-01');
      await page.locator('main select').selectOption({ label: 'Marcus High-Yield Savings (savings)' });
      await page.getByRole('button', { name: 'Save' }).click();
      const card = page.locator('main .space-y-3 > div').filter({ hasText: name });
      await expect(card).toContainText('Marcus High-Yield Savings · Due Mar 2027');
      await expect(card).toContainText('$2,500.00');
      await shot(page, testInfo, 'goals-01-added');

      await card.getByRole('button', { name: 'Edit' }).click();
      await expect(page.getByRole('heading', { name: 'Edit Goal' })).toBeVisible();
      await page.getByPlaceholder('5000').fill('3200');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(card).toContainText('$3,200.00');

      await card.getByRole('button', { name: 'Mark complete' }).click();
      await expect(card).toContainText('Completed ');
      await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
      expect((await getJson(page.request, '/api/goals')).find(g => g.name === name).completed_at).not.toBeNull();
      await shot(page, testInfo, 'goals-02-completed');
      await card.getByRole('button', { name: 'Unmark' }).click();
      await expect(card.getByRole('button', { name: 'Mark complete' })).toBeVisible();

      const dialogs = acceptNextDialog(page);
      await card.getByRole('button', { name: 'Delete' }).click();
      await expect(card).toHaveCount(0);
      expect(dialogs).toEqual(['confirm: Remove this goal?']);
    } finally {
      const left = (await getJson(page.request, '/api/goals')).filter(g => g.name === name);
      for (const g of left) await page.request.delete(`/api/goals/${g.id}`);
    }
  });
});
