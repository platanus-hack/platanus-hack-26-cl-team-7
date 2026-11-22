const request = require('supertest');
const { createTestApp } = require('./helpers');

function setup() {
  const { app, db } = createTestApp((app, db) => {
    app.use('/status', require('../routes/statusRoutes')(db));
  });
  return { app, db };
}

describe('GET /status', () => {
  test('returns 200 with status ok when DB is healthy', async () => {
    const { app } = setup();
    const res = await request(app)
      .get('/status')
      .set('Accept', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.server.status).toBe('ok');
    expect(res.body.checks.database.status).toBe('ok');
    expect(typeof res.body.responseTimeMs).toBe('number');
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('returns 503 with status degraded when DB throws', async () => {
    const brokenDb = {
      prepare: () => { throw new Error('DB unavailable'); }
    };
    const { app } = createTestApp((app) => {
      app.use('/status', require('../routes/statusRoutes')(brokenDb));
    });
    const res = await request(app)
      .get('/status')
      .set('Accept', 'application/json');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.server.status).toBe('ok');
    expect(res.body.checks.database.status).toBe('fail');
  });

  test('returns HTML when Accept is text/html', async () => {
    const { app } = setup();
    const res = await request(app)
      .get('/status')
      .set('Accept', 'text/html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Budget App');
    expect(res.text).toContain('OPERATIONAL');
  });
});
