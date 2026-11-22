const crypto = require('crypto');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

// JWT signing key comes from the environment. Locally a random key is generated
// at start (sessions end when the server restarts); production refuses to start
// without one.
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProduction) {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  jwtSecret = crypto.randomBytes(32).toString('hex');
}

module.exports = {
  PORT: Number(process.env.PORT) || 3111,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../data/budget.db'),
  JWT_SECRET: jwtSecret,
  isProduction,
};
