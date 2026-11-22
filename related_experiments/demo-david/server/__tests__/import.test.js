const request = require('supertest');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createTestApp } = require('./helpers');

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/api/auth',   require('../routes/authRoutes')(db));
    app.use('/api/import', require('../routes/importRoutes')(db));
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

function makeCsv(content) {
  const p = path.join(os.tmpdir(), `test-${Date.now()}.csv`);
  fs.writeFileSync(p, content);
  return p;
}

describe('CSV import', () => {
  test('POST /api/import/parse returns headers and preview rows', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const csvPath = makeCsv(
      'Date,Amount,Description\n2026-05-01,-25.00,Burger King\n2026-05-02,-10.00,Tim Hortons\n'
    );
    const res = await request(app)
      .post('/api/import/parse')
      .set('Cookie', cookie)
      .attach('file', csvPath);
    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual(['Date', 'Amount', 'Description']);
    expect(res.body.preview.length).toBe(2);
    fs.unlinkSync(csvPath);
  });

  test('POST /api/import/confirm inserts transactions skipping duplicates', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const acc = db.prepare('SELECT id FROM accounts').get();
    const cat = db.prepare('SELECT id FROM categories').get();
    const csvPath = makeCsv(
      'Date,Amount,Description\n2026-05-01,-25.00,Burger King\n2026-05-02,-10.00,Tim Hortons\n'
    );

    // First parse
    const parseRes = await request(app)
      .post('/api/import/parse')
      .set('Cookie', cookie)
      .attach('file', csvPath);
    const { rows } = parseRes.body;

    // Confirm with column mapping
    const confirmRes = await request(app)
      .post('/api/import/confirm')
      .set('Cookie', cookie)
      .send({
        rows,
        mapping: { date: 'Date', amount: 'Amount', description: 'Description' },
        account_id: acc.id,
        assignments: [
          { index: 0, category_id: cat.id },
          { index: 1, category_id: cat.id }
        ]
      });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.inserted).toBe(2);
    expect(confirmRes.body.duplicates).toBe(0);

    // Verify DB row has correct source and import_hash
    const tx = db.prepare("SELECT * FROM transactions WHERE description='Burger King'").get();
    expect(tx.source).toBe('imported');
    expect(tx.import_hash).toBeTruthy();
    expect(tx.import_hash.length).toBe(64); // SHA-256 hex

    // Re-confirm — both should be duplicates
    const confirmRes2 = await request(app)
      .post('/api/import/confirm')
      .set('Cookie', cookie)
      .send({
        rows,
        mapping: { date: 'Date', amount: 'Amount', description: 'Description' },
        account_id: acc.id,
        assignments: []
      });
    expect(confirmRes2.body.duplicates).toBe(2);
    expect(confirmRes2.body.inserted).toBe(0);

    fs.unlinkSync(csvPath);
  });

  test('POST /api/import/parse requires auth', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/import/parse');
    expect(res.status).toBe(401);
  });

  test('POST /api/import/confirm auto-categorizes recurring transactions', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    const acc = db.prepare('SELECT id FROM accounts').get();

    // Insert a known recurring transaction
    db.prepare('INSERT INTO transactions (date,amount,description,category_id,source,is_recurring) VALUES (?,?,?,?,?,?)')
      .run('2026-04-01', -14.99, 'Netflix', cat.id, 'manual', 1);

    const csvPath = makeCsv('Date,Amount,Description\n2026-05-01,-14.99,Netflix\n');
    const parseRes = await request(app)
      .post('/api/import/parse')
      .set('Cookie', cookie)
      .attach('file', csvPath);
    const { rows } = parseRes.body;

    const confirmRes = await request(app)
      .post('/api/import/confirm')
      .set('Cookie', cookie)
      .send({
        rows,
        mapping: { date: 'Date', amount: 'Amount', description: 'Description' },
        account_id: acc.id,
        assignments: [] // no manual assignments — rely on auto-categorize
      });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.inserted).toBe(1);

    const tx = db.prepare("SELECT * FROM transactions WHERE description='Netflix' AND source='imported'").get();
    expect(tx.category_id).toBe(cat.id);
    expect(tx.is_recurring).toBe(1);
    fs.unlinkSync(csvPath);
  });

  test('POST /api/import/parse handles BOM-prefixed CSV', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    // Write a CSV with UTF-8 BOM prefix
    const csvPath = path.join(os.tmpdir(), `test-bom-${Date.now()}.csv`);
    fs.writeFileSync(csvPath, '\uFEFFDate,Amount,Description\n2026-05-01,-10.00,Test\n');
    const res = await request(app)
      .post('/api/import/parse')
      .set('Cookie', cookie)
      .attach('file', csvPath);
    expect(res.status).toBe(200);
    expect(res.body.headers[0]).toBe('Date'); // not '\uFEFFDate'
    fs.unlinkSync(csvPath);
  });

  test('POST /api/import/suggest rule match takes priority over history', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    // Add a second category
    db.prepare('INSERT INTO categories (name, type, default_allocation, rollover) VALUES (?,?,?,?)').run('Other', 'expense', 0, 0);
    const otherCat = db.prepare("SELECT id FROM categories WHERE name='Other'").get();

    // History says "RUNPOD.IO" → otherCat
    db.prepare('INSERT INTO transactions (date,amount,description,category_id,source) VALUES (?,?,?,?,?)')
      .run('2026-01-01', -10, 'RUNPOD.IO', otherCat.id, 'manual');

    // Rule says "RUNPOD" → cat (Food)
    db.prepare('INSERT INTO categorization_rules (keyword, category_id) VALUES (?,?)').run('RUNPOD', cat.id);

    const res = await request(app)
      .post('/api/import/suggest')
      .set('Cookie', cookie)
      .send({ descriptions: ['RUNPOD.IO NJ 10.00'] });
    expect(res.status).toBe(200);
    // Rule wins over history
    expect(res.body.suggestions['RUNPOD.IO NJ 10.00']).toBe(cat.id);
  });

  test('POST /api/import/suggest falls back to history when no rule matches', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();

    // History only (no rule)
    db.prepare('INSERT INTO transactions (date,amount,description,category_id,source) VALUES (?,?,?,?,?)')
      .run('2026-01-01', -10, 'Tim Hortons', cat.id, 'manual');

    const res = await request(app)
      .post('/api/import/suggest')
      .set('Cookie', cookie)
      .send({ descriptions: ['Tim Hortons'] });
    expect(res.status).toBe(200);
    expect(res.body.suggestions['Tim Hortons']).toBe(cat.id);
  });

  test('POST /api/import/confirm rule auto-categorizes when no user assignment', async () => {
    const { app, db } = setup();
    const cookie = await getAuthCookie(app);
    const cat = db.prepare('SELECT id FROM categories').get();
    const acc = db.prepare('SELECT id FROM accounts').get();

    // Rule: RUNPOD → cat
    db.prepare('INSERT INTO categorization_rules (keyword, category_id) VALUES (?,?)').run('RUNPOD', cat.id);

    const rows = [{ Date: '2026-05-01', Amount: '-14.07', Description: 'RUNPOD.IO NJ 10.00' }];
    const res = await request(app)
      .post('/api/import/confirm')
      .set('Cookie', cookie)
      .send({
        rows,
        mapping: { date: 'Date', amount: 'Amount', description: 'Description' },
        account_id: acc.id,
        assignments: [],
      });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);

    const tx = db.prepare("SELECT * FROM transactions WHERE description='RUNPOD.IO NJ 10.00'").get();
    expect(tx.category_id).toBe(cat.id);
  });
});

describe('uploaded file cleanup', () => {
  afterEach(() => jest.restoreAllMocks());

  const parseCsv = async (app, cookie, csvPath) => request(app)
    .post('/api/import/parse')
    .set('Cookie', cookie)
    .attach('file', csvPath);

  test('removes the uploaded temp file after parsing', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const csvPath = makeCsv('Date,Amount,Description\n2026-05-01,-25.00,Burger King\n');
    const unlink = jest.spyOn(fs, 'unlinkSync');
    const res = await parseCsv(app, cookie, csvPath);
    expect(res.status).toBe(200);
    const uploadPath = unlink.mock.calls.map(call => call[0]).find(p => p !== csvPath);
    expect(uploadPath).toBeDefined();
    expect(fs.existsSync(uploadPath)).toBe(false);
    fs.unlinkSync(csvPath);
  });

  test('removes the uploaded temp file when the CSV cannot be parsed', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const csvPath = makeCsv('a,b\n"unterminated,1\n');
    const unlink = jest.spyOn(fs, 'unlinkSync');
    const res = await parseCsv(app, cookie, csvPath);
    expect(res.status).toBe(400);
    const uploadPath = unlink.mock.calls.map(call => call[0]).find(p => p !== csvPath);
    expect(uploadPath).toBeDefined();
    expect(fs.existsSync(uploadPath)).toBe(false);
    fs.unlinkSync(csvPath);
  });

  test('still answers when the temp file cannot be removed', async () => {
    const { app } = setup();
    const cookie = await getAuthCookie(app);
    const csvPath = makeCsv('Date,Amount,Description\n2026-05-01,-25.00,Burger King\n');
    const unlink = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    });
    const res = await parseCsv(app, cookie, csvPath);
    const leftovers = unlink.mock.calls.map(call => call[0]).filter(p => p !== csvPath);
    unlink.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual(['Date', 'Amount', 'Description']);
    for (const p of [csvPath, ...leftovers]) fs.rmSync(p, { force: true });
  });
});
