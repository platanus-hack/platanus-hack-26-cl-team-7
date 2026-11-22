const express = require('express');
const { requireAuth } = require('../auth');
const { isText, toNumber, toOptionalId, rowExists } = require('../validate');

// Returns { values } for a valid body or { error } with the message for the 400.
// The numeric fields default to 0 when left out; due_day is a day of the month or null.
function parseDebt(db, body) {
  const { name, due_day = null } = body;
  if (!isText(name)) return { error: 'name required' };

  const numbers = {};
  for (const field of ['balance', 'apr', 'credit_limit', 'minimum_payment']) {
    const raw = body[field] === undefined ? 0 : body[field];
    const value = toNumber(raw);
    if (value === null) return { error: `${field} must be a number` };
    numbers[field] = value;
  }

  let dueDay = null;
  if (due_day !== null && due_day !== '') {
    dueDay = toNumber(due_day);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)
      return { error: 'due_day must be a whole number from 1 to 31' };
  }

  const accountId = toOptionalId(body.account_id);
  if (Number.isNaN(accountId) || (accountId !== null && !rowExists(db, 'accounts', accountId)))
    return { error: 'account not found' };

  return { values: { name: name.trim(), ...numbers, due_day: dueDay, account_id: accountId } };
}

function projectPayoff(debts, extraPayment, method) {
  let state = debts.map(d => ({ ...d, balance: d.balance }));
  const months = [];
  let totalInterest = 0;
  const MAX_MONTHS = 600;

  while (state.some(d => d.balance > 0.005) && months.length < MAX_MONTHS) {
    const snapshot = {};

    // Sort active debts for priority
    const active = state.filter(d => d.balance > 0.005);
    if (method === 'snowball') {
      active.sort((a, b) => a.balance - b.balance);
    } else {
      active.sort((a, b) => b.apr - a.apr); // avalanche default
    }

    // Apply interest + minimum payments
    for (const debt of state) {
      if (debt.balance <= 0) { snapshot[debt.id] = 0; continue; }
      const interest = debt.balance * (debt.apr / 100 / 12);
      totalInterest += interest;
      const payment = Math.min(debt.minimum_payment, debt.balance + interest);
      debt.balance = Math.max(0, debt.balance + interest - payment);
      snapshot[debt.id] = Math.round(debt.balance * 100) / 100;
    }

    // Apply extra payment to priority debt
    let remaining = extraPayment;
    for (const debt of active) {
      if (debt.balance <= 0 || remaining <= 0) continue;
      const applied = Math.min(remaining, debt.balance);
      debt.balance = Math.max(0, debt.balance - applied);
      snapshot[debt.id] = Math.round(debt.balance * 100) / 100;
      remaining -= applied;
    }

    months.push({ month: months.length + 1, balances: { ...snapshot } });
  }

  // Compute payoff date from today
  const now = new Date();
  now.setMonth(now.getMonth() + months.length);
  const payoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return { months, totalInterest: Math.round(totalInterest * 100) / 100, payoffDate };
}

module.exports = function (db) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /debts/projection must be before GET /debts/:id to avoid 'projection' being captured as an id
  router.get('/projection', (req, res) => {
    const extraPayment = parseFloat(req.query.extraPayment) || 0;
    const method = req.query.method === 'snowball' ? 'snowball' : 'avalanche';
    const debts = db.prepare('SELECT * FROM debts WHERE balance > 0').all();
    if (!debts.length) return res.json({ months: [], totalInterest: 0, payoffDate: null });
    res.json(projectPayoff(debts, extraPayment, method));
  });

  router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM debts').all());
  });

  router.post('/', (req, res) => {
    const { values: v, error } = parseDebt(db, req.body);
    if (error) return res.status(400).json({ error });
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO debts (name,balance,apr,credit_limit,minimum_payment,due_day,account_id) VALUES (?,?,?,?,?,?,?)'
    ).run(v.name, v.balance, v.apr, v.credit_limit, v.minimum_payment, v.due_day, v.account_id);
    res.status(201).json(db.prepare('SELECT * FROM debts WHERE id=?').get(lastInsertRowid));
  });

  router.put('/:id', (req, res) => {
    const { values: v, error } = parseDebt(db, req.body);
    if (error) return res.status(400).json({ error });
    const result = db.prepare(
      'UPDATE debts SET name=?,balance=?,apr=?,credit_limit=?,minimum_payment=?,due_day=?,account_id=? WHERE id=?'
    ).run(v.name, v.balance, v.apr, v.credit_limit, v.minimum_payment, v.due_day, v.account_id, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM debts WHERE id=?').get(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM debts WHERE id=?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  return router;
};
