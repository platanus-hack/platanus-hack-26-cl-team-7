const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const ENV_KEYS = ['NODE_ENV', 'JWT_SECRET'];
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

function protectedApp() {
  const auth = require('../auth');
  const app = express();
  app.use(cookieParser());
  app.get('/private', auth.requireAuth, (req, res) => res.json({ userId: req.user.userId }));
  return { app, auth };
}

describe('JWT signing key', () => {
  test('tokens are signed with the configured secret', () => {
    process.env.JWT_SECRET = 'configured-secret';
    const { auth } = protectedApp();
    const token = auth.signToken(7);
    expect(jwt.verify(token, 'configured-secret').userId).toBe(7);
    expect(() => jwt.verify(token, 'another-secret')).toThrow();
  });

  test('a signed-in cookie is accepted', async () => {
    process.env.JWT_SECRET = 'configured-secret';
    const { app, auth } = protectedApp();
    const res = await request(app)
      .get('/private')
      .set('Cookie', `budget_token=${auth.signToken(3)}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(3);
  });

  test('a token signed with another secret is rejected', async () => {
    process.env.JWT_SECRET = 'configured-secret';
    const { app } = protectedApp();
    const forged = jwt.sign({ userId: 1 }, 'another-secret');
    const res = await request(app).get('/private').set('Cookie', `budget_token=${forged}`);
    expect(res.status).toBe(401);
  });

  test.each(['secret', 'changeme', 'dev-secret', 'jwt-secret'])(
    'with no JWT_SECRET a token signed with the guessable key "%s" is rejected',
    async guess => {
      const { app } = protectedApp();
      const forged = jwt.sign({ userId: 1 }, guess);
      const res = await request(app).get('/private').set('Cookie', `budget_token=${forged}`);
      expect(res.status).toBe(401);
    },
  );

  test('a request without a cookie is rejected', async () => {
    const { app } = protectedApp();
    expect((await request(app).get('/private')).status).toBe(401);
  });

  test('requiring the auth module in production without JWT_SECRET throws', () => {
    process.env.NODE_ENV = 'production';
    expect(() => require('../auth')).toThrow(/JWT_SECRET/);
  });

  test('the auth cookie is HttpOnly and SameSite=Strict', async () => {
    process.env.JWT_SECRET = 'configured-secret';
    const auth = require('../auth');
    const app = express();
    app.get('/set', (req, res) => { auth.setAuthCookie(res, auth.signToken(1)); res.end(); });
    const res = await request(app).get('/set');
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });
});
