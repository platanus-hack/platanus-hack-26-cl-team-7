const express = require('express');

module.exports = function (db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const start = Date.now();
    const checks = {};

    checks.server = { status: 'ok' };

    try {
      db.prepare('SELECT 1').get();
      checks.database = { status: 'ok' };
    } catch {
      checks.database = { status: 'fail' };
    }

    const allOk = Object.values(checks).every(c => c.status === 'ok');
    const httpStatus = allOk ? 200 : 503;

    const payload = {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
      responseTimeMs: Date.now() - start,
    };

    if (req.accepts(['json', 'html']) === 'json') {
      return res.status(httpStatus).json(payload);
    }

    const badgeColor = allOk ? '#16a34a' : '#dc2626';
    const badgeText = allOk ? 'OPERATIONAL' : 'DEGRADED';
    const checksHtml = Object.entries(checks)
      .map(([name, c]) => {
        const icon = c.status === 'ok' ? '✓ ok' : '✗ fail';
        const color = c.status === 'ok' ? '#16a34a' : '#dc2626';
        return `<tr><td>${name}</td><td style="color:${color}">${icon}</td></tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Budget App Status</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#111}
  .badge{display:inline-block;background:${badgeColor};color:#fff;font-size:1.4rem;font-weight:bold;padding:10px 24px;border-radius:6px;margin:16px 0}
  table{border-collapse:collapse;width:100%;margin-top:16px}
  td{padding:8px 12px;border-bottom:1px solid #e5e7eb}
  td:first-child{color:#6b7280}
  .meta{color:#6b7280;font-size:.875rem;margin-top:8px}
</style>
</head>
<body>
  <h1 style="margin-bottom:4px">Budget App</h1>
  <div class="badge">${badgeText}</div>
  <p class="meta">Checked: ${payload.timestamp}</p>
  <p class="meta">Response time: ${payload.responseTimeMs}ms</p>
  <table><tbody>${checksHtml}</tbody></table>
</body>
</html>`;

    res.status(httpStatus).type('html').send(html);
  });

  return router;
};
