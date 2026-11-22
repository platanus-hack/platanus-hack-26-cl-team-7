const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestApp } = require('./helpers');

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/api/auth', require('../routes/authRoutes')(db));
  });
  const hash = bcrypt.hashSync('password123', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run('admin', hash);
  return { app, db };
}

describe('POST /api/auth/login', () => {
  test('returns 200 and sets cookie on valid credentials', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('returns 401 on wrong password', async () => {
    const { app } = setup();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  test('returns 401 without cookie', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns user when authenticated', async () => {
    const { app } = setup();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    const cookie = loginRes.headers['set-cookie'][0];
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('admin');
    expect(res.body.password_hash).toBeUndefined();
  });
});

describe('PUT /api/auth/password', () => {
  test('changes password with correct current password', async () => {
    const { app } = setup();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    const cookie = loginRes.headers['set-cookie'][0];
    const res = await request(app)
      .put('/api/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'password123', newPassword: 'newpass456' });
    expect(res.status).toBe(200);
  });

  test('rejects wrong current password', async () => {
    const { app } = setup();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    const cookie = loginRes.headers['set-cookie'][0];
    const res = await request(app)
      .put('/api/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'wrong', newPassword: 'newpass456' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/signup', () => {
  const signup = (app, body) => request(app).post('/api/auth/signup').send(body);

  test('creates the account, signs the new user in and stores only a password hash', async () => {
    const { app, db } = setup();
    const res = await signup(app, { username: 'new.user', password: 'a-long-password' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/budget_token=.+HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('new.user');

    const stored = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('new.user');
    expect(stored.password_hash).not.toContain('a-long-password');
    expect(stored.password_hash).toMatch(/^\$2[aby]\$/);
  });

  test('the new password works at the login endpoint and a wrong one does not', async () => {
    const { app } = setup();
    await signup(app, { username: 'newcomer', password: 'a-long-password' });
    const ok = await request(app).post('/api/auth/login').send({ username: 'newcomer', password: 'a-long-password' });
    expect(ok.status).toBe(200);
    const bad = await request(app).post('/api/auth/login').send({ username: 'newcomer', password: 'another-password' });
    expect(bad.status).toBe(401);
  });

  test('trims the username', async () => {
    const { app, db } = setup();
    const res = await signup(app, { username: '  spaced  ', password: 'a-long-password' });
    expect(res.status).toBe(201);
    expect(db.prepare('SELECT 1 FROM users WHERE username = ?').get('spaced')).toBeTruthy();
  });

  test('a taken username answers 409, whatever the letter case, and adds no row', async () => {
    const { app, db } = setup();
    for (const username of ['admin', 'ADMIN', 'Admin']) {
      const res = await signup(app, { username, password: 'a-long-password' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Username already taken' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(1);
  });

  test('does not touch the existing user or let the new one in with their password', async () => {
    const { app } = setup();
    await signup(app, { username: 'admin', password: 'a-long-password' });
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'a-long-password' });
    expect(login.status).toBe(401);
  });

  test.each([
    ['missing username', { password: 'a-long-password' }, /required/],
    ['missing password', { username: 'someone' }, /required/],
    ['blank username', { username: '   ', password: 'a-long-password' }, /required/],
    ['username that is not text', { username: { a: 1 }, password: 'a-long-password' }, /required/],
    ['password that is not text', { username: 'someone', password: 12345678 }, /required/],
    ['username too short', { username: 'ab', password: 'a-long-password' }, /3 to 32/],
    ['username too long', { username: 'x'.repeat(33), password: 'a-long-password' }, /3 to 32/],
    ['username with spaces inside', { username: 'two words', password: 'a-long-password' }, /3 to 32/],
    ['username with markup', { username: '<b>bold</b>', password: 'a-long-password' }, /3 to 32/],
    ['password shorter than 8', { username: 'someone', password: 'short' }, /at least 8/],
    ['password over bcrypt\'s 72 bytes', { username: 'someone', password: 'p'.repeat(73) }, /too long/],
  ])('rejects %s with 400 and creates nothing', async (_label, body, message) => {
    const { app, db } = setup();
    const res = await signup(app, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(1);
  });

  test('accepts a password of exactly 8 characters and one of exactly 72 bytes', async () => {
    const { app } = setup();
    expect((await signup(app, { username: 'eight', password: '12345678' })).status).toBe(201);
    expect((await signup(app, { username: 'longest', password: 'p'.repeat(72) })).status).toBe(201);
  });

  test('malformed JSON gets a JSON 400', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/auth/signup').set('Content-Type', 'application/json').send('{"username":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid request' });
  });
});

describe('POST /api/auth/login with values that are not text', () => {
  test('answers 400 instead of failing inside bcrypt', async () => {
    const { app } = setup();
    for (const body of [{ username: 'admin', password: 12345678 }, { username: { $ne: '' }, password: 'x' }, { username: 'admin', password: ['password123'] }]) {
      const res = await request(app).post('/api/auth/login').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Username and password required' });
    }
  });
});
