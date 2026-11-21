import { test, expect } from '@playwright/test';
import { login, getJson, categoryId, uniqueTag, acceptNextDialog, shot } from './helpers.js';

const envelopeRows = page => page.locator('main .divide-y > div');

async function showMonth(page, year, month) {
  const selects = page.locator('main select');
  await selects.nth(0).selectOption(String(year));
  await selects.nth(1).selectOption(String(month));
}

async function allocated(request, year, month, catId) {
  return (await getJson(request, `/api/budget/${year}/${month}`)).find(e => e.category_id === catId).allocated;
}

test.describe('envelopes page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page.request);
  });

  test('edit an allocation and transfer budget between envelopes', async ({ page }, testInfo) => {
    const gasId = await categoryId(page.request, 'Gas');
    const groceriesId = await categoryId(page.request, 'Groceries');
    const gasBefore = await allocated(page.request, 2026, 5, gasId);
    const groceriesBefore = await allocated(page.request, 2026, 5, groceriesId);
    try {
      await page.goto('/envelopes');
      await showMonth(page, 2026, 5);
      const gasInput = envelopeRows(page).filter({ hasText: /^Gas/ }).locator('input[type=number]');
      await expect(gasInput).toHaveValue(String(gasBefore));
      await gasInput.fill(String(gasBefore + 33));
      await gasInput.blur();
      await expect.poll(() => allocated(page.request, 2026, 5, gasId)).toBe(gasBefore + 33);

      await page.getByRole('button', { name: 'Transfer', exact: true }).click();
      const modal = page.locator('.fixed.inset-0').filter({ hasText: 'Transfer Budget' });
      await expect(modal).toBeVisible();
      await modal.getByRole('button', { name: 'Transfer' }).click();
      await expect(modal.getByText('Amount must be greater than 0.')).toBeVisible();
      await modal.locator('select').nth(0).selectOption(String(groceriesId));
      await modal.locator('select').nth(1).selectOption(String(gasId));
      await modal.locator('input[type=number]').fill('1000000');
      await modal.getByRole('button', { name: 'Transfer' }).click();
      await expect(modal.getByText('Insufficient allocated budget in source envelope')).toBeVisible();
      await modal.locator('input[type=number]').fill('50');
      await shot(page, testInfo, 'envelopes-01-transfer-modal');
      await modal.getByRole('button', { name: 'Transfer' }).click();
      await expect(modal).toHaveCount(0);
      await expect(envelopeRows(page).filter({ hasText: /^Gas/ }).locator('input[type=number]')).toHaveValue(String(gasBefore + 83));
      await expect(envelopeRows(page).filter({ hasText: /^Groceries/ }).locator('input[type=number]')).toHaveValue(String(groceriesBefore - 50));
      await shot(page, testInfo, 'envelopes-02-after-transfer');
    } finally {
      await page.request.put(`/api/budget/2026/5/${gasId}`, { data: { allocated: gasBefore } });
      await page.request.put(`/api/budget/2026/5/${groceriesId}`, { data: { allocated: groceriesBefore } });
    }
  });

  test('add, edit and delete a category', async ({ page }, testInfo) => {
    const name = uniqueTag('Hobbies ');
    await page.goto('/envelopes');
    await page.getByRole('button', { name: '+ Category' }).click();
    const newBox = page.locator('main > div > div').filter({ hasText: 'New Category' });
    await newBox.getByPlaceholder('Name').fill(name);
    await newBox.getByPlaceholder('Default $').fill('80');
    await newBox.getByRole('button', { name: 'Save' }).click();
    const row = envelopeRows(page).filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row.locator('input[type=number]')).toHaveValue('80');
    const cat = (await getJson(page.request, '/api/categories')).find(c => c.name === name);
    expect(cat).toMatchObject({ type: 'expense', default_allocation: 80, rollover: 0 });

    await row.getByRole('button', { name: 'Edit' }).click();
    const editRow = envelopeRows(page).filter({ has: page.getByPlaceholder('Name') });
    await editRow.getByPlaceholder('Name').fill(`${name} edited`);
    await editRow.getByRole('checkbox').check();
    await editRow.getByRole('button', { name: 'Save' }).click();
    const editedRow = envelopeRows(page).filter({ hasText: `${name} edited` });
    await expect(editedRow).toContainText('Rollover');
    await shot(page, testInfo, 'envelopes-03-category-edited');

    const dialogs = acceptNextDialog(page);
    await editedRow.getByRole('button', { name: 'Delete' }).click();
    await expect(editedRow).toHaveCount(0);
    expect(dialogs).toEqual(['confirm: Delete this category? Transactions will become uncategorized.']);
    expect((await getJson(page.request, '/api/categories')).some(c => c.id === cat.id)).toBe(false);
  });

  test('copy allocations from the previous month and roll over to the next', async ({ page }) => {
    const gasId = await categoryId(page.request, 'Gas');
    const savingsId = await categoryId(page.request, 'Savings');
    await getJson(page.request, '/api/budget/2027/1');
    await page.request.put(`/api/budget/2027/1/${gasId}`, { data: { allocated: 444 } });

    await page.goto('/envelopes');
    await showMonth(page, 2027, 2);
    const dialogs = acceptNextDialog(page);
    await page.getByRole('button', { name: 'Copy from January 2027' }).click();
    await expect(envelopeRows(page).filter({ hasText: /^Gas/ }).locator('input[type=number]')).toHaveValue('444');
    expect(dialogs).toEqual(['confirm: Copy allocations from January 2027? This will overwrite current values.']);

    acceptNextDialog(page, dialogs);
    await page.getByRole('button', { name: 'Rollover to next month' }).click();
    await expect.poll(() => dialogs.length).toBe(2);
    expect(dialogs[1]).toBe('alert: Rolled over to March 2027');
    const march = await getJson(page.request, '/api/budget/2027/3');
    expect(march.find(e => e.category_id === savingsId).rolled_over).toBeGreaterThan(0);
  });
});
