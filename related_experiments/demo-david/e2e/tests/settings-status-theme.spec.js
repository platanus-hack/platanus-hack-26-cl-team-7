import { test, expect } from '@playwright/test';
import { login, getJson, uniqueTag, acceptNextDialog, shot, topNav, readability, goToMonth } from './helpers.js';

test.describe('settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page.request);
  });

  test('change password: mismatch, too short, wrong current, success', async ({ page, playwright, baseURL }, testInfo) => {
    await page.goto('/settings');
    const fields = page.locator('form input[type=password]');
    const submit = page.getByRole('button', { name: 'Change Password' });
    const fill = async (current, next, confirm) => {
      await fields.nth(0).fill(current);
      await fields.nth(1).fill(next);
      await fields.nth(2).fill(confirm);
      await submit.click();
    };

    await fill('changeme', 'newpassword123', 'different123');
    await expect(page.getByText('Passwords do not match')).toBeVisible();
    await fill('changeme', 'short', 'short');
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
    await fill('WRONG-password', 'newpassword123', 'newpassword123');
    await expect(page.getByText('Current password incorrect')).toBeVisible();
    await shot(page, testInfo, 'settings-01-wrong-current-password');

    const fresh = await playwright.request.newContext({ baseURL });
    try {
      await fill('changeme', 'newpassword123', 'newpassword123');
      await expect(page.getByText('Password changed.')).toBeVisible();
      await expect(fields.nth(0)).toHaveValue('');
      expect((await fresh.post('/api/auth/login', { data: { username: 'admin', password: 'newpassword123' } })).status()).toBe(200);
      expect((await fresh.post('/api/auth/login', { data: { username: 'admin', password: 'changeme' } })).status()).toBe(401);
    } finally {
      await page.request.put('/api/auth/password', { data: { currentPassword: 'newpassword123', newPassword: 'changeme' } });
      await fresh.dispose();
    }
    expect((await page.request.post('/api/auth/login', { data: { username: 'admin', password: 'changeme' } })).status()).toBe(200);
  });

  test('accounts: add, sync balance, delete', async ({ page }, testInfo) => {
    const name = uniqueTag('Acct ');
    try {
      await page.goto('/settings');
      const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Accounts' }) });
      await expect(section).toContainText('Chase Sapphire Checking');
      await section.getByRole('button', { name: '+ Add account' }).click();
      await section.getByPlaceholder('Name').fill(name);
      await section.locator('select').selectOption('savings');
      await section.getByPlaceholder('Opening balance').fill('100');
      await section.getByRole('button', { name: 'Add', exact: true }).click();
      const row = section.locator('div.border-b').filter({ hasText: name });
      await expect(row).toContainText('savings');
      await expect(row).toContainText('$100.00');

      await row.getByRole('button', { name: 'Sync' }).click();
      const balance = row.locator('input[type=number]');
      await expect(balance).toHaveValue('100.00');
      await balance.fill('');
      await row.getByRole('button', { name: 'Save' }).click();
      await expect(row.getByText('Enter a valid number')).toBeVisible();
      await balance.fill('250.5');
      await row.getByRole('button', { name: 'Save' }).click();
      await expect(row).toContainText('$250.50');
      expect((await getJson(page.request, '/api/accounts')).find(a => a.name === name)).toMatchObject({ type: 'savings', current_balance: 250.5 });
      await shot(page, testInfo, 'settings-02-account-synced');

      const dialogs = acceptNextDialog(page);
      await row.getByRole('button', { name: 'Delete' }).click();
      await expect(row).toHaveCount(0);
      expect(dialogs).toEqual(['confirm: Delete this account?']);
    } finally {
      const left = (await getJson(page.request, '/api/accounts')).filter(a => a.name === name);
      for (const a of left) await page.request.delete(`/api/accounts/${a.id}`);
    }
  });
});

test('status page renders in the browser', async ({ page }, testInfo) => {
  await page.goto('/status');
  await expect(page).toHaveTitle('Budget App Status');
  await expect(page.getByText('OPERATIONAL')).toBeVisible();
  await expect(page.locator('tr', { hasText: 'server' })).toContainText('✓ ok');
  await expect(page.locator('tr', { hasText: 'database' })).toContainText('✓ ok');
  await shot(page, testInfo, 'status-01-page');
});

test.describe('theme', () => {
  const LIGHT = { shell: 'rgb(249, 250, 251)', nav: 'rgb(255, 255, 255)' };
  const DARK = { shell: 'rgb(17, 24, 39)', nav: 'rgb(31, 41, 55)' };
  const storedTheme = page => page.evaluate(() => localStorage.getItem('theme'));
  const toLight = page => page.getByRole('button', { name: 'Switch to light theme' });
  const toDark = page => page.getByRole('button', { name: 'Switch to dark theme' });

  test('without a choice the page follows the system color scheme and stores nothing', async ({ page }, testInfo) => {
    await login(page.request);
    const shell = page.locator('#root > div').first();
    await page.goto('/dashboard');
    await expect(shell).toHaveCSS('background-color', LIGHT.shell);
    await expect(toDark(page)).toBeVisible();
    await shot(page, testInfo, 'theme-01-light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(shell).toHaveCSS('background-color', DARK.shell);
    await expect(topNav(page)).toHaveCSS('background-color', DARK.nav);
    await expect(toLight(page)).toBeVisible();
    await shot(page, testInfo, 'theme-02-dark');
    expect(await storedTheme(page)).toBeNull();
  });

  test('the toggle switches the theme, remembers it across reloads and beats the system setting', async ({ page }, testInfo) => {
    await login(page.request);
    const shell = page.locator('#root > div').first();
    await page.goto('/dashboard');
    await expect(shell).toHaveCSS('background-color', LIGHT.shell);

    await toDark(page).click();
    await expect(shell).toHaveCSS('background-color', DARK.shell);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(toLight(page)).toBeVisible();
    expect(await storedTheme(page)).toBe('dark');
    await shot(page, testInfo, 'theme-03-toggled-dark');

    // Still dark after a reload, and while the system says light.
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(shell).toHaveCSS('background-color', DARK.shell);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(shell).toHaveCSS('background-color', DARK.shell);

    // And back.
    await toLight(page).click();
    await expect(shell).toHaveCSS('background-color', LIGHT.shell);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    expect(await storedTheme(page)).toBe('light');
    await page.reload();
    await expect(shell).toHaveCSS('background-color', LIGHT.shell);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(shell).toHaveCSS('background-color', LIGHT.shell);
  });

  test('a saved choice is applied before the app code runs, so the page does not flash', async ({ page }) => {
    await login(page.request);
    await page.goto('/dashboard');
    await toDark(page).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // With the script bundle blocked only index.html and its inline script run.
    await page.route('**/assets/*.js', route => route.abort());
    await page.goto('/settings');
    expect(await page.evaluate(() => document.getElementById('root').children.length)).toBe(0);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.unroute('**/assets/*.js');

    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.route('**/assets/*.js', route => route.abort());
    await page.goto('/settings');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('the login and sign-up pages have the toggle and share the choice', async ({ page }, testInfo) => {
    await page.goto('/login');
    const card = page.locator('h1').locator('xpath=..');
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await toDark(page).click();
    await expect(card).toHaveCSS('background-color', DARK.nav);
    await expect(page.locator('input#username')).toHaveCSS('background-color', 'rgb(55, 65, 81)');
    await shot(page, testInfo, 'theme-04-login-dark');

    await page.getByRole('link', { name: 'Sign up' }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.locator('h1').locator('xpath=..')).toHaveCSS('background-color', DARK.nav);
    await shot(page, testInfo, 'theme-05-signup-dark');
    await toLight(page).click();
    await expect(page.locator('h1').locator('xpath=..')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await page.getByRole('link', { name: 'Log in' }).click();
    await expect(page.locator('h1').locator('xpath=..')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });

  const PAGES = [
    ['/dashboard', 'Dashboard'], ['/transactions', 'Transactions'], ['/import', 'Import Transactions'],
    ['/envelopes', 'Envelopes'], ['/debt', 'Debt Planner'], ['/calendar', 'Calendar'], ['/trends', 'Trends'],
    ['/goals', 'Savings Goals'], ['/rules', 'Categorization Rules'], ['/investments', 'Investments'], ['/settings', 'Settings'],
  ];

  for (const scheme of ['light', 'dark']) {
    test(`every page title is readable and no text disappears: ${scheme} theme`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await login(page.request);
      await page.emulateMedia({ colorScheme: scheme });
      for (const [path, title] of PAGES) {
        await page.goto(path);
        await expect(page.locator('main h1')).toHaveText(title);
        await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 45_000 });
        const result = await readability(page);
        expect(result.title.ratio, `${path} title contrast`).toBeGreaterThanOrEqual(4.5);
        expect(result.invisible, `${path} invisible text`).toEqual([]);
        expect(result.checked, `${path} elements checked`).toBeGreaterThan(5);
        await shot(page, testInfo, `theme-page-${scheme}${path.replace('/', '-')}`);
      }
    });

    test(`forms and pop-ups are readable: ${scheme} theme`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await login(page.request);
      await page.emulateMedia({ colorScheme: scheme });

      await page.goto('/debt');
      await page.getByRole('button', { name: '+ Add Debt' }).click();
      await expect(page.getByText('New Debt')).toBeVisible();
      await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 15_000 });
      let result = await readability(page);
      expect(result.invisible, 'debt form').toEqual([]);
      await shot(page, testInfo, `theme-form-${scheme}-debt`);
      await page.getByRole('button', { name: 'Edit' }).first().click();
      result = await readability(page);
      expect(result.invisible, 'debt edit form').toEqual([]);

      await page.goto('/investments');
      await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 45_000 });
      await page.getByRole('button', { name: '+ Add Holding' }).click();
      await expect(page.getByText('New Holding')).toBeVisible();
      result = await readability(page);
      expect(result.invisible, 'holding form').toEqual([]);
      await shot(page, testInfo, `theme-form-${scheme}-holding`);

      await page.goto('/calendar');
      await goToMonth(page, 2026, 5);
      await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 15_000 });
      await page.locator('main button[title*="$"]').first().click();
      await expect(page.locator('.absolute.z-50')).toBeVisible();
      result = await readability(page);
      expect(result.invisible, 'calendar popover').toEqual([]);
      await shot(page, testInfo, `theme-form-${scheme}-calendar-popover`);
    });
  }
});
