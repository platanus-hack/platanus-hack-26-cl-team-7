// Keep the test run off the real data/budget.db. Modules that open the default
// database (db.js) get an in-memory one instead. Tests that need another value
// set DB_PATH themselves.
process.env.DB_PATH = ':memory:';
