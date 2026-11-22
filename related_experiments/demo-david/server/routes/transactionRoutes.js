const express = require('express');
const { requireAuth } = require('../auth');
const { toOptionalId, rowExists } = require('../validate');

// A whole-number query value, the fallback when it is absent, or NaN when it is malformed.
function wholeNumber(raw, fallback) {
  if (raw === undefined) return fallback;
  return typeof raw === 'string' && /^-?\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
}

// Category and account may be left out; when given they must be existing rows.
// Returns { categoryId, accountId } or { error } with the message for the 400.
function parseLinks(db, body) {
  const categoryId = toOptionalId(body.category_id);
  if (Number.isNaN(categoryId) || (categoryId !== null && !rowExists(db, 'categories', categoryId)))
    return { error: 'category not found' };
  const accountId = toOptionalId(body.account_id);
  if (Number.isNaN(accountId) || (accountId !== null && !rowExists(db, 'accounts', accountId)))
    return { error: 'account not found' };
  return { categoryId, accountId };
}

module.exports = function (db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/latest-date', (req, res) => {
    const row = db.prepare('SELECT MAX(date) as date FROM transactions').get();
    res.json({ date: row.date ?? null });
  });

  router.get('/', (req, res) => {
    const { start, end, q, type, category_id, account_id } = req.query;
    const requestedLimit = wholeNumber(req.query.limit, 50);
    const requestedOffset = wholeNumber(req.query.offset, 0);
    if (Number.isNaN(requestedLimit) || requestedLimit < 1)
      return res.status(400).json({ error: 'limit must be a whole number of 1 or more' });
    if (Number.isNaN(requestedOffset))
      return res.status(400).json({ error: 'offset must be a whole number' });
    const limit  = Math.min(requestedLimit, 200);
    const offset = Math.max(requestedOffset, 0);

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (start && !ISO_DATE.test(start)) return res.status(400).json({ error: 'Invalid start date' });
    if (end   && !ISO_DATE.test(end))   return res.status(400).json({ error: 'Invalid end date' });

    let sql = `
      SELECT t.*,
        c.name as category_name,
        a.name as account_name,
        a.type as account_type,
        CASE WHEN EXISTS (SELECT 1 FROM transaction_splits WHERE transaction_id = t.id) THEN 1 ELSE 0 END as has_splits
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE 1=1
    `;
    const params = [];

    if (start) { sql += ' AND t.date >= ?'; params.push(start); }
    if (end)   { sql += ' AND t.date <= ?'; params.push(end); }
    if (q)     { sql += ' AND t.description LIKE ?'; params.push(`%${q}%`); }
    if (type === 'income')  sql += ' AND t.amount > 0';
    if (type === 'expense') sql += ' AND t.amount < 0';
    if (category_id === 'none')       sql += ' AND t.category_id IS NULL';
    else if (category_id)  { sql += ' AND t.category_id = ?'; params.push(category_id); }
    if (account_id) { sql += ' AND t.account_id = ?'; params.push(account_id); }

    sql += ' ORDER BY t.date DESC LIMIT ? OFFSET ?';
    params.push(limit + 1, offset);

    const rows = db.prepare(sql).all(...params);
    const hasMore = rows.length > limit;
    res.json({ transactions: hasMore ? rows.slice(0, limit) : rows, hasMore });
  });

  router.post('/', (req, res) => {
    const { date, amount, description, is_recurring = false } = req.body;
    if (!date || amount === undefined || !description)
      return res.status(400).json({ error: 'date, amount, and description required' });
    const links = parseLinks(db, req.body);
    if (links.error) return res.status(400).json({ error: links.error });
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO transactions (date,amount,description,category_id,account_id,source,is_recurring) VALUES (?,?,?,?,?,?,?)'
    ).run(date, amount, description, links.categoryId, links.accountId, 'manual', is_recurring ? 1 : 0);
    res.status(201).json(db.prepare('SELECT * FROM transactions WHERE id=?').get(lastInsertRowid));
  });

  router.get('/:id/splits', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid transaction id' });
    const tx = db.prepare('SELECT id FROM transactions WHERE id = ?').get(id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    const splits = db.prepare(`
      SELECT ts.*, c.name as category_name
      FROM transaction_splits ts
      LEFT JOIN categories c ON c.id = ts.category_id
      WHERE ts.transaction_id = ?
      ORDER BY ts.id
    `).all(id);
    res.json(splits);
  });

  router.put('/:id/splits', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid transaction id' });
    const { splits } = req.body;
    if (!Array.isArray(splits))
      return res.status(400).json({ error: 'splits must be an array' });

    const tx = db.prepare('SELECT id, amount FROM transactions WHERE id = ?').get(id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    if (splits.length === 0) {
      db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(id);
      return res.json([]);
    }

    const coerced = [];
    for (const s of splits) {
      const amt = Number(s.amount);
      if (!Number.isFinite(amt) || amt <= 0)
        return res.status(400).json({ error: 'Each split amount must be greater than 0' });
      coerced.push({ category_id: s.category_id, amount: amt });
    }

    const sum = coerced.reduce((acc, s) => acc + s.amount, 0);
    if (Math.abs(sum - Math.abs(tx.amount)) > 0.01)
      return res.status(400).json({ error: `Split amounts sum ($${sum.toFixed(2)}) must equal transaction total ($${Math.abs(tx.amount).toFixed(2)})` });

    try {
      db.transaction(() => {
        db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ?').run(id);
        const insert = db.prepare(
          'INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)'
        );
        for (const s of coerced) {
          insert.run(id, s.category_id ?? null, s.amount);
        }
      })();
    } catch {
      return res.status(500).json({ error: 'Failed to save splits' });
    }

    const rows = db.prepare(`
      SELECT ts.*, c.name as category_name
      FROM transaction_splits ts
      LEFT JOIN categories c ON c.id = ts.category_id
      WHERE ts.transaction_id = ?
      ORDER BY ts.id
    `).all(id);
    res.json(rows);
  });

  router.put('/:id', (req, res) => {
    const { date, amount, description, is_recurring = false } = req.body;
    if (!date || amount === undefined || !description)
      return res.status(400).json({ error: 'date, amount, and description required' });
    const links = parseLinks(db, req.body);
    if (links.error) return res.status(400).json({ error: links.error });
    const result = db.prepare(
      'UPDATE transactions SET date=?,amount=?,description=?,category_id=?,account_id=?,is_recurring=? WHERE id=?'
    ).run(date, amount, description, links.categoryId, links.accountId, is_recurring ? 1 : 0, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM transactions WHERE id=?').get(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM transactions WHERE id=?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  return router;
};
