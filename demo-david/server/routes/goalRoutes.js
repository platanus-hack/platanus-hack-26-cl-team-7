const express = require('express');
const { requireAuth } = require('../auth');

function projectedDate(balance, target, avgMonthlyNet) {
  if (avgMonthlyNet <= 0 || balance >= target) return null;
  const monthsRemaining = (target - balance) / avgMonthlyNet;
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.ceil(monthsRemaining));
  return d.toISOString().slice(0, 10);
}

module.exports = function (db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const rows = db.prepare(`
      SELECT g.*,
        a.name AS account_name,
        COALESCE(a.balance, 0) + COALESCE(
          (SELECT SUM(t2.amount) FROM transactions t2 WHERE t2.account_id = a.id),
          0
        ) AS account_balance,
        COALESCE((
          SELECT SUM(t.amount) / 6.0
          FROM transactions t
          WHERE t.account_id = g.account_id
            AND t.date >= date('now', '-6 months')
        ), 0) AS avg_monthly_net
      FROM savings_goals g
      LEFT JOIN accounts a ON a.id = g.account_id
      ORDER BY g.completed_at IS NOT NULL, g.created_at DESC
    `).all();

    const enriched = rows.map(g => ({
      ...g,
      projected_date: projectedDate(g.account_balance ?? 0, g.target_amount, g.avg_monthly_net),
    }));

    res.json(enriched);
  });

  router.post('/', (req, res) => {
    const { name, target_amount, account_id = null, target_date = null } = req.body;
    if (!name || typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: 'name required' });
    const amt = Number(target_amount);
    if (!Number.isFinite(amt) || amt <= 0)
      return res.status(400).json({ error: 'target_amount must be a positive number' });

    const { lastInsertRowid } = db.prepare(
      'INSERT INTO savings_goals (name, account_id, target_amount, target_date) VALUES (?,?,?,?)'
    ).run(name.trim(), account_id ?? null, amt, target_date ?? null);
    res.status(201).json(db.prepare('SELECT * FROM savings_goals WHERE id=?').get(lastInsertRowid));
  });

  router.put('/:id/complete', (req, res) => {
    const goal = db.prepare('SELECT id, completed_at FROM savings_goals WHERE id=?').get(req.params.id);
    if (!goal) return res.status(404).json({ error: 'Not found' });
    const newVal = goal.completed_at ? null : new Date().toISOString().slice(0, 10);
    db.prepare('UPDATE savings_goals SET completed_at=? WHERE id=?').run(newVal, req.params.id);
    res.json(db.prepare('SELECT * FROM savings_goals WHERE id=?').get(req.params.id));
  });

  router.put('/:id', (req, res) => {
    const { name, target_amount, account_id = null, target_date = null } = req.body;
    if (!name || typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: 'name required' });
    const amt = Number(target_amount);
    if (!Number.isFinite(amt) || amt <= 0)
      return res.status(400).json({ error: 'target_amount must be a positive number' });

    const result = db.prepare(
      'UPDATE savings_goals SET name=?,account_id=?,target_amount=?,target_date=? WHERE id=?'
    ).run(name.trim(), account_id ?? null, amt, target_date ?? null, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM savings_goals WHERE id=?').get(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM savings_goals WHERE id=?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  return router;
};
