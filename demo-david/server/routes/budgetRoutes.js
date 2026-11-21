const express = require('express');
const { requireAuth } = require('../auth');

module.exports = function (db) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /budget/trends — monthly spending for multiple categories
  router.get('/trends', (req, res) => {
    const { category_ids, months = 12 } = req.query;
    if (!category_ids) return res.json({ labels: [], series: [] });
    if (typeof category_ids !== 'string') return res.status(400).json({ error: 'category_ids must be a comma-separated list' });

    const ids = category_ids.split(',').map(Number).filter(Boolean);
    if (!ids.length) return res.json({ labels: [], series: [] });

    const n = Math.min(parseInt(months) || 12, 36);
    const smartCombineFilter = `AND NOT EXISTS (
      SELECT 1 FROM accounts ax JOIN categories cx ON cx.id = t.category_id
      WHERE ax.id = t.account_id AND ax.type = 'credit' AND cx.type = 'income'
    )`;
    const splitSmartCombineFilter = `AND NOT EXISTS (
      SELECT 1 FROM accounts ax JOIN categories cx ON cx.id = ts.category_id
      WHERE ax.id = t.account_id AND ax.type = 'credit' AND cx.type = 'income'
    )`;

    const now = new Date();
    const labels = [];
    const monthList = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(new Date(d.getFullYear(), d.getMonth()).toLocaleString('default', { month: 'short', year: '2-digit' }));
      monthList.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    const nameStmt = db.prepare('SELECT name FROM categories WHERE id = ?');
    const spendStmt = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as spent
      FROM (
        SELECT t.amount AS amount
        FROM transactions t
        WHERE t.category_id = ?
          AND NOT EXISTS (SELECT 1 FROM transaction_splits ts2 WHERE ts2.transaction_id = t.id)
          AND strftime('%Y', t.date) = ?
          AND strftime('%m', t.date) = printf('%02d', ?)
          ${smartCombineFilter}
        UNION ALL
        SELECT ts.amount * CASE WHEN t.amount < 0 THEN -1 ELSE 1 END AS amount
        FROM transaction_splits ts
        JOIN transactions t ON t.id = ts.transaction_id
        WHERE ts.category_id = ?
          AND strftime('%Y', t.date) = ?
          AND strftime('%m', t.date) = printf('%02d', ?)
          ${splitSmartCombineFilter}
      )
    `);

    const series = ids.map(id => {
      const cat = nameStmt.get(id);
      const data = monthList.map(({ year, month }) => {
        const row = spendStmt.get(id, String(year), month, id, String(year), month);
        return Math.abs(row.spent);
      });
      return { id, name: cat?.name ?? `Category ${id}`, data };
    });

    res.json({ labels, series });
  });

  // GET /budget/:year/:month — returns envelopes for the month, auto-creating from defaults
  router.get('/:year/:month', (req, res) => {
    const { year, month } = req.params;
    const { account_id } = req.query;
    const y = parseInt(year), m = parseInt(month);

    const categories = db.prepare('SELECT * FROM categories').all();
    const insertIfMissing = db.prepare(`
      INSERT OR IGNORE INTO budget_months (year, month, category_id, allocated, rolled_over)
      VALUES (?, ?, ?, ?, 0)
    `);
    db.transaction(() => {
      for (const cat of categories) insertIfMissing.run(y, m, cat.id, cat.default_allocation);
    })();

    const accountFilter = account_id ? 'AND t.account_id = ' + parseInt(account_id) : '';
    // When combining all accounts, exclude income-category transactions on credit accounts
    // (payment receipts) — they're already represented as expenses on the chequing side.
    const smartCombineFilter = !account_id
      ? `AND NOT EXISTS (
           SELECT 1 FROM accounts ax JOIN categories cx ON cx.id = t.category_id
           WHERE ax.id = t.account_id AND ax.type = 'credit' AND cx.type = 'income'
         )`
      : '';
    const splitSmartCombineFilter = !account_id
      ? `AND NOT EXISTS (
           SELECT 1 FROM accounts ax JOIN categories cx ON cx.id = ts.category_id
           WHERE ax.id = t.account_id AND ax.type = 'credit' AND cx.type = 'income'
         )`
      : '';

    const rows = db.prepare(`
      SELECT bm.*, c.name, c.type, c.rollover,
        COALESCE((
          SELECT SUM(amount) FROM (
            SELECT t.amount AS amount
            FROM transactions t
            WHERE t.category_id = bm.category_id
              AND NOT EXISTS (SELECT 1 FROM transaction_splits ts2 WHERE ts2.transaction_id = t.id)
              AND strftime('%Y', t.date) = ?
              AND strftime('%m', t.date) = printf('%02d', ?)
              ${accountFilter}
              ${smartCombineFilter}
            UNION ALL
            SELECT ts.amount * CASE WHEN t.amount < 0 THEN -1 ELSE 1 END AS amount
            FROM transaction_splits ts
            JOIN transactions t ON t.id = ts.transaction_id
            WHERE ts.category_id = bm.category_id
              AND strftime('%Y', t.date) = ?
              AND strftime('%m', t.date) = printf('%02d', ?)
              ${accountFilter}
              ${splitSmartCombineFilter}
          )
        ), 0) AS spent
      FROM budget_months bm
      JOIN categories c ON c.id = bm.category_id
      WHERE bm.year = ? AND bm.month = ?
    `).all(String(y), m, String(y), m, y, m);

    res.json(rows);
  });

  // GET /budget/category/:id/history — monthly spending for last N months
  router.get('/category/:id/history', (req, res) => {
    const catId = parseInt(req.params.id);
    const { account_id, months = 12, year, month } = req.query;
    const n = Math.min(parseInt(months) || 12, 36);
    const accountFilter = account_id ? 'AND t.account_id = ' + parseInt(account_id) : '';
    const smartCombineFilter = !account_id
      ? `AND NOT EXISTS (
           SELECT 1 FROM accounts ax JOIN categories cx ON cx.id = t.category_id
           WHERE ax.id = t.account_id AND ax.type = 'credit' AND cx.type = 'income'
         )`
      : '';
    const splitSmartCombineFilter = !account_id
      ? `AND NOT EXISTS (
           SELECT 1 FROM accounts ax JOIN categories cx ON cx.id = ts.category_id
           WHERE ax.id = t.account_id AND ax.type = 'credit' AND cx.type = 'income'
         )`
      : '';

    // Generate last N months
    const now = new Date();
    const result = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear(), mo = d.getMonth() + 1;
      const row = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as spent, COUNT(*) as count
        FROM (
          SELECT t.amount AS amount
          FROM transactions t
          WHERE t.category_id = ?
            AND NOT EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = t.id)
            AND strftime('%Y', t.date) = ?
            AND strftime('%m', t.date) = printf('%02d', ?)
            ${accountFilter}
            ${smartCombineFilter}
          UNION ALL
          SELECT ts.amount * CASE WHEN t.amount < 0 THEN -1 ELSE 1 END AS amount
          FROM transaction_splits ts
          JOIN transactions t ON t.id = ts.transaction_id
          WHERE ts.category_id = ?
            AND strftime('%Y', t.date) = ?
            AND strftime('%m', t.date) = printf('%02d', ?)
            ${accountFilter}
            ${splitSmartCombineFilter}
        )
      `).get(catId, String(y), mo, catId, String(y), mo);
      result.push({
        year: y, month: mo,
        label: new Date(y, mo - 1).toLocaleString('default', { month: 'short', year: '2-digit' }),
        spent: Math.abs(row.spent),
        count: row.count,
      });
    }

    // Additional stats
    const allTime = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count,
             MIN(date) as first_date, MAX(date) as last_date
      FROM transactions WHERE category_id = ? ${accountFilter}
    `).get(catId);

    const largest = db.prepare(`
      SELECT amount, description, date FROM transactions
      WHERE category_id = ? ${accountFilter}
      ORDER BY amount ASC LIMIT 1
    `).get(catId);

    const monthFilter = (year && month)
      ? `AND strftime('%Y', t.date) = '${String(parseInt(year))}' AND strftime('%m', t.date) = printf('%02d', ${parseInt(month)})`
      : '';
    const recentTxs = db.prepare(`
      SELECT t.date, t.amount, t.description, a.name as account_name
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.category_id = ? ${accountFilter} ${monthFilter}
      ORDER BY t.date DESC, t.id DESC LIMIT 8
    `).all(catId);

    res.json({ history: result, allTime, largest, recentTxs });
  });

  // PUT /budget/:year/:month/:categoryId — update allocation
  router.put('/:year/:month/:categoryId', (req, res) => {
    const { year, month, categoryId } = req.params;
    const { allocated } = req.body;
    if (allocated == null) return res.status(400).json({ error: 'allocated required' });
    const result = db.prepare(
      'UPDATE budget_months SET allocated=? WHERE year=? AND month=? AND category_id=?'
    ).run(allocated, parseInt(year), parseInt(month), parseInt(categoryId));
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare(
      'SELECT * FROM budget_months WHERE year=? AND month=? AND category_id=?'
    ).get(parseInt(year), parseInt(month), parseInt(categoryId)));
  });

  // POST /budget/rollover — create next month rows, applying rollovers
  router.post('/rollover', (req, res) => {
    const { fromYear, fromMonth, toYear, toMonth } = req.body;

    const fromRows = db.prepare(`
      SELECT bm.*, c.rollover,
        COALESCE((
          SELECT SUM(t.amount) FROM transactions t
          WHERE t.category_id = bm.category_id
            AND strftime('%Y', t.date) = ?
            AND strftime('%m', t.date) = printf('%02d', ?)
        ), 0) AS spent,
        c.default_allocation
      FROM budget_months bm
      JOIN categories c ON c.id = bm.category_id
      WHERE bm.year = ? AND bm.month = ?
    `).all(String(fromYear), fromMonth, fromYear, fromMonth);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO budget_months (year, month, category_id, allocated, rolled_over)
      VALUES (?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const row of fromRows) {
        let rolledOver = 0;
        if (row.rollover) {
          const remaining = row.allocated + row.rolled_over + row.spent; // spent is negative
          rolledOver = Math.max(0, remaining);
        }
        insert.run(toYear, toMonth, row.category_id, row.default_allocation, rolledOver);
      }
    })();

    res.json({ ok: true });
  });

  // POST /budget/copy — copy allocated amounts from one month to another (overwrites)
  router.post('/copy', (req, res) => {
    const { fromYear, fromMonth, toYear, toMonth } = req.body;
    if (!fromYear || !fromMonth || !toYear || !toMonth)
      return res.status(400).json({ error: 'fromYear, fromMonth, toYear, toMonth required' });

    const sourceRows = db.prepare(
      'SELECT category_id, allocated FROM budget_months WHERE year = ? AND month = ?'
    ).all(parseInt(fromYear), parseInt(fromMonth));

    const update = db.prepare(
      'UPDATE budget_months SET allocated = ? WHERE year = ? AND month = ? AND category_id = ?'
    );

    let updated = 0;
    db.transaction(() => {
      for (const row of sourceRows) {
        const result = update.run(row.allocated, parseInt(toYear), parseInt(toMonth), row.category_id);
        updated += result.changes;
      }
    })();

    res.json({ updated });
  });

  // POST /budget/transfer — atomically move allocated budget between two envelopes
  router.post('/transfer', (req, res) => {
    const { year, month, fromCategoryId, toCategoryId, amount } = req.body;
    const y = parseInt(year), m = parseInt(month);
    const fromId = parseInt(fromCategoryId), toId = parseInt(toCategoryId);

    if (!year || !month || !fromCategoryId || !toCategoryId || amount === undefined)
      return res.status(400).json({ error: 'year, month, fromCategoryId, toCategoryId, amount required' });
    if (amount <= 0)
      return res.status(400).json({ error: 'amount must be greater than 0' });
    if (fromId === toId)
      return res.status(400).json({ error: 'from and to envelopes must be different' });

    const transferError = db.transaction(() => {
      const fromRow = db.prepare(
        'SELECT allocated FROM budget_months WHERE year=? AND month=? AND category_id=?'
      ).get(y, m, fromId);
      if (!fromRow) return 'Source envelope not found for this month';
      if (fromRow.allocated < amount) return 'Insufficient allocated budget in source envelope';

      const toRow = db.prepare(
        'SELECT allocated FROM budget_months WHERE year=? AND month=? AND category_id=?'
      ).get(y, m, toId);
      if (!toRow) return 'Destination envelope not found for this month';

      db.prepare('UPDATE budget_months SET allocated = allocated - ? WHERE year=? AND month=? AND category_id=?')
        .run(amount, y, m, fromId);
      db.prepare('UPDATE budget_months SET allocated = allocated + ? WHERE year=? AND month=? AND category_id=?')
        .run(amount, y, m, toId);
      return null;
    })();

    if (transferError) return res.status(400).json({ error: transferError });

    const fromUpdated = db.prepare(
      'SELECT category_id, allocated FROM budget_months WHERE year=? AND month=? AND category_id=?'
    ).get(y, m, fromId);
    const toUpdated = db.prepare(
      'SELECT category_id, allocated FROM budget_months WHERE year=? AND month=? AND category_id=?'
    ).get(y, m, toId);

    res.json({ from: fromUpdated, to: toUpdated });
  });

  return router;
};
