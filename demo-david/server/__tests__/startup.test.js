const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

jest.setTimeout(60000);

const SERVER_DIR = path.join(__dirname, '..');
const CONFIG_KEYS = ['NODE_ENV', 'JWT_SECRET', 'PORT', 'DB_PATH'];

const running = [];
const tempDirs = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-startup-'));
  tempDirs.push(dir);
  return dir;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Runs `node index.js` the way `npm start` does, with only the given config set.
function launch(env) {
  const base = { ...process.env };
  for (const key of CONFIG_KEYS) delete base[key];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: { ...base, ...env },
  });

  const server = { output: '', port: Number(env.PORT) };
  server.exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  server.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no start within 20s:\n${server.output}`)), 20000);
    const collect = chunk => {
      server.output += chunk;
      if (server.output.includes('Server on port')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`server exited with code ${code}:\n${server.output}`));
    });
  });
  server.ready.catch(() => {});
  server.stop = async () => {
    child.kill('SIGTERM');
    await server.exited;
  };
  running.push(server);
  return server;
}

async function start(env) {
  const server = launch({ PORT: String(await freePort()), ...env });
  await server.ready;
  return server;
}

async function login(server) {
  const res = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'changeme' }),
  });
  return { res, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

function get(server, route, cookie) {
  return fetch(`http://127.0.0.1:${server.port}${route}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

afterEach(async () => {
  await Promise.all(running.splice(0).map(server => server.stop()));
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('first start with an empty database', () => {
  test('creates the database folder, loads the mock data and serves the documented login', async () => {
    const dbPath = path.join(tempDir(), 'nested', 'budget.db');
    const server = await start({ DB_PATH: dbPath });

    expect(server.output).toContain('Empty database: loaded mock data');
    expect(server.output).toContain(`Server on port ${server.port}`);
    expect(fs.existsSync(dbPath)).toBe(true);

    const status = await get(server, '/status');
    expect(status.status).toBe(200);

    const bad = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    expect(bad.status).toBe(401);

    const { res, cookie } = await login(server);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    const accounts = await (await get(server, '/api/accounts', cookie)).json();
    expect(accounts.length).toBeGreaterThan(0);
    const transactions = await (await get(server, '/api/transactions', cookie)).json();
    expect(JSON.stringify(transactions).length).toBeGreaterThan(100);
  });

  test('requires a login for the API', async () => {
    const server = await start({ DB_PATH: path.join(tempDir(), 'budget.db') });
    expect((await get(server, '/api/accounts')).status).toBe(401);
  });
});

describe('restart on an existing database', () => {
  test('does not load the mock data again', async () => {
    const dbPath = path.join(tempDir(), 'budget.db');
    const first = await start({ DB_PATH: dbPath });
    expect(first.output).toContain('Empty database: loaded mock data');
    await first.stop();

    const db = new Database(dbPath);
    db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('Added later', 'savings', 5)").run();
    const accountsBefore = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
    db.close();

    const second = await start({ DB_PATH: dbPath });
    expect(second.output).not.toContain('Empty database');
    const { cookie } = await login(second);
    const accounts = await (await get(second, '/api/accounts', cookie)).json();
    expect(accounts).toHaveLength(accountsBefore);
    expect(accounts.map(a => a.name)).toContain('Added later');
  });
});

describe('JWT secret', () => {
  test('without JWT_SECRET a fresh random secret is used on every start', async () => {
    const dbPath = path.join(tempDir(), 'budget.db');
    const first = await start({ DB_PATH: dbPath });
    const { cookie } = await login(first);
    expect((await get(first, '/api/auth/me', cookie)).status).toBe(200);
    await first.stop();

    const second = await start({ DB_PATH: dbPath });
    expect((await get(second, '/api/auth/me', cookie)).status).toBe(401);
  });

  test('with JWT_SECRET set, sessions survive a restart', async () => {
    const dbPath = path.join(tempDir(), 'budget.db');
    const env = { DB_PATH: dbPath, JWT_SECRET: 'secret-for-this-test' };
    const first = await start(env);
    const { cookie } = await login(first);
    await first.stop();

    const second = await start(env);
    expect((await get(second, '/api/auth/me', cookie)).status).toBe(200);
  });

  test('a different JWT_SECRET does not accept earlier sessions', async () => {
    const dbPath = path.join(tempDir(), 'budget.db');
    const first = await start({ DB_PATH: dbPath, JWT_SECRET: 'first-secret' });
    const { cookie } = await login(first);
    await first.stop();

    const second = await start({ DB_PATH: dbPath, JWT_SECRET: 'second-secret' });
    expect((await get(second, '/api/auth/me', cookie)).status).toBe(401);
  });
});

describe('production mode', () => {
  test('refuses to start without JWT_SECRET and creates no database', async () => {
    const dbPath = path.join(tempDir(), 'budget.db');
    const server = launch({ NODE_ENV: 'production', PORT: String(await freePort()), DB_PATH: dbPath });
    const code = await server.exited;
    expect(code).not.toBe(0);
    expect(server.output).toMatch(/JWT_SECRET must be set/);
    expect(server.output).not.toContain('Server on port');
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test('starts when JWT_SECRET is set', async () => {
    const dbPath = path.join(tempDir(), 'budget.db');
    const server = await start({ NODE_ENV: 'production', JWT_SECRET: 'production-test-secret', DB_PATH: dbPath });
    expect((await get(server, '/status')).status).toBe(200);
    const { res } = await login(server);
    expect(res.status).toBe(200);
  });
});

describe('port', () => {
  test('listens on the PORT from the environment', async () => {
    const port = await freePort();
    const server = await start({ PORT: String(port), DB_PATH: path.join(tempDir(), 'budget.db') });
    expect(server.port).toBe(port);
    expect((await get(server, '/status')).status).toBe(200);
  });
});

describe('error responses (documented local mode: NODE_ENV unset)', () => {
  const send = (server, route, body, cookie) => fetch(`http://127.0.0.1:${server.port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body,
  });

  // Nothing in an error answer may point at the machine: no stack frames, no file
  // paths (the server folder, the home folder), no SQL error text.
  async function expectCleanJson(res, status) {
    const text = await res.text();
    expect(res.status).toBe(status);
    expect(res.headers.get('content-type')).toMatch(/json/);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toMatch(/\n\s+at |node_modules|SqliteError|SyntaxError|CHECK constraint|<pre>/);
    expect(text).not.toContain(SERVER_DIR);
    expect(text).not.toContain(os.homedir());
    expect(text).not.toMatch(/\/Users\/|\/home\//);
    return JSON.parse(text);
  }

  test('malformed JSON without a session is a plain JSON 400', async () => {
    const server = await start({ DB_PATH: path.join(tempDir(), 'budget.db') });
    const body = await expectCleanJson(await send(server, '/api/auth/login', '{"username":'), 400);
    expect(body).toEqual({ error: 'Invalid request' });
  });

  test('data SQLite would refuse is a JSON 400, and the server keeps running', async () => {
    const server = await start({ DB_PATH: path.join(tempDir(), 'budget.db') });
    const { cookie } = await login(server);
    const bad = [
      ['/api/accounts', { name: 'Bad', type: 'brokerage' }],
      ['/api/categories', { name: 'Groceries', type: 'transfer' }],
      ['/api/debts', { name: 'Card', due_day: 40 }],
      ['/api/transactions', { date: '2026-05-01', amount: -1, description: 'x', category_id: 99999 }],
      ['/api/investments', { shares: 1, purchase_price: 1, purchase_date: '2026-05-01' }],
    ];
    for (const [route, data] of bad) {
      await expectCleanJson(await send(server, route, JSON.stringify(data), cookie), 400);
    }
    const paging = await get(server, '/api/transactions?limit=abc', cookie);
    await expectCleanJson(paging, 400);
    expect((await get(server, '/status')).status).toBe(200);
  });
});

describe('sign-up', () => {
  test('a new user can sign up, is signed in, and can log in again after the server restarts', async () => {
    const dbPath = path.join(tempDir(), 'budget.db');
    const env = { DB_PATH: dbPath, JWT_SECRET: 'signup-test-secret' };
    const first = await start(env);
    const created = await fetch(`http://127.0.0.1:${first.port}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'visitor', password: 'visitor-password' }),
    });
    expect(created.status).toBe(201);
    const cookie = (created.headers.get('set-cookie') || '').split(';')[0];
    expect((await get(first, '/api/auth/me', cookie)).status).toBe(200);
    await first.stop();

    const second = await start(env);
    const login = await fetch(`http://127.0.0.1:${second.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'visitor', password: 'visitor-password' }),
    });
    expect(login.status).toBe(200);
    expect(second.output).not.toContain('Empty database');
  });
});
