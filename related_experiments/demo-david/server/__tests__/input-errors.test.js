// Bad input must end in a JSON 4xx before it reaches SQLite, and never in a stack trace.
const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestApp } = require('./helpers');

const LEAK = /\n\s+at |node_modules|\/Users\/|SqliteError|CHECK constraint|datatype mismatch/;

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/api/auth',         require('../routes/authRoutes')(db));
    app.use('/api/accounts',     require('../routes/accountRoutes')(db));
    app.use('/api/categories',   require('../routes/categoryRoutes')(db));
    app.use('/api/budget',       require('../routes/budgetRoutes')(db));
    app.use('/api/transactions', require('../routes/transactionRoutes')(db));
    app.use('/api/import',       require('../routes/importRoutes')(db));
    app.use('/api/debts',        require('../routes/debtRoutes')(db));
    app.use('/api/investments',  require('../routes/investmentRoutes')(db));
  });
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run('admin', bcrypt.hashSync('pass', 4));
  db.prepare('INSERT INTO categories (name, type, default_allocation, rollover) VALUES (?,?,?,?)').run('Food', 'expense', 200, 0);
  db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('Chequing', 'checking', 1000);
  return { app, db };
}

async function cookieFor(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pass' });
  return res.headers['set-cookie'][0];
}

// Sends a request as the logged-in user and checks the answer is a clean JSON 400.
async function expectRejected(app, cookie, method, url, body, message) {
  const res = await request(app)[method](url).set('Cookie', cookie).send(body);
  expect(res.status).toBe(400);
  expect(res.headers['content-type']).toMatch(/json/);
  expect(res.text).not.toMatch(LEAK);
  if (message) expect(res.body.error).toMatch(message);
  return res;
}

describe('accounts', () => {
  test('POST rejects an unknown type', async () => {
    const { app, db } = setup();
    const before = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
    await expectRejected(app, await cookieFor(app), 'post', '/api/accounts', { name: 'Bad', type: 'brokerage' }, /type must be one of/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n).toBe(before);
  });

  test('POST rejects a blank name and a non-numeric balance', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    await expectRejected(app, cookie, 'post', '/api/accounts', { name: '   ', type: 'savings' });
    await expectRejected(app, cookie, 'post', '/api/accounts', { name: 'A', type: 'savings', balance: 'lots' }, /balance/);
    await expectRejected(app, cookie, 'post', '/api/accounts', { name: 'A', type: 'savings', balance: {} }, /balance/);
  });

  test('POST still accepts every real type and a numeric string balance', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    for (const type of ['checking', 'savings', 'credit']) {
      const res = await request(app).post('/api/accounts').set('Cookie', cookie).send({ name: `A-${type}`, type, balance: '12.5' });
      expect(res.status).toBe(201);
      expect(res.body.balance).toBe(12.5);
    }
  });

  test('PUT rejects an unknown type and a missing balance', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    await expectRejected(app, cookie, 'put', '/api/accounts/1', { name: 'X', type: 'brokerage', balance: 1 }, /type must be one of/);
    await expectRejected(app, cookie, 'put', '/api/accounts/1', { name: 'X', type: 'savings' }, /balance/);
  });
});

describe('categories', () => {
  test('POST rejects the type "transfer"', async () => {
    const { app, db } = setup();
    const before = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
    await expectRejected(app, await cookieFor(app), 'post', '/api/categories', { name: 'Moves', type: 'transfer' }, /type must be one of/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n).toBe(before);
  });

  test('POST rejects a non-numeric allocation; PUT rejects a bad type', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    await expectRejected(app, cookie, 'post', '/api/categories', { name: 'X', type: 'expense', default_allocation: 'lots' }, /default_allocation/);
    await expectRejected(app, cookie, 'put', '/api/categories/1', { name: 'Food', type: 'bogus', default_allocation: 5 }, /type must be one of/);
  });

  test('POST still accepts income and expense', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    for (const type of ['income', 'expense']) {
      const res = await request(app).post('/api/categories').set('Cookie', cookie).send({ name: `C-${type}`, type });
      expect(res.status).toBe(201);
      expect(res.body.default_allocation).toBe(0);
    }
  });
});

describe('debts', () => {
  test.each([40, 0, 32, -1, 'x', 1.5])('POST rejects due_day %p', async dueDay => {
    const { app } = setup();
    await expectRejected(app, await cookieFor(app), 'post', '/api/debts', { name: 'Card', due_day: dueDay }, /due_day/);
  });

  test('PUT rejects due_day 40', async () => {
    const { app, db } = setup();
    db.prepare('INSERT INTO debts (name) VALUES (?)').run('Card');
    await expectRejected(app, await cookieFor(app), 'put', '/api/debts/1', { name: 'Card', balance: 1, apr: 1, credit_limit: 1, minimum_payment: 1, due_day: 40 }, /due_day/);
  });

  test('POST accepts the first and last day, a numeric string, and no due day', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    for (const [dueDay, stored] of [[1, 1], [31, 31], ['15', 15], [null, null], ['', null], [undefined, null]]) {
      const res = await request(app).post('/api/debts').set('Cookie', cookie).send({ name: 'Card', due_day: dueDay });
      expect(res.status).toBe(201);
      expect(res.body.due_day).toBe(stored);
    }
  });

  test('POST rejects a missing account and non-numeric amounts', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    await expectRejected(app, cookie, 'post', '/api/debts', { name: 'Card', account_id: 99999 }, /account/);
    await expectRejected(app, cookie, 'post', '/api/debts', { name: 'Card', balance: 'much' }, /balance/);
    await expectRejected(app, cookie, 'post', '/api/debts', { name: '' }, /name/);
  });
});

describe('transactions', () => {
  const valid = { date: '2026-05-10', amount: -5, description: 'Coffee' };

  test('POST rejects a category that does not exist', async () => {
    const { app, db } = setup();
    await expectRejected(app, await cookieFor(app), 'post', '/api/transactions', { ...valid, category_id: 99999 }, /category/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n).toBe(0);
  });

  test('POST rejects an account that does not exist and malformed ids', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    await expectRejected(app, cookie, 'post', '/api/transactions', { ...valid, account_id: 99999 }, /account/);
    await expectRejected(app, cookie, 'post', '/api/transactions', { ...valid, category_id: 'abc' }, /category/);
    await expectRejected(app, cookie, 'post', '/api/transactions', { ...valid, category_id: -3 }, /category/);
  });

  test('POST and PUT accept ids sent as strings, as the form does', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    const created = await request(app).post('/api/transactions').set('Cookie', cookie)
      .send({ ...valid, category_id: '1', account_id: '1' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ category_id: 1, account_id: 1 });
    const updated = await request(app).put(`/api/transactions/${created.body.id}`).set('Cookie', cookie)
      .send({ ...valid, description: 'Tea', category_id: '', account_id: null });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ description: 'Tea', category_id: null, account_id: null });
  });

  test('PUT rejects a missing description and a category that does not exist', async () => {
    const { app, db } = setup();
    db.prepare("INSERT INTO transactions (date,amount,description,source) VALUES ('2026-05-01',-1,'x','manual')").run();
    const cookie = await cookieFor(app);
    await expectRejected(app, cookie, 'put', '/api/transactions/1', { date: '2026-05-10', amount: -5 }, /required/);
    await expectRejected(app, cookie, 'put', '/api/transactions/1', { ...valid, category_id: 99999 }, /category/);
  });

  test('POST rejects an object where a value belongs', async () => {
    const { app } = setup();
    await expectRejected(app, await cookieFor(app), 'post', '/api/transactions', { ...valid, amount: {} });
  });

  test.each(['abc', '0', '-5', '1.5', ''])('GET rejects limit=%p', async limit => {
    const { app } = setup();
    const res = await request(app).get('/api/transactions').query({ limit }).set('Cookie', await cookieFor(app));
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.text).not.toMatch(LEAK);
  });

  test.each(['abc', '1.5', ''])('GET rejects offset=%p', async offset => {
    const { app } = setup();
    const res = await request(app).get('/api/transactions').query({ offset }).set('Cookie', await cookieFor(app));
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(LEAK);
  });

  test('GET rejects a limit repeated in the query', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/transactions?limit=5&limit=6').set('Cookie', await cookieFor(app));
    expect(res.status).toBe(400);
  });

  test('GET keeps accepting a large limit (capped at 200) and a negative offset (read as 0)', async () => {
    const { app, db } = setup();
    for (let i = 0; i < 205; i++) {
      db.prepare("INSERT INTO transactions (date,amount,description,source) VALUES ('2026-05-01',-1,'x','manual')").run();
    }
    const cookie = await cookieFor(app);
    const big = await request(app).get('/api/transactions?limit=1000').set('Cookie', cookie);
    expect(big.status).toBe(200);
    expect(big.body.transactions).toHaveLength(200);
    expect(big.body.hasMore).toBe(true);
    const negative = await request(app).get('/api/transactions?limit=2&offset=-4').set('Cookie', cookie);
    expect(negative.status).toBe(200);
    expect(negative.body.transactions).toHaveLength(2);
  });
});

describe('investments', () => {
  const valid = { ticker: 'qqq', shares: 5, purchase_price: 100, purchase_date: '2026-01-02' };

  test('PUT without a ticker is a 400, not a crash', async () => {
    const { app, db } = setup();
    db.prepare("INSERT INTO stock_holdings (ticker,shares,purchase_price,purchase_date) VALUES ('AAA',1,1,'2026-01-01')").run();
    const withoutTicker = { ...valid };
    delete withoutTicker.ticker;
    await expectRejected(app, await cookieFor(app), 'put', '/api/investments/1', withoutTicker, /ticker/);
    expect(db.prepare('SELECT ticker FROM stock_holdings').get().ticker).toBe('AAA');
  });

  test('POST and PUT reject a ticker that is not text, bad numbers and bad dates', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    await expectRejected(app, cookie, 'post', '/api/investments', { ...valid, ticker: 5 }, /ticker/);
    await expectRejected(app, cookie, 'post', '/api/investments', { ...valid, shares: 'many' }, /numbers/);
    await expectRejected(app, cookie, 'post', '/api/investments', { ...valid, purchase_date: 'yesterday' }, /purchase_date/);
    await expectRejected(app, cookie, 'put', '/api/investments/1', { ...valid, purchase_price: {} }, /numbers/);
  });

  test('POST still upper-cases the ticker and reads numeric strings', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/investments').set('Cookie', await cookieFor(app))
      .send({ ...valid, ticker: ' qqq ', shares: '5', purchase_price: '100.5' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ticker: 'QQQ', shares: 5, purchase_price: 100.5 });
  });
});

describe('other routes', () => {
  test('budget trends rejects category_ids given more than once', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/budget/trends?category_ids[]=1&category_ids[]=2').set('Cookie', await cookieFor(app));
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(LEAK);
  });

  test('import confirm and suggest reject malformed bodies', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    await expectRejected(app, cookie, 'post', '/api/import/confirm', { rows: 5, mapping: {} }, /rows/);
    await expectRejected(app, cookie, 'post', '/api/import/confirm', { rows: [], mapping: 'x' }, /mapping/);
    const odd = await request(app).post('/api/import/confirm').set('Cookie', cookie)
      .send({ rows: [null, 5, { d: '2026-05-01', a: '-3', n: 'Tea' }], mapping: { date: 'd', amount: 'a', description: 'n' } });
    expect(odd.status).toBe(200);
    expect(odd.body.inserted).toBe(1);
    const suggest = await request(app).post('/api/import/suggest').set('Cookie', cookie).send({ descriptions: [5, {}, 'Tea'] });
    expect(suggest.status).toBe(200);
  });

  test('password change and login reject values that are not text', async () => {
    const { app } = setup();
    const cookie = await cookieFor(app);
    await expectRejected(app, cookie, 'put', '/api/auth/password', { currentPassword: 5, newPassword: {} });
    const login = await request(app).post('/api/auth/login').send({ username: { $ne: '' }, password: ['x'] });
    expect(login.status).toBe(400);
    expect(login.text).not.toMatch(LEAK);
  });
});
