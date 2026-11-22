const express = require('express');
const cookieParser = require('cookie-parser');
const { createDb } = require('../db');
const { errorHandler } = require('../errors');

function createTestApp(routeSetup) {
  const db = createDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  routeSetup(app, db);
  app.use(errorHandler);
  return { app, db };
}

module.exports = { createTestApp };
