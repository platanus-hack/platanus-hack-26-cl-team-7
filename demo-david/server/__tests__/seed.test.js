const request = require('supertest');
const { createTestApp } = require('./helpers');
const { seedRich, seedIfEmpty } = require('../seed-rich');

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

describe('mock data seed', () => {
  test('seedIfEmpty loads the mock data into an empty database', () => {
    const { db } = createTestApp(() => {});
    expect(seedIfEmpty(db)).toBe(true);
    expect(count(db, 'users')).toBe(1);
    expect(count(db, 'accounts')).toBeGreaterThan(0);
    expect(count(db, 'categories')).toBeGreaterThan(0);
    expect(count(db, 'transactions')).toBeGreaterThan(0);
  });

  test('seedIfEmpty leaves an existing database alone', () => {
    const { db } = createTestApp(() => {});
    seedIfEmpty(db);
    db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('Extra', 'checking', 1)").run();
    const before = count(db, 'accounts');
    expect(seedIfEmpty(db)).toBe(false);
    expect(count(db, 'accounts')).toBe(before);
  });

  test('seedRich is repeatable and ends in the same state', () => {
    const { db } = createTestApp(() => {});
    seedRich(db);
    const first = ['users', 'accounts', 'categories', 'transactions', 'budget_months']
      .map(t => count(db, t));
    seedRich(db);
    const second = ['users', 'accounts', 'categories', 'transactions', 'budget_months']
      .map(t => count(db, t));
    expect(second).toEqual(first);
    expect(db.prepare('SELECT MIN(id) AS id FROM users').get().id).toBe(1);
  });

  test('the documented test login works and returns mock data', async () => {
    const { app, db } = createTestApp((app, db) => {
      app.use('/api/auth', require('../routes/authRoutes')(db));
      app.use('/api/accounts', require('../routes/accountRoutes')(db));
    });
    seedIfEmpty(db);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'changeme' });
    expect(login.status).toBe(200);
    const res = await request(app)
      .get('/api/accounts')
      .set('Cookie', login.headers['set-cookie'][0]);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('the test login is stored as a bcrypt hash, never as plain text', () => {
    const { db } = createTestApp(() => {});
    seedIfEmpty(db);
    const user = db.prepare('SELECT username, password_hash FROM users').get();
    expect(user.username).toBe('admin');
    expect(user.password_hash).toMatch(/^\$2[aby]\$/);
    expect(user.password_hash).not.toContain('changeme');
  });

  test('transaction dates are the same in every time zone', () => {
    const originalTz = process.env.TZ;
    const ranges = [];
    try {
      for (const tz of ['Pacific/Auckland', 'UTC', 'America/Los_Angeles']) {
        process.env.TZ = tz;
        const { db } = createTestApp(() => {});
        seedRich(db);
        ranges.push(db.prepare('SELECT MIN(date) AS first, MAX(date) AS last FROM transactions').get());
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
    expect(ranges[0]).toEqual({ first: '2025-12-01', last: '2026-05-28' });
    expect(ranges[1]).toEqual(ranges[0]);
    expect(ranges[2]).toEqual(ranges[0]);
  });
});
