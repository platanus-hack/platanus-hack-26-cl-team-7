const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestApp } = require('./helpers');

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/api/auth',    require('../routes/authRoutes')(db));
    app.use('/api/goals',   require('../routes/goalRoutes')(db));
  });
  const hash = bcrypt.hashSync('pass', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run('admin', hash);
  db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('TFSA', 'savings', 4200);
  return { app, db };
}

async function getAuthCookie(app) {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pass' });
  return res.headers['set-cookie'][0];
}

describe('goals CRUD', () => {
  test('POST creates a goal', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post('/api/goals')
      .set('Cookie', cookie)
      .send({ name: 'Emergency Fund', target_amount: 5000 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Emergency Fund');
    expect(res.body.target_amount).toBe(5000);
  });

  test('POST returns 400 when name is missing', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post('/api/goals').set('Cookie', cookie)
      .send({ target_amount: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  test('POST returns 400 when target_amount is not positive', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .post('/api/goals').set('Cookie', cookie)
      .send({ name: 'Test', target_amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/target_amount/i);
  });

  test('GET returns goals with account_name and account_balance', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const acc = db.prepare('SELECT id FROM accounts').get();
    db.prepare('INSERT INTO savings_goals (name, account_id, target_amount) VALUES (?,?,?)').run('Vacation', acc.id, 3000);
    const res = await request(app).get('/api/goals').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body[0].account_name).toBe('TFSA');
    expect(res.body[0].account_balance).toBe(4200);
  });

  test('GET computes avg_monthly_net from last 6 months of transactions', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const acc = db.prepare('SELECT id FROM accounts').get();
    db.prepare('INSERT INTO savings_goals (name, account_id, target_amount) VALUES (?,?,?)').run('Emergency', acc.id, 5000);
    const today = new Date();
    for (let i = 1; i <= 3; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 15);
      db.prepare('INSERT INTO transactions (date, amount, description, account_id, source) VALUES (?,?,?,?,?)')
        .run(d.toISOString().slice(0, 10), 400, 'Deposit', acc.id, 'manual');
    }
    const res = await request(app).get('/api/goals').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body[0].avg_monthly_net).toBeCloseTo(200, 0);
  });

  test('GET returns avg_monthly_net = 0 when no transactions', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const acc = db.prepare('SELECT id FROM accounts').get();
    db.prepare('INSERT INTO savings_goals (name, account_id, target_amount) VALUES (?,?,?)').run('Fund', acc.id, 5000);
    const res = await request(app).get('/api/goals').set('Cookie', cookie);
    expect(res.body[0].avg_monthly_net).toBe(0);
  });

  test('PUT updates a goal', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO savings_goals (name, target_amount) VALUES (?,?)').run('Old', 1000);
    const goal = db.prepare('SELECT id FROM savings_goals').get();
    const res = await request(app)
      .put(`/api/goals/${goal.id}`)
      .set('Cookie', cookie)
      .send({ name: 'New', target_amount: 2000, target_date: '2027-01-01', account_id: null });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body.target_amount).toBe(2000);
  });

  test('PUT returns 404 for missing goal', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const res = await request(app)
      .put('/api/goals/99999')
      .set('Cookie', cookie)
      .send({ name: 'X', target_amount: 100 });
    expect(res.status).toBe(404);
  });

  test('PUT /complete marks goal as complete', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO savings_goals (name, target_amount) VALUES (?,?)').run('Fund', 1000);
    const goal = db.prepare('SELECT id FROM savings_goals').get();
    const res = await request(app).put(`/api/goals/${goal.id}/complete`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.completed_at).not.toBeNull();
  });

  test('PUT /complete a second time unmarks the goal', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO savings_goals (name, target_amount, completed_at) VALUES (?,?,?)').run('Fund', 1000, '2026-05-01');
    const goal = db.prepare('SELECT id FROM savings_goals').get();
    const res = await request(app).put(`/api/goals/${goal.id}/complete`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.completed_at).toBeNull();
  });

  test('DELETE removes a goal', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO savings_goals (name, target_amount) VALUES (?,?)').run('Fund', 1000);
    const goal = db.prepare('SELECT id FROM savings_goals').get();
    const res = await request(app).delete(`/api/goals/${goal.id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT * FROM savings_goals WHERE id=?').get(goal.id)).toBeUndefined();
  });

  test('GET /goals requires auth', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/goals');
    expect(res.status).toBe(401);
  });

  test('GET computes projected_date when avg_monthly_net is positive', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const acc = db.prepare('SELECT id FROM accounts').get();
    // account balance is 4200, 3 deposits of 400 = 1200 total → 5400 derived balance
    // target is 6000 (needs 600 more), avg 200/mo → needs ~3 months
    db.prepare('INSERT INTO savings_goals (name, account_id, target_amount) VALUES (?,?,?)').run('Emergency', acc.id, 6000);
    // 3 deposits of 400 = avg 200/mo
    const today = new Date();
    for (let i = 1; i <= 3; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 15);
      db.prepare('INSERT INTO transactions (date, amount, description, account_id, source) VALUES (?,?,?,?,?)')
        .run(d.toISOString().slice(0, 10), 400, 'Deposit', acc.id, 'manual');
    }
    const res = await request(app).get('/api/goals').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body[0].projected_date).not.toBeNull();
    expect(res.body[0].projected_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('GET returns projected_date = null when balance meets target', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const acc = db.prepare('SELECT id FROM accounts').get();
    // account balance is 4200, target is 3000 (already reached)
    db.prepare('INSERT INTO savings_goals (name, account_id, target_amount) VALUES (?,?,?)').run('Vacation', acc.id, 3000);
    const today = new Date();
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 15);
    db.prepare('INSERT INTO transactions (date, amount, description, account_id, source) VALUES (?,?,?,?,?)')
      .run(d.toISOString().slice(0, 10), 400, 'Deposit', acc.id, 'manual');
    const res = await request(app).get('/api/goals').set('Cookie', cookie);
    expect(res.body[0].projected_date).toBeNull();
  });

  test('GET goal with no account has account_name=null and avg_monthly_net=0', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO savings_goals (name, target_amount) VALUES (?,?)').run('No Account', 1000);
    const res = await request(app).get('/api/goals').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body[0].account_name).toBeNull();
    expect(res.body[0].avg_monthly_net).toBe(0);
    expect(res.body[0].projected_date).toBeNull();
  });

  test('GET /api/goals account_balance is 0 when goal has no linked account', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO savings_goals (name, account_id, target_amount) VALUES (?,?,?)').run('Vacation', null, 1000);
    const res = await request(app).get('/api/goals').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body[0].account_balance).toBe(0);
  });

  test('GET /api/goals account_balance reflects transaction history not static balance', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)').run('Savings', 'savings', 100);
    const acc = db.prepare('SELECT id FROM accounts WHERE name = ?').get('Savings');
    db.prepare("INSERT INTO transactions (date,amount,description,account_id,source) VALUES ('2026-01-01',500,'Deposit',?,?)").run(acc.id, 'manual');
    db.prepare('INSERT INTO savings_goals (name, account_id, target_amount) VALUES (?,?,?)').run('Emergency Fund', acc.id, 2000);
    const res = await request(app).get('/api/goals').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body[0].account_balance).toBeCloseTo(600);
  });
});
