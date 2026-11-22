import { test, expect } from '@playwright/test';
import { login, getJson, uniqueTag, goToMonth, acceptNextDialog, shot } from './helpers.js';

test.describe('investments, calendar and trends', () => {
  test.beforeEach(async ({ page }) => {
    await login(page.request);
  });

  test('investments: holdings, chart, add, edit, delete', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const notes = uniqueTag('lot ');
    try {
      await page.goto('/investments');
      await expect(page.getByText('Total Invested')).toBeVisible({ timeout: 30_000 });
      const holdingRows = page.locator('main .divide-y > div');
      await expect(holdingRows.filter({ hasText: 'AAPL' })).toContainText('500.0000 shares');

      // The chart shows Yahoo Finance data, or a message when it cannot be fetched.
      const chartState = page.locator('main .recharts-surface')
        .or(page.getByText('No chart data available'))
        .or(page.locator('main .h-48.text-red-400'));
      await expect(chartState.first()).toBeVisible({ timeout: 30_000 });
      const yearHistory = page.waitForResponse(r => r.url().includes('/api/investments/history/') && r.url().includes('range=1y'));
      await page.getByRole('button', { name: '1Y', exact: true }).click();
      await expect(page.getByRole('button', { name: '1Y', exact: true })).toHaveClass(/bg-indigo-600/);
      await yearHistory;
      await expect(page.getByText('Loading chart…')).toHaveCount(0, { timeout: 30_000 });
      await expect(chartState.first()).toBeVisible({ timeout: 30_000 });
      await shot(page, testInfo, 'investments-01-list-and-chart');

      await page.getByRole('button', { name: '+ Add Holding' }).click();
      await page.getByPlaceholder('YES.V').fill('qqq');
      await page.getByPlaceholder('1000').fill('3');
      await page.getByPlaceholder('0.50').fill('400');
      await page.locator('main input[type=date]').fill('2024-01-02');
      await page.getByPlaceholder('e.g. TFSA purchase').fill(notes);
      await page.getByRole('button', { name: 'Save' }).click();
      const row = holdingRows.filter({ hasText: notes });
      await expect(row).toContainText('QQQ', { timeout: 30_000 });
      await expect(row).toContainText('3.0000 shares · bought 2024-01-02 @ $400.0000/sh · cost $1,200.00');

      await row.getByRole('button', { name: 'Edit' }).click();
      const editRow = holdingRows.filter({ has: page.getByPlaceholder('YES.V') });
      await editRow.getByPlaceholder('1000').fill('5');
      await editRow.getByRole('button', { name: 'Save' }).click();
      await expect(row).toContainText('5.0000 shares');
      expect((await getJson(page.request, '/api/investments')).find(h => h.notes === notes)).toMatchObject({ ticker: 'QQQ', shares: 5 });
      await shot(page, testInfo, 'investments-02-holding-edited');

      const dialogs = acceptNextDialog(page);
      await row.getByRole('button', { name: 'Delete' }).click();
      await expect(row).toHaveCount(0);
      expect(dialogs).toEqual(['confirm: Remove this holding?']);
    } finally {
      const left = (await getJson(page.request, '/api/investments')).filter(h => h.notes === notes);
      for (const h of left) await page.request.delete(`/api/investments/${h.id}`);
    }
  });

  test('calendar: past month with transactions, popover, projected recurring items', async ({ page }, testInfo) => {
    await page.goto('/calendar');
    await goToMonth(page, 2026, 5);
    const may = await getJson(page.request, '/api/calendar/2026/5');
    expect(may.actual.length).toBeGreaterThan(0);
    const payroll = page.getByRole('button', { name: /Direct Deposit - Acme Corp Payroll/ }).first();
    await expect(payroll).toBeVisible();
    await payroll.click();
    await expect(page.getByText('+$35000.00')).toBeVisible();
    await expect(page.getByText('Salary', { exact: true })).toBeVisible();
    await shot(page, testInfo, 'calendar-01-may-2026-popover');
    await page.getByRole('button', { name: '✕' }).click();

    const next = new Date();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    await goToMonth(page, next.getFullYear(), next.getMonth() + 1, { year: 2026, month: 5 });
    const future = await getJson(page.request, `/api/calendar/${next.getFullYear()}/${next.getMonth() + 1}`);
    expect(future.projected.length).toBeGreaterThan(0);
    await expect(page.getByText(`${future.projected.length} upcoming`)).toBeVisible();
    await expect(page.locator('main button.border-dashed').first()).toBeVisible();
    await shot(page, testInfo, 'calendar-02-next-month-projected');
  });

  test('trends: categories, range, select and deselect all', async ({ page }, testInfo) => {
    await page.goto('/trends');
    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible();
    await expect(page.getByLabel('Groceries')).toBeChecked();
    await expect(page.getByLabel('Salary')).not.toBeChecked();
    await page.locator('main select').selectOption('24');
    await expect(page.locator('main .recharts-line').first()).toBeVisible();
    await shot(page, testInfo, 'trends-01-24-months');

    await page.getByRole('button', { name: 'Select All' }).click();
    await expect(page.getByLabel('Salary')).toBeChecked();
    await page.getByRole('button', { name: 'Deselect All' }).click();
    await expect(page.getByText('Select at least one envelope to see trends.')).toBeVisible();
    await page.getByLabel('Groceries').check();
    await expect(page.locator('main .recharts-line')).toHaveCount(1);
    await expect(page.locator('main .recharts-legend-item')).toHaveText(['Groceries']);
  });
});
