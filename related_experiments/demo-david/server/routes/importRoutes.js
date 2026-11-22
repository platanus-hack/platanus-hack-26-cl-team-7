const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const crypto = require('crypto');
const fs = require('fs');
const { requireAuth } = require('../auth');

const upload = multer({ dest: require('os').tmpdir(), limits: { fileSize: 10 * 1024 * 1024 } });

function makeHash(date, amount, description) {
  return crypto.createHash('sha256')
    .update(`${date}|${amount}|${description}`)
    .digest('hex');
}

// Normalize various bank date formats to YYYY-MM-DD
function normalizeDate(raw) {
  if (!raw) return raw;
  const s = raw.trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  // MM/DD/YYYY or DD/MM/YYYY (assume MM/DD)
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[1].padStart(2,'0')}-${slash[2].padStart(2,'0')}`;
  return s;
}

module.exports = function (db) {
  const router = express.Router();
  router.use(requireAuth);

  // POST /import/parse — upload CSV, return headers + all rows with hashes
  router.post('/parse', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const raw = fs.readFileSync(req.file.path, 'utf-8')
        .replace(/^\uFEFF/, ''); // strip UTF-8 BOM
      // Skip leading non-CSV lines (bank metadata before the actual header row)
      const lines = raw.split('\n');
      const firstCsvLine = lines.findIndex(l => l.includes(','));
      const content = firstCsvLine > 0 ? lines.slice(firstCsvLine).join('\n') : raw;
      const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
      const headers = records.length ? Object.keys(records[0]) : [];
      const preview = records.slice(0, 5);
      // Return all rows as-is (no hash yet — mapping unknown at parse time)
      const rows = records.map(row => ({ ...row }));
      res.json({ headers, preview, rows });
    } catch (e) {
      res.status(400).json({ error: 'Failed to parse CSV: ' + e.message });
    } finally {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // The upload may already be gone; nothing else to clean up.
      }
    }
  });

  // POST /import/suggest — match descriptions against existing categorized transactions
  router.post('/suggest', (req, res) => {
    const { descriptions } = req.body;
    if (!Array.isArray(descriptions)) return res.status(400).json({ error: 'descriptions array required' });

    const rules = db.prepare('SELECT * FROM categorization_rules').all();

    const categorized = db.prepare(`
      SELECT description, category_id, COUNT(*) as freq
      FROM transactions
      WHERE category_id IS NOT NULL AND description IS NOT NULL
      GROUP BY lower(description), category_id
      ORDER BY freq DESC
    `).all();

    const suggestions = {};
    for (const desc of descriptions) {
      if (!desc || typeof desc !== 'string') continue;
      const lower = desc.toLowerCase();

      // 1. Rules take priority
      const ruleMatch = rules.find(r => lower.includes(r.keyword.toLowerCase()));
      if (ruleMatch) {
        suggestions[desc] = ruleMatch.category_id;
        continue;
      }

      // 2. Exact match from history
      let match = categorized.find(r => r.description.toLowerCase() === lower);
      // 3. Substring match from history
      if (!match) {
        match = categorized.find(r => {
          const rl = r.description.toLowerCase();
          return lower.includes(rl) || rl.includes(lower);
        });
      }
      if (match) suggestions[desc] = match.category_id;
    }

    res.json({ suggestions });
  });

  // POST /import/confirm — save mapped transactions, skip duplicates
  router.post('/confirm', (req, res) => {
    const { rows, mapping, account_id, assignments = [] } = req.body;
    if (!rows || !mapping) return res.status(400).json({ error: 'rows and mapping required' });
    if (!Array.isArray(rows) || typeof mapping !== 'object')
      return res.status(400).json({ error: 'rows must be an array and mapping an object' });

    const { date: dateCol, amount: amtCol, description: descCol } = mapping;
    // assignments use row index as key
    const assignMap = Object.fromEntries(assignments.map(a => [a.index, a.category_id]));

    // Load recurring transactions for auto-categorization
    const recurring = db.prepare(
      'SELECT description, category_id FROM transactions WHERE is_recurring=1'
    ).all();

    const rules = db.prepare('SELECT * FROM categorization_rules').all();

    const insertTx = db.prepare(
      'INSERT OR IGNORE INTO transactions (date,amount,description,category_id,account_id,source,is_recurring,import_hash) VALUES (?,?,?,?,?,?,?,?)'
    );

    let inserted = 0;
    let duplicates = 0;

    db.transaction(() => {
      for (const [rowIndex, row] of rows.entries()) {
        if (!row || typeof row !== 'object') continue;
        const date = normalizeDate(row[dateCol]);
        const amount = parseFloat(row[amtCol]);
        const description = row[descCol]?.trim();
        if (!date || isNaN(amount) || !description) continue;

        const hash = makeHash(date, amount, description);

        // Determine category: check assignments first, then auto-categorize from rules, then recurring
        let categoryId = assignMap[rowIndex] ?? null;
        let isRecurring = 0;
        if (!categoryId) {
          const lower = description.toLowerCase();
          const ruleMatch = rules.find(r => lower.includes(r.keyword.toLowerCase()));
          if (ruleMatch) {
            categoryId = ruleMatch.category_id;
          } else {
            const match = recurring.find(r =>
              lower.includes(r.description.toLowerCase())
            );
            if (match) {
              categoryId = match.category_id;
              isRecurring = 1;
            }
          }
        }

        const result = insertTx.run(date, amount, description, categoryId, account_id || null, 'imported', isRecurring, hash);
        if (result.changes) inserted++;
        else duplicates++;
      }
    })();

    res.json({ inserted, duplicates });
  });

  return router;
};
