# Cross-site scripting (XSS)

OWASP Top 10:2025: A05:2025 Injection. CWE-79 (cross-site scripting). Stored XSS also touches CWE-116 (output encoding).

## Root cause
User text is put into an HTML page, attribute or script without encoding for that context. A `<script>` tag, `onerror=` or `javascript:` URL then runs in other users' browsers.

## Signals in the logs
- Payload with `<script>`, `onerror=`, `onload=`, `javascript:`, `<svg`.
- A POST that stores text (comment, profile, message) followed by GETs of the page that shows it: stored XSS.
- A reflected payload in a query string that a page prints back.
- The log shows the request only. Whether it ran in a browser is a gap.

## Fix
1. Encode on output for the context: HTML body, attribute, JavaScript, URL. Use the template engine's auto-escape and keep it on.
2. Remove raw HTML sinks: `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `|safe`. Use text nodes.
3. When rich text is a requirement, sanitize with an allowlist sanitizer (DOMPurify or the server equivalent) at render time.
4. Validate length and type on input, but never treat it as the defense.
5. Add a Content-Security-Policy without `unsafe-inline`, and `HttpOnly` plus `SameSite` on session cookies. These limit damage; they do not fix the sink.

## Do not rely on
Stripping `<script>` with a regex, or a blocklist of event names.

## Test the fix
- Store `<script>alert(1)</script>` through the write endpoint, then GET the page. The response holds `&lt;script&gt;`, not a tag.
- `?q="><img src=x onerror=alert(1)>` comes back encoded in the attribute.
- A component test renders the stored text and asserts no `script` element exists.
