const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestApp } = require('./helpers');

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/api/auth',       require('../routes/authRoutes')(db));
    app.use('/api/categories', require('../routes/categoryRoutes')(db));
  });
  const hash = bcrypt.hashSync('pass', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run('admin', hash);
  return { app, db };
}

async function getAuthCookie(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pass' });
  return res.headers['set-cookie'][0];
}

describe('categories CRUD', () => {
  test('POST creates a category', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post('/api/categories')
      .set('Cookie', cookie)
      .send({ name: 'Groceries', type: 'expense', default_allocation: 400, rollover: false });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Groceries');
  });

  test('GET returns all categories', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO categories (name, type, default_allocation, rollover) VALUES (?,?,?,?)').run('Rent', 'expense', 1500, 0);
    const res = await request(app).get('/api/categories').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
