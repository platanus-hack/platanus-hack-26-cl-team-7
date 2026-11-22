const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestApp } = require('./helpers');

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/api/auth',  require('../routes/authRoutes')(db));
    app.use('/api/debts', require('../routes/debtRoutes')(db));
  });
  const hash = bcrypt.hashSync('pass', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run('admin', hash);
  db.prepare('INSERT INTO debts (name,balance,apr,credit_limit,minimum_payment) VALUES (?,?,?,?,?)')
    .run('Visa', 10933.48, 21.99, 12000, 224);
  return { app, db };
}

async function getAuthCookie(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pass' });
  return res.headers['set-cookie'][0];
}

describe('debts CRUD', () => {
  test('GET returns all debts', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app).get('/api/debts').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Visa');
  });

  test('POST creates a debt', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post('/api/debts')
      .set('Cookie', cookie)
      .send({ name: 'Mastercard', balance: 2000, apr: 19.99, credit_limit: 5000, minimum_payment: 50 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Mastercard');
  });

  test('PUT updates a debt', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const debt = db.prepare('SELECT id FROM debts').get();
    const res = await request(app)
      .put(`/api/debts/${debt.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Visa', balance: 10000, apr: 21.99, credit_limit: 12000, minimum_payment: 224 });
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(10000);
  });

  test('DELETE removes a debt', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const debt = db.prepare('SELECT id FROM debts').get();
    const res = await request(app).delete(`/api/debts/${debt.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT * FROM debts WHERE id=?').get(debt.id)).toBeUndefined();
  });

  test('PUT returns 404 for missing debt', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .put('/api/debts/99999')
      .set('Cookie', cookie)
      .send({ name: 'X', balance: 0, apr: 0, credit_limit: 0, minimum_payment: 0 });
    expect(res.status).toBe(404);
  });
});

describe('debt projection', () => {
  test('GET /api/debts/projection returns months until payoff', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get('/api/debts/projection?extraPayment=200&method=avalanche')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.months.length).toBeGreaterThan(0);
    expect(res.body.totalInterest).toBeGreaterThan(0);
    expect(res.body.payoffDate).toMatch(/^\d{4}-\d{2}$/);
    // With $224 min + $200 extra on $10933 at 21.99%, payoff should be under 10 years
    expect(res.body.months.length).toBeLessThan(120);
  });

  test('snowball method also works', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .get('/api/debts/projection?extraPayment=0&method=snowball')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.months.length).toBeGreaterThan(0);
  });

  test('projection with no debts returns empty', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('DELETE FROM debts').run();
    const res = await request(app)
      .get('/api/debts/projection?extraPayment=0&method=avalanche')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.months).toEqual([]);
    expect(res.body.totalInterest).toBe(0);
    expect(res.body.payoffDate).toBeNull();
  });
});
