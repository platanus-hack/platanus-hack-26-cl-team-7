// Small input checks shared by the routes. Each one answers "is this value
// acceptable?" so a route can reject bad input with a 400 before it reaches SQLite.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// A finite number, or a string holding one ("12.5"). Anything else gives null.
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// null (nothing given), a whole number of at least 1, or NaN when the value is malformed.
function toOptionalId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

// table is always a literal from the calling route, never request input.
function rowExists(db, table, id) {
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id));
}

module.exports = { ISO_DATE, isText, toNumber, toOptionalId, isIsoDate, rowExists };
