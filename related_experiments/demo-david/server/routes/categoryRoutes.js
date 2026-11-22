const express = require('express');
const { requireAuth } = require('../auth');
const { isText, toNumber } = require('../validate');

const CATEGORY_TYPES = ['income', 'expense'];

// Returns { values } for a valid body or { error } with the message for the 400.
function parseCategory(body, { allocationRequired }) {
  const { name, type, rollover = 0 } = body;
  const allocation = body.default_allocation === undefined && !allocationRequired ? 0 : body.default_allocation;
  if (!isText(name) || !type) return { error: 'name and type required' };
  if (!CATEGORY_TYPES.includes(type)) return { error: `type must be one of: ${CATEGORY_TYPES.join(', ')}` };
  const amount = toNumber(allocation);
  if (amount === null) return { error: 'default_allocation must be a number' };
  return { values: { name: name.trim(), type, default_allocation: amount, rollover: rollover ? 1 : 0 } };
}

module.exports = function (db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM categories').all());
  });

  router.post('/', (req, res) => {
    const { values, error } = parseCategory(req.body, { allocationRequired: false });
    if (error) return res.status(400).json({ error });
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO categories (name, type, default_allocation, rollover) VALUES (?,?,?,?)'
    ).run(values.name, values.type, values.default_allocation, values.rollover);
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id=?').get(lastInsertRowid));
  });

  router.put('/:id', (req, res) => {
    const { values, error } = parseCategory(req.body, { allocationRequired: true });
    if (error) return res.status(400).json({ error });
    const result = db.prepare(
      'UPDATE categories SET name=?, type=?, default_allocation=?, rollover=? WHERE id=?'
    ).run(values.name, values.type, values.default_allocation, values.rollover, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  return router;
};
