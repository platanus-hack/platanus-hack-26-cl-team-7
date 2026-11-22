const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb } = require('../db');

describe('database schema', () => {
  let db;
  beforeEach(() => { db = createDb(':memory:'); });
  afterEach(() => db.close());

  test('creates all required tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map(r => r.name);
    expect(tables).toEqual(expect.arrayContaining([
      'users','accounts','categories','budget_months','transactions','debts'
    ]));
  });

  test('enforces foreign keys', () => {
    const pragma = db.pragma('foreign_keys', { simple: true });
    expect(pragma).toBe(1);
  });
});

describe('database file', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-db-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('creates missing parent folders for a file database', () => {
    const file = path.join(dir, 'a', 'b', 'budget.db');
    const db = createDb(file);
    db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('Kept', 'checking', 1)").run();
    db.close();
    expect(fs.existsSync(file)).toBe(true);

    const reopened = createDb(file);
    expect(reopened.prepare('SELECT name FROM accounts').all()).toEqual([{ name: 'Kept' }]);
    reopened.close();
  });

  test('the test run uses an in-memory default database, not data/budget.db', () => {
    expect(require('../config').DB_PATH).toBe(':memory:');
  });
});
