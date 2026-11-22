const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestApp } = require('./helpers');

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/api/auth',     require('../routes/authRoutes')(db));
    app.use('/api/accounts', require('../routes/accountRoutes')(db));
  });
  const hash = bcrypt.hashSync('pass', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run('admin', hash);
  return { app, db };
}

async function getAuthCookie(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pass' });
  return res.headers['set-cookie'][0];
}

describe('accounts CRUD', () => {
  test('GET /api/accounts returns empty array initially', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app).get('/api/accounts').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('POST /api/accounts creates an account', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post('/api/accounts')
      .set('Cookie', cookie)
      .send({ name: 'Chequing', type: 'checking', balance: 500 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Chequing');
    expect(res.body.id).toBeDefined();
  });

  test('PUT /api/accounts/:id updates an account', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('Old', 'checking', 0);
    const account = db.prepare('SELECT * FROM accounts').get();
    const res = await request(app)
      .put(`/api/accounts/${account.id}`)
      .set('Cookie', cookie)
      .send({ name: 'New', type: 'savings', balance: 100 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
  });

  test('DELETE /api/accounts/:id removes an account', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('ToDelete', 'checking', 0);
    const account = db.prepare('SELECT * FROM accounts').get();
    const res = await request(app)
      .delete(`/api/accounts/${account.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT * FROM accounts WHERE id=?').get(account.id)).toBeUndefined();
  });

  test('GET /api/accounts includes current_balance matching starting balance when no transactions', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('Chequing', 'checking', 500);
    const res = await request(app).get('/api/accounts').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body[0].current_balance).toBe(500);
  });

  test('GET /api/accounts current_balance includes transaction sum', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('Chequing', 'checking', 500);
    const acc = db.prepare('SELECT id FROM accounts').get();
    db.prepare("INSERT INTO transactions (date,amount,description,account_id,source) VALUES ('2026-01-01',200,'Deposit',?,?)").run(acc.id, 'manual');
    db.prepare("INSERT INTO transactions (date,amount,description,account_id,source) VALUES ('2026-01-05',-50,'Coffee',?,?)").run(acc.id, 'manual');
    const res = await request(app).get('/api/accounts').set('Cookie', cookie);
    expect(res.body[0].current_balance).toBeCloseTo(650); // 500 + 200 - 50
  });
});

describe('accounts sync', () => {
  test('PUT /api/accounts/:id/sync sets starting balance so current_balance equals entered value', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('Chequing', 'checking', 0);
    const acc = db.prepare('SELECT id FROM accounts').get();
    db.prepare("INSERT INTO transactions (date,amount,description,account_id,source) VALUES ('2026-01-01',25.91,'Net',?,?)").run(acc.id, 'manual');
    const res = await request(app)
      .put(`/api/accounts/${acc.id}/sync`)
      .set('Cookie', cookie)
      .send({ current_balance: 71.94 });
    expect(res.status).toBe(200);
    expect(res.body.current_balance).toBeCloseTo(71.94);
    const stored = db.prepare('SELECT balance FROM accounts WHERE id=?').get(acc.id);
    expect(stored.balance).toBeCloseTo(46.03);
  });

  test('PUT /api/accounts/:id/sync with no transactions stores current_balance directly', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('Savings', 'savings', 0);
    const acc = db.prepare('SELECT id FROM accounts').get();
    const res = await request(app)
      .put(`/api/accounts/${acc.id}/sync`)
      .set('Cookie', cookie)
      .send({ current_balance: 1200 });
    expect(res.status).toBe(200);
    expect(res.body.current_balance).toBeCloseTo(1200);
  });

  test('PUT /api/accounts/:id/sync returns 400 for non-finite current_balance', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('A', 'checking', 0);
    const acc = db.prepare('SELECT id FROM accounts').get();
    const res = await request(app)
      .put(`/api/accounts/${acc.id}/sync`)
      .set('Cookie', cookie)
      .send({ current_balance: 'abc' });
    expect(res.status).toBe(400);
  });

  test('PUT /api/accounts/:id/sync returns 404 for unknown id', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .put('/api/accounts/999/sync')
      .set('Cookie', cookie)
      .send({ current_balance: 100 });
    expect(res.status).toBe(404);
  });

  test('PUT /api/accounts/:id/sync requires auth', async () => {
    const { app, db } = setup();
    db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('A', 'checking', 0);
    const acc = db.prepare('SELECT id FROM accounts').get();
    const res = await request(app)
      .put(`/api/accounts/${acc.id}/sync`)
      .send({ current_balance: 100 });
    expect(res.status).toBe(401);
  });
});
