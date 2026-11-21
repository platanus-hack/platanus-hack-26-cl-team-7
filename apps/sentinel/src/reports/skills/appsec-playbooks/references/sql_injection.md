# SQL injection

OWASP Top 10:2025: A05:2025 Injection. CWE-89 (SQL injection). Add CWE-209 or A10:2025 when the 500 shows a database error.

## Root cause
User input reaches a SQL string by concatenation or template. The database cannot tell data from code, so `UNION SELECT`, `' OR 1=1` or `; DROP TABLE` runs as SQL.

## Signals in the logs
- Payload with `UNION SELECT`, `' OR '1'='1`, `--`, `sleep(`, `xp_cmdshell`.
- Status 500 on the request: the query broke, so the input reached the database.
- Status 200 on a `UNION SELECT`: rows may have left. Treat as exploited.

## Fix
1. Use parameterized queries or a query builder with bound values at every data access call. Never build SQL with `+`, `${}` or `format`.
2. Parse typed inputs before the query: `id` becomes an integer, a date becomes a date. Reject anything else with 400.
3. Pick sort columns and table names from an allowlist. They cannot be bound as parameters.
4. Run the app database user with the least rights: no DDL, no access to other schemas, read-only where the route only reads.
5. Return a generic error. Log the database error server side, not in the response (A10:2025).

## Do not rely on
Escaping quotes (numeric context needs no quote), keyword blocklists, or a WAF alone.

## Test the fix
- `GET <endpoint>?<param>=1 UNION SELECT 1` must return 400 or an empty result, never rows from another table and never a 500.
- `<param>=1' OR '1'='1` returns the same as an unknown value.
- A unit test calls the data function with `"1; DROP TABLE users"` and asserts it is bound as a value.
