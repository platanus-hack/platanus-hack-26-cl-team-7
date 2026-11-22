const request = require('supertest');
const { createTestApp } = require('./helpers');
const { errorHandler, clientErrorStatus } = require('../errors');

// What must never reach a client: stack frames, absolute paths, SQL error names.
const LEAK = /\n\s+at |node_modules|\/Users\/|SqliteError|SyntaxError|CHECK constraint/;

function setup() {
  return createTestApp((app, db) => {
    app.post('/echo', (req, res) => res.json(req.body));
    app.get('/check-violation', () => {
      db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('x', 'bogus', 0)").run();
    });
    app.get('/unexpected', () => {
      throw new Error('secret detail at /Users/someone/project/file.js:1:1');
    });
  });
}

describe('final error handler', () => {
  let logged;
  beforeEach(() => { logged = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { logged.mockRestore(); });

  test('malformed JSON answers 400 with a short JSON body and no stack', async () => {
    const { app } = setup();
    const res = await request(app).post('/echo').set('Content-Type', 'application/json').send('{"username":');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual({ error: 'Invalid request' });
    expect(res.text).not.toMatch(LEAK);
    expect(logged).not.toHaveBeenCalled();
  });

  test('an oversized body answers 413 as JSON', async () => {
    const { app } = setup();
    const res = await request(app).post('/echo').send({ filler: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Payload Too Large' });
  });

  test('a SQLite constraint failure answers 400 without the SQL error text', async () => {
    const { app } = setup();
    const res = await request(app).get('/check-violation');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual({ error: 'Invalid request' });
    expect(res.text).not.toMatch(LEAK);
  });

  test('an unexpected error answers a generic 500 and is logged on the server', async () => {
    const { app } = setup();
    const res = await request(app).get('/unexpected');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toMatch(LEAK);
    expect(res.text).not.toContain('secret detail');
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0].message).toContain('secret detail');
  });

  test('hands the error on when the response has already started', () => {
    const err = new Error('late failure');
    const next = jest.fn();
    errorHandler(err, {}, { headersSent: true }, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('clientErrorStatus', () => {
  test.each([
    ['body-parser parse error', Object.assign(new SyntaxError('x'), { status: 400, type: 'entity.parse.failed' }), 400],
    ['unsupported content encoding', Object.assign(new Error('x'), { statusCode: 415 }), 415],
    ['upload over the size limit', Object.assign(new Error('x'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' }), 413],
    ['other upload error', Object.assign(new Error('x'), { name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE' }), 400],
    ['SQLite CHECK failure', Object.assign(new Error('x'), { code: 'SQLITE_CONSTRAINT_CHECK' }), 400],
    ['SQLite datatype mismatch', Object.assign(new Error('x'), { code: 'SQLITE_MISMATCH' }), 400],
    ['value SQLite cannot bind', new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null'), 400],
    ['plain object passed as a value', new RangeError('Too few parameter values were provided'), 400],
  ])('%s is a client error', (_label, err, status) => {
    expect(clientErrorStatus(err)).toBe(status);
  });

  test.each([
    ['a plain Error', new Error('boom')],
    ['a TypeError from our own code', new TypeError("Cannot read properties of null (reading 'x')")],
    ['a SQLite error that is not about the input', Object.assign(new Error('x'), { code: 'SQLITE_BUSY' })],
    ['an error that carries a 5xx status', Object.assign(new Error('x'), { status: 503 })],
  ])('%s is not', (_label, err) => {
    expect(clientErrorStatus(err)).toBeNull();
  });
});
