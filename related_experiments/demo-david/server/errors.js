const { STATUS_CODES } = require('http');

// Status for errors that come from the request itself: a body the JSON parser
// rejects, an upload over the size limit, or a value SQLite refuses to store.
function clientErrorStatus(err) {
  const status = err.status ?? err.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) return status;
  if (err.name === 'MulterError') return err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  // better-sqlite3 cannot bind objects, arrays and other non-scalar request values:
  // it throws a TypeError for most of them and a RangeError for a plain object.
  // Compared by name because the error may come from another realm (Jest).
  if (err.name === 'TypeError' && err.message.startsWith('SQLite3 can only bind')) return 400;
  if (err.name === 'RangeError' && /parameter/i.test(err.message)) return 400;
  if (typeof err.code === 'string'
    && (err.code.startsWith('SQLITE_CONSTRAINT') || err.code === 'SQLITE_MISMATCH')) return 400;
  return null;
}

// Last middleware in the chain. Whatever went wrong, the client gets a short
// JSON body: no stack trace, no file paths, no SQL. The details stay in the log.
// It needs all four arguments for Express to treat it as an error handler.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = clientErrorStatus(err);
  if (status) {
    return res.status(status).json({ error: status === 400 ? 'Invalid request' : STATUS_CODES[status] });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler, clientErrorStatus };
