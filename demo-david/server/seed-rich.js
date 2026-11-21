#!/usr/bin/env node
// Mock data only: a fictional household with six months of activity.
//   seedRich(db)    wipes every table, then loads the mock data (npm run seed)
//   seedIfEmpty(db) loads it only when the database has no users (server start)
// Test login: admin / changeme
const bcrypt = require('bcrypt');

function seedRich(db) {
  db.transaction(() => {
    // --- Wipe everything ---
    db.exec(`
      DELETE FROM categorization_rules;
      DELETE FROM savings_goals;
      DELETE FROM stock_holdings;
      DELETE FROM transaction_splits;
      DELETE FROM transactions;
      DELETE FROM budget_months;
      DELETE FROM debts;
      DELETE FROM accounts;
      DELETE FROM categories;
      DELETE FROM users;
      DELETE FROM sqlite_sequence;
    `);

    // --- User ---
    const hash = bcrypt.hashSync('changeme', 12);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)').run('admin', hash);

    // --- Categories ---
    const CATEGORIES = [
      { name: 'Salary',              type: 'income',  default_allocation: 0,     rollover: 0 },
      { name: 'Dividends',           type: 'income',  default_allocation: 0,     rollover: 0 },
      { name: 'Investment Income',   type: 'income',  default_allocation: 0,     rollover: 0 },
      { name: 'Transfers In',        type: 'income',  default_allocation: 0,     rollover: 0 },
      { name: 'Mortgage',            type: 'expense', default_allocation: 6800,  rollover: 0 },
      { name: 'HOA',                 type: 'expense', default_allocation: 480,   rollover: 0 },
      { name: 'Phone',               type: 'expense', default_allocation: 250,   rollover: 0 },
      { name: 'Internet',            type: 'expense', default_allocation: 200,   rollover: 0 },
      { name: 'Insurance',           type: 'expense', default_allocation: 620,   rollover: 0 },
      { name: 'Groceries',           type: 'expense', default_allocation: 1200,  rollover: 0 },
      { name: 'Restaurants',         type: 'expense', default_allocation: 2000,  rollover: 0 },
      { name: 'Alcohol & Bars',      type: 'expense', default_allocation: 600,   rollover: 0 },
      { name: 'Gas',                 type: 'expense', default_allocation: 300,   rollover: 0 },
      { name: 'Streaming',           type: 'expense', default_allocation: 120,   rollover: 0 },
      { name: 'Gaming',              type: 'expense', default_allocation: 200,   rollover: 0 },
      { name: 'Shopping',            type: 'expense', default_allocation: 3000,  rollover: 0 },
      { name: 'Travel',              type: 'expense', default_allocation: 5000,  rollover: 0 },
      { name: 'Fitness',             type: 'expense', default_allocation: 400,   rollover: 0 },
      { name: 'Healthcare',          type: 'expense', default_allocation: 500,   rollover: 0 },
      { name: 'Subscriptions',       type: 'expense', default_allocation: 300,   rollover: 0 },
      { name: 'Home & Garden',       type: 'expense', default_allocation: 1500,  rollover: 0 },
      { name: 'Auto',                type: 'expense', default_allocation: 1200,  rollover: 0 },
      { name: 'Investments',         type: 'expense', default_allocation: 10000, rollover: 0 },
      { name: 'Charity',             type: 'expense', default_allocation: 1000,  rollover: 0 },
      { name: 'Transfers Out',       type: 'expense', default_allocation: 0,     rollover: 0 },
      { name: 'Savings',             type: 'expense', default_allocation: 5000,  rollover: 1 },
    ];
    const insertCat = db.prepare('INSERT INTO categories (name, type, default_allocation, rollover) VALUES (?,?,?,?)');
    for (const c of CATEGORIES) insertCat.run(c.name, c.type, c.default_allocation, c.rollover);

    const catId = (name) => db.prepare('SELECT id FROM categories WHERE name=?').get(name).id;

    // --- Accounts ---
    const insertAcct = db.prepare('INSERT INTO accounts (name, type, balance) VALUES (?,?,?)');
    insertAcct.run('Chase Sapphire Checking', 'checking', 47382.19);
    insertAcct.run('Marcus High-Yield Savings', 'savings', 142500.00);
    insertAcct.run('Fidelity Brokerage', 'savings', 887240.50);
    insertAcct.run('Amex Platinum', 'credit', -4210.88);
    insertAcct.run('Tesla Financing', 'credit', -38200.00);

    const acctId = (name) => db.prepare('SELECT id FROM accounts WHERE name=?').get(name).id;
    const checkingId = acctId('Chase Sapphire Checking');
    const savingsId  = acctId('Marcus High-Yield Savings');
    const amexId     = acctId('Amex Platinum');
    const teslaAcctId = acctId('Tesla Financing');

    // --- Debts ---
    const insertDebt = db.prepare(`
      INSERT INTO debts (name, balance, balance_date, apr, credit_limit, minimum_payment, due_day, account_id)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    insertDebt.run('Amex Platinum',    4210.88,  '2026-05-01', 19.99, 50000,  85,   1,  amexId);
    insertDebt.run('Tesla Model S Loan', 38200.00, '2026-05-01', 3.99, 0, 820, 15, teslaAcctId);
    insertDebt.run('Primary Mortgage', 412000.00, '2026-05-01', 3.25, 0, 6800, 1, null);

    // --- Stock Holdings ---
    const insertStock = db.prepare('INSERT INTO stock_holdings (ticker, shares, purchase_price, purchase_date, notes) VALUES (?,?,?,?,?)');
    insertStock.run('AAPL',  500,  148.22, '2021-03-15', 'Long-term hold');
    insertStock.run('NVDA',  200,  280.50, '2022-08-10', 'AI mega-trend');
    insertStock.run('TSLA',  150,  205.00, '2023-01-20', '');
    insertStock.run('SPY',   400,  415.30, '2020-11-01', 'Core index position');
    insertStock.run('BRK.B', 300,  338.75, '2021-06-01', 'Value anchor');
    insertStock.run('MSFT',  250,  290.40, '2022-02-14', '');
    insertStock.run('AMZN',  180,  142.80, '2023-04-05', '');
    insertStock.run('VTI',   600,  215.60, '2020-05-20', 'Broad market ETF');

    // --- Savings Goals ---
    const insertGoal = db.prepare(`
      INSERT INTO savings_goals (name, account_id, target_amount, target_date, created_at)
      VALUES (?,?,?,?,?)
    `);
    insertGoal.run('Lake Tahoe Cabin',   savingsId, 300000.00, '2027-12-31', '2025-01-10');
    insertGoal.run('Italy Trip',         savingsId, 25000.00,  '2026-09-01', '2025-11-01');
    insertGoal.run('Emergency Fund',     savingsId, 150000.00, null,         '2024-06-01');
    insertGoal.run('Porsche 911',        savingsId, 180000.00, '2027-06-01', '2025-03-15');

    // --- Transactions: last 6 months ---
    const insertTx = db.prepare(`
      INSERT INTO transactions (date, amount, description, category_id, account_id, source, is_recurring)
      VALUES (?,?,?,?,?,?,?)
    `);

    function tx(date, amount, desc, catName, acct, recurring = 0) {
      insertTx.run(date, amount, desc, catId(catName), acct, 'imported', recurring);
    }

    // Helper to generate dates
    function d(monthsAgo, day) {
      // May 2026 base; built from UTC parts so the data is identical in every timezone
      return new Date(Date.UTC(2026, 4 - monthsAgo, day)).toISOString().slice(0, 10);
    }

    // === INCOME ===
    for (let m = 0; m < 6; m++) {
      tx(d(m, 1),  35000.00, 'Direct Deposit - Acme Corp Payroll',        'Salary',           checkingId, 1);
      tx(d(m, 15), 35000.00, 'Direct Deposit - Acme Corp Payroll',        'Salary',           checkingId, 1);
      tx(d(m, 10),  4200.00, 'Fidelity Dividend Reinvestment',            'Dividends',        savingsId,  0);
      tx(d(m, 20),  1850.00, 'Marcus HYSA Interest',                      'Investment Income',savingsId,  1);
    }

    // === RECURRING EXPENSES ===
    for (let m = 0; m < 6; m++) {
      tx(d(m, 1),  -6800.00, 'Chase Mortgage Auto-Pay',                   'Mortgage',    checkingId, 1);
      tx(d(m, 1),   -480.00, 'Lakeview HOA',                              'HOA',         checkingId, 1);
      tx(d(m, 5),   -249.00, 'Verizon Wireless',                          'Phone',       amexId,     1);
      tx(d(m, 5),   -199.00, 'Comcast Business',                          'Internet',    amexId,     1);
      tx(d(m, 3),   -820.00, 'Tesla Financial Services',                  'Auto',        checkingId, 1);
      tx(d(m, 8),   -385.00, 'USAA Auto & Home Insurance',                'Insurance',   checkingId, 1);
      tx(d(m, 10), -5000.00, 'Transfer to Fidelity',                      'Investments', checkingId, 1);
      tx(d(m, 15), -2000.00, 'Transfer to Marcus Savings',                'Savings',     checkingId, 1);
      tx(d(m, 2),    -17.99, 'Netflix Premium',                           'Streaming',   amexId,     1);
      tx(d(m, 2),    -15.99, 'Spotify Family',                            'Streaming',   amexId,     1);
      tx(d(m, 2),    -29.99, 'YouTube Premium Family',                    'Streaming',   amexId,     1);
      tx(d(m, 3),   -599.00, 'Equinox Membership',                        'Fitness',     amexId,     1);
    }

    // === GROCERIES / DINING ===
    const groceries = [
      ['Whole Foods Market', -284.52], ['Whole Foods Market', -312.18], ['Whole Foods Market', -198.40],
      ['Bristol Farms', -445.20], ['Erewhon Market', -178.90], ['Costco Wholesale', -389.44],
    ];
    const dining = [
      ['Nobu Los Angeles', -420.00], ['Spago Beverly Hills', -380.50], ['The French Laundry', -890.00],
      ['Catch LA', -310.80], ['Mastros Steakhouse', -540.20], ['Sushi Roku', -285.00],
      ['Bottega Louie', -175.40], ['Craig\'s Restaurant', -295.60], ['Soho House LA', -220.00],
      ['Jon & Vinny\'s', -165.30], ['Baltaire', -485.00], ['Nobu Malibu', -620.40],
    ];
    const bars = [
      ['The Bungalow Santa Monica', -185.00], ['Hyde Sunset', -340.00], ['Bar Lis', -260.50],
      ['Catch Rooftop', -420.00], ['Gracias Madre Bar', -145.00],
    ];

    let txDayOffset = 0;
    for (let m = 0; m < 6; m++) {
      for (const [desc, amt] of groceries.slice(0, 4)) {
        const day = 3 + (txDayOffset++ % 25);
        tx(d(m, Math.min(day, 28)), amt, desc, 'Groceries', amexId);
      }
      for (const [desc, amt] of dining.slice(0, 8)) {
        const day = 2 + (txDayOffset++ % 26);
        tx(d(m, Math.min(day, 28)), amt, desc, 'Restaurants', amexId);
      }
      for (const [desc, amt] of bars.slice(0, 3)) {
        const day = 5 + (txDayOffset++ % 22);
        tx(d(m, Math.min(day, 28)), amt, desc, 'Alcohol & Bars', amexId);
      }
    }

    // === SHOPPING / LUXURY ===
    const shopping = [
      ['Nordstrom', -1240.00], ['Saks Fifth Avenue', -2180.50], ['Louis Vuitton', -3400.00],
      ['Apple Store', -2199.00], ['Neiman Marcus', -1850.00], ['Porsche Design', -890.00],
      ['Best Buy', -1420.00], ['Pottery Barn', -2640.00], ['RH Gallery', -4200.00],
      ['Tiffany & Co', -3800.00], ['REI Co-op', -745.00], ['Lululemon', -485.00],
      ['Restoration Hardware', -1880.00], ['Williams-Sonoma', -620.00], ['Tesla Shop', -340.00],
    ];
    for (let m = 0; m < 6; m++) {
      for (const [desc, amt] of shopping.slice(m * 2, m * 2 + 3)) {
        const day = 8 + (m * 3);
        tx(d(m, Math.min(day, 28)), amt, desc, 'Shopping', amexId);
      }
    }

    // === TRAVEL ===
    const travel = [
      [d(1, 5),   -12400.00, 'Amex Travel - Business Class LAX-JFK'],
      [d(1, 6),    -4200.00, 'The Greenwich Hotel New York'],
      [d(1, 8),    -1840.00, 'Chef\'s Club NYC'],
      [d(2, 12),  -18600.00, 'Amex Travel - First Class LAX-LHR'],
      [d(2, 13),   -6800.00, 'Claridge\'s London'],
      [d(2, 16),   -2200.00, 'Sketch London'],
      [d(3, 20),   -9400.00, 'Four Seasons Maui'],
      [d(3, 21),   -1200.00, 'Maui Helicopter Tours'],
      [d(4, 3),   -22000.00, 'Amex Travel - Maldives Package'],
      [d(4, 4),    -3400.00, 'One&Only Reethi Rah Resort'],
      [d(5, 18),   -5600.00, 'Aspen Grand Hyatt Ski Package'],
    ];
    for (const [date, amt, desc] of travel) {
      insertTx.run(date, amt, desc, catId('Travel'), amexId, 'imported', 0);
    }

    // === GAS / AUTO ===
    for (let m = 0; m < 6; m++) {
      tx(d(m, 7),  -89.40, 'Tesla Supercharging - Beverly Hills',   'Gas', checkingId);
      tx(d(m, 14), -94.20, 'Tesla Supercharging - Malibu',          'Gas', checkingId);
      tx(d(m, 21), -880.00, 'Beverly Hills Porsche - Service',      'Auto', amexId);
    }

    // === HEALTHCARE ===
    for (let m = 0; m < 6; m++) {
      tx(d(m, 10), -380.00, 'Cedars-Sinai Medical Group',           'Healthcare', amexId);
      tx(d(m, 12), -220.00, 'UCLA Health Dermatology',              'Healthcare', amexId);
    }

    // === CHARITY ===
    for (let m = 0; m < 6; m++) {
      tx(d(m, 28), -1000.00, 'ACLU Donation',                       'Charity', checkingId);
      tx(d(m, 28),  -500.00, 'Feeding America',                     'Charity', checkingId);
    }

    // --- Budget months: last 6 months ---
    const insertBM = db.prepare(`
      INSERT OR IGNORE INTO budget_months (year, month, category_id, allocated, rolled_over)
      VALUES (?,?,?,?,?)
    `);
    const cats = db.prepare('SELECT id, default_allocation FROM categories').all();
    const months = [
      [2026, 5], [2026, 4], [2026, 3], [2026, 2], [2026, 1], [2025, 12],
    ];
    for (const [year, month] of months) {
      for (const cat of cats) {
        if (cat.default_allocation > 0) {
          insertBM.run(year, month, cat.id, cat.default_allocation, 0);
        }
      }
    }
  })();
}

function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return false;
  seedRich(db);
  return true;
}

module.exports = { seedRich, seedIfEmpty };

if (require.main === module) {
  seedRich(require('./db'));
  console.log('Rich seed complete.');
}
