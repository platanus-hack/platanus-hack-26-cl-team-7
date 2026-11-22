const express = require('express');
const { requireAuth } = require('../auth');
const { isText, toNumber } = require('../validate');

const ACCOUNT_TYPES = ['checking', 'savings', 'credit'];

// Returns { values } for a valid body or { error } with the message for the 400.
function parseAccount(body, { balanceRequired }) {
  const { name, type } = body;
  const balance = body.balance === undefined && !balanceRequired ? 0 : body.balance;
  if (!isText(name) || !type) return { error: 'name and type required' };
  if (!ACCOUNT_TYPES.includes(type)) return { error: `type must be one of: ${ACCOUNT_TYPES.join(', ')}` };
  const amount = toNumber(balance);
  if (amount === null) return { error: 'balance must be a number' };
  return { values: { name: name.trim(), type, balance: amount } };
}

const ACCOUNT_WITH_BALANCE = `
  SELECT a.*,
    a.balance + COALESCE(
      (SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id),
      0
    ) AS current_balance
  FROM accounts a
`;

module.exports = function (db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    res.json(db.prepare(ACCOUNT_WITH_BALANCE).all());
  });

  router.post('/', (req, res) => {
    const { values, error } = parseAccount(req.body, { balanceRequired: false });
    if (error) return res.status(400).json({ error });
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO accounts (name, type, balance) VALUES (?,?,?)'
    ).run(values.name, values.type, values.balance);
    const created = db.prepare(ACCOUNT_WITH_BALANCE + ' WHERE a.id=?').get(lastInsertRowid);
    if (!created) return res.status(500).json({ error: 'Failed to create account' });
    res.status(201).json(created);
  });

  router.put('/:id', (req, res) => {
    const { values, error } = parseAccount(req.body, { balanceRequired: true });
    if (error) return res.status(400).json({ error });
    const result = db.prepare(
      'UPDATE accounts SET name=?, type=?, balance=? WHERE id=?'
    ).run(values.name, values.type, values.balance, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare(ACCOUNT_WITH_BALANCE + ' WHERE a.id=?').get(req.params.id));
  });

  router.put('/:id/sync', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const current_balance = Number(req.body.current_balance);
    if (!Number.isFinite(current_balance))
      return res.status(400).json({ error: 'current_balance must be a finite number' });

    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(id);
    if (!account) return res.status(404).json({ error: 'Not found' });

    const { total } = db.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE account_id = ?'
    ).get(id);

    const starting_balance = current_balance - total;
    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(starting_balance, id);

    res.json(db.prepare(ACCOUNT_WITH_BALANCE + ' WHERE a.id=?').get(id));
  });

  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM accounts WHERE id=?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  return router;
};
