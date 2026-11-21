const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestApp } = require('./helpers');

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/api/auth',       require('../routes/authRoutes')(db));
    app.use('/api/categories', require('../routes/categoryRoutes')(db));
    app.use('/api/rules',      require('../routes/rulesRoutes')(db));
  });
  const hash = bcrypt.hashSync('pass', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run('admin', hash);
  db.prepare('INSERT INTO categories (name, type, default_allocation, rollover) VALUES (?,?,?,?)').run('Cloud', 'expense', 0, 0);
  return { app, db };
}

async function getAuthCookie(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pass' });
  return res.headers['set-cookie'][0];
}

describe('categorization rules', () => {
  test('GET /api/rules returns empty array initially', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app).get('/api/rules').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('POST /api/rules creates a rule with category_name', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    const res = await request(app)
      .post('/api/rules')
      .set('Cookie', cookie)
      .send({ keyword: 'RUNPOD', category_id: cat.id });
    expect(res.status).toBe(201);
    expect(res.body.keyword).toBe('RUNPOD');
    expect(res.body.category_name).toBe('Cloud');
    expect(res.body.id).toBeDefined();
  });

  test('POST /api/rules returns 400 for empty keyword', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    const res = await request(app)
      .post('/api/rules')
      .set('Cookie', cookie)
      .send({ keyword: '   ', category_id: cat.id });
    expect(res.status).toBe(400);
  });

  test('POST /api/rules returns 400 for missing category_id', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post('/api/rules')
      .set('Cookie', cookie)
      .send({ keyword: 'TEST' });
    expect(res.status).toBe(400);
  });

  test('POST /api/rules returns 400 for non-existent category_id', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post('/api/rules')
      .set('Cookie', cookie)
      .send({ keyword: 'TEST', category_id: 9999 });
    expect(res.status).toBe(400);
  });

  test('DELETE /api/rules/:id removes the rule', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    db.prepare('INSERT INTO categorization_rules (keyword, category_id) VALUES (?,?)').run('RUNPOD', cat.id);
    const rule = db.prepare('SELECT id FROM categorization_rules').get();
    const res = await request(app)
      .delete(`/api/rules/${rule.id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(db.prepare('SELECT * FROM categorization_rules WHERE id=?').get(rule.id)).toBeUndefined();
  });

  test('DELETE /api/rules/:id returns 404 for unknown id', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app).delete('/api/rules/999').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  test('GET /api/rules requires auth', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/rules');
    expect(res.status).toBe(401);
  });
});
