const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('checking','savings','credit')),
    balance REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('income','expense')),
    default_allocation REAL NOT NULL DEFAULT 0,
    rollover INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS budget_months (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    allocated REAL NOT NULL DEFAULT 0,
    rolled_over REAL NOT NULL DEFAULT 0,
    UNIQUE(year, month, category_id)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','imported')),
    is_recurring INTEGER NOT NULL DEFAULT 0,
    import_hash TEXT UNIQUE
  );
  CREATE TABLE IF NOT EXISTS transaction_splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    amount REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    balance_date TEXT,
    apr REAL NOT NULL DEFAULT 0,
    credit_limit REAL NOT NULL DEFAULT 0,
    minimum_payment REAL NOT NULL DEFAULT 0,
    due_day INTEGER CHECK(due_day BETWEEN 1 AND 31),
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS stock_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    shares REAL NOT NULL,
    purchase_price REAL NOT NULL,
    purchase_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS savings_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    target_amount REAL NOT NULL,
    target_date TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );
  CREATE TABLE IF NOT EXISTS categorization_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );
`;

function createDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Migrate: add balance_date if it doesn't exist yet
  const cols = db.prepare("PRAGMA table_info(debts)").all().map(c => c.name);
  if (!cols.includes('balance_date')) {
    db.exec("ALTER TABLE debts ADD COLUMN balance_date TEXT");
  }
  return db;
}

const defaultDb = createDb(config.DB_PATH);

module.exports = defaultDb;
module.exports.createDb = createDb;
