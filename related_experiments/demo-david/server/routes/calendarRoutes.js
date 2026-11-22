const express = require('express');
const { requireAuth } = require('../auth');

module.exports = function (db) {
  const router = express.Router();
  router.use(requireAuth);

  // GET /calendar/:year/:month
  router.get('/:year/:month', (req, res) => {
    const y = parseInt(req.params.year);
    const m = parseInt(req.params.month);
    const today = new Date().toISOString().slice(0, 10);
    const daysInMonth = new Date(y, m, 0).getDate();
    const monthStart = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;

    // Actual transactions this month
    const actual = db.prepare(`
      SELECT t.*, c.name as category_name, a.name as account_name, a.type as account_type
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE strftime('%Y', t.date) = ? AND strftime('%m', t.date) = printf('%02d', ?)
      ORDER BY t.date, t.id
    `).all(String(y), m);

    // Find the most recent FULLY-COMPLETED month with recurring transactions.
    // Cap at the start of the current real month so we never use a partial month as the
    // source (transactions from the second half of the current month don't exist yet).
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const upperBound = monthStart < currentMonthStart ? monthStart : currentMonthStart;

    const sourceMonthRow = db.prepare(`
      SELECT strftime('%Y-%m', date) as ym
      FROM transactions
      WHERE is_recurring = 1 AND date < ?
      ORDER BY date DESC
      LIMIT 1
    `).get(upperBound);

    const projected = [];

    if (sourceMonthRow) {
      const sourceYm = sourceMonthRow.ym; // e.g. "2026-04"
      const [sy, sm] = sourceYm.split('-').map(Number);
      const sourceStart = sourceYm + '-01';
      const sourceEnd = new Date(sy, sm, 1).toISOString().slice(0, 10); // first of next month

      const sourceRecurring = db.prepare(`
        SELECT t.*, c.name as category_name, a.name as account_name, a.type as account_type
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE t.is_recurring = 1 AND t.date >= ? AND t.date < ?
        ORDER BY t.date DESC
      `).all(sourceStart, sourceEnd);

      const coveredDescs = new Set(actual.map(t => t.description));
      const seenDescs = new Set();

      for (const tx of sourceRecurring) {
        if (coveredDescs.has(tx.description)) continue;
        if (seenDescs.has(tx.description)) continue;
        seenDescs.add(tx.description);

        const day = Math.min(parseInt(tx.date.slice(8, 10)), daysInMonth);
        const projDate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        if (projDate >= today) {
          projected.push({ ...tx, id: `proj-${tx.id}-${y}-${m}`, date: projDate, projected: true });
        }
      }
    }

    res.json({ actual, projected });
  });

  return router;
};
