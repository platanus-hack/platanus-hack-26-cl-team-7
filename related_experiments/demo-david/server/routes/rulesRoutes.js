const express = require('express');
const { requireAuth } = require('../auth');

module.exports = function (db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    res.json(db.prepare(`
      SELECT r.*, c.name AS category_name
      FROM categorization_rules r
      JOIN categories c ON c.id = r.category_id
      ORDER BY r.created_at DESC
    `).all());
  });

  router.post('/', (req, res) => {
    const { keyword, category_id } = req.body;
    if (!keyword || typeof keyword !== 'string' || !keyword.trim())
      return res.status(400).json({ error: 'keyword required' });
    if (!category_id)
      return res.status(400).json({ error: 'category_id required' });
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id);
    if (!category)
      return res.status(400).json({ error: 'category not found' });
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO categorization_rules (keyword, category_id) VALUES (?,?)'
    ).run(keyword.trim(), category_id);
    res.status(201).json(db.prepare(`
      SELECT r.*, c.name AS category_name
      FROM categorization_rules r
      JOIN categories c ON c.id = r.category_id
      WHERE r.id = ?
    `).get(lastInsertRowid));
  });

  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM categorization_rules WHERE id = ?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  return router;
};
