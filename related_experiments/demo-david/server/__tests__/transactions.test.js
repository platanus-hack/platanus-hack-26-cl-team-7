const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestApp } = require('./helpers');

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/api/auth',         require('../routes/authRoutes')(db));
    app.use('/api/transactions', require('../routes/transactionRoutes')(db));
  });
  const hash = bcrypt.hashSync('pass', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run('admin', hash);
  db.prepare('INSERT INTO categories (name, type, default_allocation, rollover) VALUES (?,?,?,?)').run('Food', 'expense', 200, 0);
  db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('Chequing', 'checking', 1000);
  return { app, db };
}

async function getAuthCookie(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pass' });
  return res.headers['set-cookie'][0];
}

describe('transactions', () => {
  test('POST creates a transaction', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    const acc = db.prepare('SELECT id FROM accounts').get();
    const res = await request(app)
      .post('/api/transactions')
      .set('Cookie', cookie)
      .send({ date: '2026-05-10', amount: -25.50, description: 'Burger King', category_id: cat.id, account_id: acc.id });
    expect(res.status).toBe(201);
    expect(res.body.description).toBe('Burger King');
  });

  test('GET filters by date range', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    db.prepare('INSERT INTO transactions (date,amount,description,category_id,source) VALUES (?,?,?,?,?)')
      .run('2026-05-10', -10, 'May tx', cat.id, 'manual');
    db.prepare('INSERT INTO transactions (date,amount,description,category_id,source) VALUES (?,?,?,?,?)')
      .run('2026-04-10', -10, 'Apr tx', cat.id, 'manual');
    const res = await request(app).get('/api/transactions?start=2026-05-01&end=2026-05-31').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.transactions.length).toBe(1);
    expect(res.body.transactions[0].description).toBe('May tx');
  });

  test('PUT updates a transaction', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    db.prepare('INSERT INTO transactions (date,amount,description,source) VALUES (?,?,?,?)')
      .run('2026-05-10', -10, 'Old', 'manual');
    const tx = db.prepare('SELECT id FROM transactions').get();
    const res = await request(app)
      .put(`/api/transactions/${tx.id}`)
      .set('Cookie', cookie)
      .send({ date: '2026-05-10', amount: -15, description: 'New', category_id: cat.id, is_recurring: true });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('New');
    expect(res.body.is_recurring).toBe(1);
  });

  test('DELETE removes a transaction', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO transactions (date,amount,description,source) VALUES (?,?,?,?)').run('2026-05-10', -10, 'tx', 'manual');
    const tx = db.prepare('SELECT id FROM transactions').get();
    const res = await request(app).delete(`/api/transactions/${tx.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
  });
});

describe('transaction splits', () => {
  test('GET /api/transactions includes has_splits=0 for unsplit transaction', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    db.prepare('INSERT INTO transactions (date,amount,description,category_id,source) VALUES (?,?,?,?,?)')
      .run('2026-05-10', -25, 'Lunch', cat.id, 'manual');
    const res = await request(app).get('/api/transactions?start=2026-05-01&end=2026-05-31').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.transactions[0].has_splits).toBe(0);
  });

  test('GET /api/transactions/:id/splits returns empty array when no splits', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO transactions (date,amount,description,source) VALUES (?,?,?,?)')
      .run('2026-05-10', -50, 'Test', 'manual');
    const tx = db.prepare('SELECT id FROM transactions').get();
    const res = await request(app).get(`/api/transactions/${tx.id}/splits`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('PUT /api/transactions/:id/splits saves splits and returns them', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    db.prepare('INSERT INTO transactions (date,amount,description,source) VALUES (?,?,?,?)')
      .run('2026-05-10', -100, 'Costco', 'manual');
    const tx = db.prepare('SELECT id FROM transactions').get();

    const res = await request(app)
      .put(`/api/transactions/${tx.id}/splits`)
      .set('Cookie', cookie)
      .send({ splits: [{ category_id: cat.id, amount: 60 }, { category_id: null, amount: 40 }] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].amount).toBe(60);
    expect(res.body[1].amount).toBe(40);
  });

  test('PUT /api/transactions/:id/splits with [] clears all splits', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    db.prepare('INSERT INTO transactions (date,amount,description,source) VALUES (?,?,?,?)')
      .run('2026-05-10', -100, 'Costco', 'manual');
    const tx = db.prepare('SELECT id FROM transactions').get();
    db.prepare('INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?,?,?)')
      .run(tx.id, cat.id, 100);

    const res = await request(app)
      .put(`/api/transactions/${tx.id}/splits`)
      .set('Cookie', cookie)
      .send({ splits: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(db.prepare('SELECT * FROM transaction_splits WHERE transaction_id=?').all(tx.id)).toHaveLength(0);
  });

  test('PUT /api/transactions/:id/splits returns 400 when amounts do not sum to total', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    db.prepare('INSERT INTO transactions (date,amount,description,source) VALUES (?,?,?,?)')
      .run('2026-05-10', -100, 'Costco', 'manual');
    const tx = db.prepare('SELECT id FROM transactions').get();

    const res = await request(app)
      .put(`/api/transactions/${tx.id}/splits`)
      .set('Cookie', cookie)
      .send({ splits: [{ category_id: cat.id, amount: 60 }] }); // 60 ≠ 100

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sum/i);
  });

  test('GET /api/transactions/:id/splits returns 404 for non-existent transaction', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app).get('/api/transactions/99999/splits').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  test('PUT /api/transactions/:id/splits requires auth', async () => {
    const { app, db } = setup();
    db.prepare('INSERT INTO transactions (date,amount,description,source) VALUES (?,?,?,?)')
      .run('2026-05-10', -100, 'tx', 'manual');
    const tx = db.prepare('SELECT id FROM transactions').get();
    const res = await request(app)
      .put(`/api/transactions/${tx.id}/splits`)
      .send({ splits: [] });
    expect(res.status).toBe(401);
  });
});
