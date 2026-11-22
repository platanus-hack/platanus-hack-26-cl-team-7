# Unknown attack type

No Reaper rule matched, so decide from the evidence. Do not force a playbook that does not fit.

## Method
1. Read the payload and path in the evidence rows. Name what the attacker tried: a changed id, a hidden path, a header, a large body, a repeated call.
2. Pick the closest OWASP Top 10:2025 category and CWE:
   - A different user's id or object works: A01:2025, CWE-639 or CWE-862 (missing object-level check).
   - An admin or debug path answers: A02:2025, CWE-16 (configuration), or A01:2025 for a missing role check.
   - A stack trace or odd 500 in the response: A10:2025, CWE-209 (error message with sensitive data).
   - Fast repeated calls to a costly route: A06:2025, CWE-770 (no limits on resource use).
   - Input that reaches an interpreter (shell, template, XML, LDAP): A05:2025, CWE-74 or the specific CWE.
3. Fix the check that is missing in code: authorization, validation, a limit, or a safe default.
4. If the logs do not show what the request did, set confidence to low and say what is missing in the explanation.

## Test the fix
Replay the attacker's request against the fixed endpoint. It must fail with 400, 403, 404 or 429, and must not return data or a 500.
