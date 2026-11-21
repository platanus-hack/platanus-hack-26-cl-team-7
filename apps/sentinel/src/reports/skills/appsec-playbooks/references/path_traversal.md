# Path traversal

OWASP Top 10:2025: A01:2025 Broken Access Control. CWE-22 (path traversal). Related: CWE-23, CWE-36.

## Root cause
A file path is built from user input, so `../` or `%2e%2e%2f` climbs out of the intended directory and reads files such as `/etc/passwd`.

## Signals in the logs
- Payload or path with `../../`, `..%2f`, `%2e%2e`, `/etc/passwd`, `boot.ini`, `/proc/self`.
- Status 200 with a large body on a traversal path: a file was read. Status 400, 403 or 404 is a failed attempt.
- Many different depths of `../`: the attacker is searching for the right depth.

## Fix
1. Do not build paths from user input. Map an id or a name to a file through a lookup the server owns.
2. When a path is unavoidable: resolve it (`realpath`, `path.resolve`), then check the result starts with the allowed base directory plus a separator. Reject otherwise with 400.
3. Decode once before the check. Reject any `%00`, backslash or encoded dot in the input.
4. Serve files from a directory with only public files. Run the app user without read access to system files.
5. For static files use the framework's static handler instead of a custom file route.

## Do not rely on
Removing `../` with a replace (`....//` survives), or checking only the raw string before decoding.

## Test the fix
- `GET /files/..%2f..%2f..%2fetc%2fpasswd` returns 400 or 404 and no file content.
- `GET /files/../../etc/passwd` and the double-encoded form `%252e%252e%252f` also fail.
- A unit test of the path function asserts that `resolve(base, input)` outside `base` throws.
