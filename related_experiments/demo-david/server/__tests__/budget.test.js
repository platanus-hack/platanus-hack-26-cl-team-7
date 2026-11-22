const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestApp } = require('./helpers');

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/api/auth',   require('../routes/authRoutes')(db));
    app.use('/api/budget', require('../routes/budgetRoutes')(db));
  });
  const hash = bcrypt.hashSync('pass', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run('admin', hash);
  db.prepare('INSERT INTO categories (name, type, default_allocation, rollover) VALUES (?,?,?,?)').run('Groceries', 'expense', 400, 0);
  db.prepare('INSERT INTO categories (name, type, default_allocation, rollover) VALUES (?,?,?,?)').run('Savings', 'expense', 100, 1);
  return { app, db };
}

async function getAuthCookie(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pass' });
  return res.headers['set-cookie'][0];
}

describe('budget months', () => {
  test('GET /api/budget/2026/5 auto-creates rows from defaults', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app).get('/api/budget/2026/5').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.find(r => r.name === 'Groceries').allocated).toBe(400);
  });

  test('PUT /api/budget/2026/5/:categoryId updates allocation', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);
    const cat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();
    const res = await request(app)
      .put(`/api/budget/2026/5/${cat.id}`)
      .set('Cookie', cookie)
      .send({ allocated: 500 });
    expect(res.status).toBe(200);
    expect(res.body.allocated).toBe(500);
  });

  test('PUT /api/budget returns 404 for non-existent row', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .put('/api/budget/2026/5/99999')
      .set('Cookie', cookie)
      .send({ allocated: 100 });
    expect(res.status).toBe(404);
  });

  test('POST /api/budget/rollover creates next month with rollovers applied', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);
    db.prepare('INSERT INTO transactions (date, amount, description, category_id, source) VALUES (?,?,?,?,?)')
      .run('2026-05-10', -100, 'test', db.prepare("SELECT id FROM categories WHERE name='Groceries'").get().id, 'manual');
    const res = await request(app)
      .post('/api/budget/rollover')
      .set('Cookie', cookie)
      .send({ fromYear: 2026, fromMonth: 5, toYear: 2026, toMonth: 6 });
    expect(res.status).toBe(200);
    const savingsCat = db.prepare("SELECT id FROM categories WHERE name='Savings'").get();
    const nextMonth = db.prepare('SELECT * FROM budget_months WHERE year=2026 AND month=6 AND category_id=?').get(savingsCat.id);
    expect(nextMonth.rolled_over).toBe(100);
    // Groceries (rollover=0) should NOT carry over
    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();
    const groceriesNextMonth = db.prepare('SELECT * FROM budget_months WHERE year=2026 AND month=6 AND category_id=?').get(groceriesCat.id);
    expect(groceriesNextMonth.rolled_over).toBe(0);
  });

  test('POST /api/budget/copy overwrites target month allocations', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);

    // Create source month rows by loading it
    await request(app).get('/api/budget/2026/4').set('Cookie', cookie);

    // Customise Groceries allocation in the source month
    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();
    db.prepare('UPDATE budget_months SET allocated=600 WHERE year=2026 AND month=4 AND category_id=?')
      .run(groceriesCat.id);

    // Create target month rows
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);

    const res = await request(app)
      .post('/api/budget/copy')
      .set('Cookie', cookie)
      .send({ fromYear: 2026, fromMonth: 4, toYear: 2026, toMonth: 5 });

    expect(res.status).toBe(200);
    // Two categories inserted by setup() — both should be updated
    expect(res.body.updated).toBe(2);

    const row = db.prepare(
      'SELECT allocated FROM budget_months WHERE year=2026 AND month=5 AND category_id=?'
    ).get(groceriesCat.id);
    expect(row.allocated).toBe(600);

    // Savings should still have its default allocation (100) copied from April
    const savingsCat = db.prepare("SELECT id FROM categories WHERE name='Savings'").get();
    const savingsRow = db.prepare(
      'SELECT allocated FROM budget_months WHERE year=2026 AND month=5 AND category_id=?'
    ).get(savingsCat.id);
    expect(savingsRow.allocated).toBe(100);
  });

  test('POST /api/budget/copy returns updated:0 when source month has no rows', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);

    // Load target month but NOT source month (so source has no rows)
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);

    const res = await request(app)
      .post('/api/budget/copy')
      .set('Cookie', cookie)
      .send({ fromYear: 2025, fromMonth: 1, toYear: 2026, toMonth: 5 });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
  });

  test('POST /api/budget/copy returns 400 when params missing', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post('/api/budget/copy')
      .set('Cookie', cookie)
      .send({ fromYear: 2026 }); // missing fromMonth, toYear, toMonth
    expect(res.status).toBe(400);
  });

  test('POST /api/budget/copy requires auth', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/budget/copy')
      .send({ fromYear: 2026, fromMonth: 4, toYear: 2026, toMonth: 5 });
    expect(res.status).toBe(401);
  });
});

describe('budget transfer', () => {
  test('POST /api/budget/transfer moves allocation between envelopes', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);

    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();
    const savingsCat   = db.prepare("SELECT id FROM categories WHERE name='Savings'").get();

    const res = await request(app)
      .post('/api/budget/transfer')
      .set('Cookie', cookie)
      .send({ year: 2026, month: 5, fromCategoryId: groceriesCat.id, toCategoryId: savingsCat.id, amount: 100 });

    expect(res.status).toBe(200);
    expect(res.body.from.allocated).toBe(300); // 400 - 100
    expect(res.body.to.allocated).toBe(200);   // 100 + 100
  });

  test('POST /api/budget/transfer returns 400 when amount exceeds allocated', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);

    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();
    const savingsCat   = db.prepare("SELECT id FROM categories WHERE name='Savings'").get();

    const res = await request(app)
      .post('/api/budget/transfer')
      .set('Cookie', cookie)
      .send({ year: 2026, month: 5, fromCategoryId: groceriesCat.id, toCategoryId: savingsCat.id, amount: 500 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient/i);
  });

  test('POST /api/budget/transfer returns 400 when from === to', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);

    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();

    const res = await request(app)
      .post('/api/budget/transfer')
      .set('Cookie', cookie)
      .send({ year: 2026, month: 5, fromCategoryId: groceriesCat.id, toCategoryId: groceriesCat.id, amount: 50 });

    expect(res.status).toBe(400);
  });

  test('POST /api/budget/transfer returns 400 when amount is 0', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);

    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();
    const savingsCat   = db.prepare("SELECT id FROM categories WHERE name='Savings'").get();

    const res = await request(app)
      .post('/api/budget/transfer')
      .set('Cookie', cookie)
      .send({ year: 2026, month: 5, fromCategoryId: groceriesCat.id, toCategoryId: savingsCat.id, amount: 0 });

    expect(res.status).toBe(400);
  });

  test('POST /api/budget/transfer requires auth', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/budget/transfer')
      .send({ year: 2026, month: 5, fromCategoryId: 1, toCategoryId: 2, amount: 50 });
    expect(res.status).toBe(401);
  });

  test('POST /api/budget/transfer returns 400 when destination envelope not found', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    // Only seed the source month for Groceries, not the destination category
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);
    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();

    const res = await request(app)
      .post('/api/budget/transfer')
      .set('Cookie', cookie)
      .send({ year: 2026, month: 5, fromCategoryId: groceriesCat.id, toCategoryId: 9999, amount: 50 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/destination/i);
  });
});

describe('budget trends', () => {
  test('GET /api/budget/trends returns labels and series for requested categories', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);

    // Seed a transaction so spending is non-zero in current month
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    await request(app).get(`/api/budget/${year}/${month}`).set('Cookie', cookie);
    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();
    db.prepare("INSERT INTO transactions (date, amount, description, category_id, source) VALUES (?,?,?,?,?)")
      .run(`${year}-${String(month).padStart(2, '0')}-10`, -150, 'Superstore', groceriesCat.id, 'manual');

    const res = await request(app)
      .get(`/api/budget/trends?months=3&category_ids=${groceriesCat.id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.labels).toHaveLength(3);
    expect(res.body.series).toHaveLength(1);
    expect(res.body.series[0].id).toBe(groceriesCat.id);
    expect(res.body.series[0].name).toBe('Groceries');
    expect(res.body.series[0].data).toHaveLength(3);
    // Last entry is current month — should reflect the $150 transaction
    const lastVal = res.body.series[0].data[2];
    expect(lastVal).toBeCloseTo(150, 1);
  });

  test('GET /api/budget/trends returns empty when no category_ids provided', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get('/api/budget/trends')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ labels: [], series: [] });
  });

  test('GET /api/budget/trends returns multiple series', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();
    const savingsCat   = db.prepare("SELECT id FROM categories WHERE name='Savings'").get();

    const res = await request(app)
      .get(`/api/budget/trends?months=2&category_ids=${groceriesCat.id},${savingsCat.id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(2);
  });

  test('GET /api/budget/trends requires auth', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/budget/trends?category_ids=1');
    expect(res.status).toBe(401);
  });
});

describe('budget with splits', () => {
  test('GET /api/budget/:year/:month counts split amounts per envelope, not the original category', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);

    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();
    const savingsCat   = db.prepare("SELECT id FROM categories WHERE name='Savings'").get();

    // Transaction assigned to Groceries, but split: $100 to Groceries, $50 to Savings
    const { lastInsertRowid: txId } = db.prepare(
      'INSERT INTO transactions (date, amount, description, category_id, source) VALUES (?,?,?,?,?)'
    ).run('2026-05-10', -150, 'Costco', groceriesCat.id, 'manual');
    db.prepare('INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?,?,?)').run(txId, groceriesCat.id, 100);
    db.prepare('INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?,?,?)').run(txId, savingsCat.id, 50);

    const res = await request(app).get('/api/budget/2026/5').set('Cookie', cookie);
    expect(res.status).toBe(200);

    const groceries = res.body.find(r => r.name === 'Groceries');
    const savings   = res.body.find(r => r.name === 'Savings');

    // Original $-150 is excluded; split amounts are signed by parent (tx.amount < 0, so negated)
    expect(groceries.spent).toBeCloseTo(-100, 1);
    expect(savings.spent).toBeCloseTo(-50, 1);
  });

  test('GET /api/budget/:year/:month still counts non-split transactions normally', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    await request(app).get('/api/budget/2026/5').set('Cookie', cookie);

    const groceriesCat = db.prepare("SELECT id FROM categories WHERE name='Groceries'").get();
    db.prepare('INSERT INTO transactions (date, amount, description, category_id, source) VALUES (?,?,?,?,?)')
      .run('2026-05-10', -75, 'Superstore', groceriesCat.id, 'manual');

    const res = await request(app).get('/api/budget/2026/5').set('Cookie', cookie);
    const groceries = res.body.find(r => r.name === 'Groceries');
    expect(groceries.spent).toBeCloseTo(-75, 1);
  });
});
