const path = require('path');

const ENV_KEYS = ['NODE_ENV', 'JWT_SECRET', 'PORT', 'DB_PATH'];
const saved = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  jest.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('server config', () => {
  test('defaults to port 3111 and data/budget.db', () => {
    const config = require('../config');
    expect(config.PORT).toBe(3111);
    expect(config.DB_PATH).toBe(path.join(__dirname, '../../data/budget.db'));
  });

  test('reads PORT, DB_PATH and JWT_SECRET from the environment', () => {
    process.env.PORT = '4000';
    process.env.DB_PATH = '/tmp/other.db';
    process.env.JWT_SECRET = 'from-env';
    const config = require('../config');
    expect(config.PORT).toBe(4000);
    expect(config.DB_PATH).toBe('/tmp/other.db');
    expect(config.JWT_SECRET).toBe('from-env');
  });

  test('generates a random secret when unset outside production', () => {
    const first = require('../config').JWT_SECRET;
    jest.resetModules();
    const second = require('../config').JWT_SECRET;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
  });

  test('refuses to start in production without JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    expect(() => require('../config')).toThrow(/JWT_SECRET/);
  });

  test('starts in production when JWT_SECRET is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'from-env';
    expect(require('../config').JWT_SECRET).toBe('from-env');
  });
});
