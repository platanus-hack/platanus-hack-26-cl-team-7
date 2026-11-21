const express = require('express');
const bcrypt = require('bcrypt');
const { signToken, requireAuth, setAuthCookie, clearAuthCookie } = require('../auth');

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72; // bcrypt ignores everything after 72 bytes

module.exports = function (db) {
  const router = express.Router();

  router.post('/signup', (req, res) => {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim();
    if (!USERNAME_PATTERN.test(name))
      return res.status(400).json({ error: 'Username must be 3 to 32 letters, numbers, dots, dashes or underscores' });
    if (password.length < PASSWORD_MIN_LENGTH)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (Buffer.byteLength(password) > PASSWORD_MAX_BYTES)
      return res.status(400).json({ error: 'Password is too long' });

    const taken = () => res.status(409).json({ error: 'Username already taken' });
    if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(name)) return taken();
    let userId;
    try {
      userId = db.prepare('INSERT INTO users (username, password_hash) VALUES (?,?)')
        .run(name, bcrypt.hashSync(password, 12)).lastInsertRowid;
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return taken();
      throw err;
    }
    setAuthCookie(res, signToken(Number(userId)));
    res.status(201).json({ ok: true });
  });

  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'Username and password required' });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });
    setAuthCookie(res, signToken(user.id));
    res.json({ ok: true });
  });

  router.post('/logout', requireAuth, (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?')
      .get(req.user.userId);
    res.json(user);
  });

  router.put('/password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || typeof currentPassword !== 'string' || typeof newPassword !== 'string')
      return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!bcrypt.compareSync(currentPassword, user.password_hash))
      return res.status(401).json({ error: 'Current password incorrect' });
    const hash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.userId);
    res.json({ ok: true });
  });

  return router;
};
