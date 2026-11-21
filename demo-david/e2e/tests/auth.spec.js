import { test, expect } from '@playwright/test';
import { ADMIN, login, shot, topNav, uniqueTag } from './helpers.js';

test.describe('authentication', () => {
  test('login page: log in with the test account, then log out', async ({ page }, testInfo) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible();
    await shot(page, testInfo, 'auth-01-login-page');

    await page.getByLabel('Username').fill(ADMIN.username);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const cookies = await page.context().cookies();
    const token = cookies.find(c => c.name === 'budget_token');
    expect(token, 'auth cookie').toBeTruthy();
    expect(token.httpOnly).toBe(true);
    expect(token.sameSite).toBe('Strict');
    await shot(page, testInfo, 'auth-02-logged-in-dashboard');

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.context().cookies()).find(c => c.name === 'budget_token')).toBeFalsy();
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);

    // Protected pages send the visitor back to the login page.
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
    await shot(page, testInfo, 'auth-03-after-logout');
  });

  test('wrong password and unknown user show an error and stay on login', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill(ADMIN.username);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await shot(page, testInfo, 'auth-04-wrong-password');

    await page.getByLabel('Username').fill('no-such-user');
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  });

  test('login API: success, wrong password, missing fields', async ({ request }) => {
    const wrong = await request.post('/api/auth/login', { data: { username: 'admin', password: 'nope' } });
    expect(wrong.status()).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'Invalid credentials' });

    const missing = await request.post('/api/auth/login', { data: { username: 'admin' } });
    expect(missing.status()).toBe(400);
    expect(await missing.json()).toEqual({ error: 'Username and password required' });

    const ok = await request.post('/api/auth/login', { data: ADMIN });
    expect(ok.status()).toBe(200);
    expect(ok.headers()['set-cookie']).toMatch(/budget_token=.+HttpOnly; SameSite=Strict/);
    const me = await request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ username: 'admin' });

    const logout = await request.post('/api/auth/logout', { data: {} });
    expect(logout.status()).toBe(200);
    expect((await request.get('/api/auth/me')).status()).toBe(401);
  });

  test('tokens: no token, garbage token, tampered token and bearer header are all 401', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    await login(ctx);
    const { cookies } = await ctx.storageState();
    const token = cookies.find(c => c.name === 'budget_token').value;
    await ctx.dispose();

    const tries = {
      none: {},
      garbage: { Cookie: 'budget_token=garbage' },
      tampered: { Cookie: `budget_token=${token.slice(0, -4)}AAAA` },
      bearer: { Authorization: `Bearer ${token}` },
    };
    const anon = await playwright.request.newContext({ baseURL });
    for (const [name, headers] of Object.entries(tries)) {
      const res = await anon.get('/api/auth/me', { headers });
      expect(res.status(), name).toBe(401);
      expect(await res.json(), name).toEqual({ error: 'Unauthorized' });
    }
    const valid = await anon.get('/api/auth/me', { headers: { Cookie: `budget_token=${token}` } });
    expect(valid.status()).toBe(200);
    await anon.dispose();
  });

  test('sign up from the login page, land on the dashboard, log out and log in again', async ({ page }, testInfo) => {
    const username = uniqueTag('user').toLowerCase();
    const password = 'visitor-pass-123';
    await page.goto('/login');
    await page.getByRole('link', { name: 'Sign up' }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
    await shot(page, testInfo, 'signup-01-form');

    // Checked in the browser before anything is sent.
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill('something-else-1');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByRole('alert')).toHaveText('Passwords do not match');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('short');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByRole('alert')).toHaveText('Password must be at least 8 characters');
    expect((await page.context().cookies()).find(c => c.name === 'budget_token')).toBeFalsy();

    // The server refuses a name that is taken, whatever the letter case.
    await page.getByLabel('Username', { exact: true }).fill('ADMIN');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByRole('alert')).toHaveText('Username already taken');
    await expect(page).toHaveURL(/\/signup$/);
    await shot(page, testInfo, 'signup-02-name-taken');

    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const token = (await page.context().cookies()).find(c => c.name === 'budget_token');
    expect(token, 'auth cookie').toBeTruthy();
    expect(token.httpOnly).toBe(true);
    expect(token.sameSite).toBe('Strict');
    expect(await (await page.request.get('/api/auth/me')).json()).toMatchObject({ username });
    await shot(page, testInfo, 'signup-03-dashboard');

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('the sign-up page links back to the login page', async ({ page }) => {
    await page.goto('/signup');
    await page.getByRole('link', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('sign-up API: creates a session, then rejects duplicates and bad input', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    const username = uniqueTag('api').toLowerCase();
    const password = 'visitor-pass-123';

    const created = await ctx.post('/api/auth/signup', { data: { username, password } });
    expect(created.status()).toBe(201);
    expect(await created.json()).toEqual({ ok: true });
    expect(created.headers()['set-cookie']).toMatch(/budget_token=.+HttpOnly; SameSite=Strict/);
    const me = await ctx.get('/api/auth/me');
    expect(await me.json()).toEqual({ id: expect.any(Number), username });

    const other = await playwright.request.newContext({ baseURL });
    const again = await other.post('/api/auth/signup', { data: { username: username.toUpperCase(), password } });
    expect(again.status()).toBe(409);
    expect(await again.json()).toEqual({ error: 'Username already taken' });
    expect(again.headers()['set-cookie']).toBeUndefined();
    expect((await other.post('/api/auth/signup', { data: { username: 'admin', password } })).status()).toBe(409);

    const bad = [
      [{ password }, 'Username and password required'],
      [{ username }, 'Username and password required'],
      [{ username: 'ab', password }, /3 to 32/],
      [{ username: 'has space', password }, /3 to 32/],
      [{ username: uniqueTag('p'), password: 'short' }, 'Password must be at least 8 characters'],
      [{ username: uniqueTag('p'), password: 'x'.repeat(73) }, 'Password is too long'],
      [{ username: { a: 1 }, password }, 'Username and password required'],
    ];
    for (const [data, message] of bad) {
      const res = await other.post('/api/auth/signup', { data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
      expect((await res.json()).error, JSON.stringify(data)).toMatch(message instanceof RegExp ? message : new RegExp(`^${message}$`));
      expect(res.headers()['set-cookie']).toBeUndefined();
    }
    expect((await other.get('/api/auth/me')).status()).toBe(401);

    const login = await other.post('/api/auth/login', { data: { username, password } });
    expect(login.status()).toBe(200);
    await ctx.dispose();
    await other.dispose();
  });

  test('navigation bar reaches every page', async ({ page }) => {
    await login(page.request);
    await page.goto('/dashboard');
    const pages = {
      Transactions: 'Transactions',
      Import: 'Import Transactions',
      Envelopes: 'Envelopes',
      Debt: 'Debt Planner',
      Calendar: 'Calendar',
      Trends: 'Trends',
      Goals: 'Savings Goals',
      Investments: 'Investments',
      Settings: 'Settings',
      Dashboard: 'Dashboard',
    };
    for (const [link, heading] of Object.entries(pages)) {
      await topNav(page).getByRole('link', { name: link, exact: true }).click();
      await expect(page.locator('main h1')).toHaveText(heading);
    }
  });
});
