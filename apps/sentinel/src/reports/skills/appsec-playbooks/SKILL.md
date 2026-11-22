---
name: appsec-playbooks
description: Use when proposing a code-level fix for a web attack seen in Reaper logs (SQL injection, XSS, path traversal, credential stuffing, prompt injection, jailbreak). One playbook per attack type with root cause, CWE, OWASP Top 10:2025 category, the fix and how to test it.
---

# AppSec playbooks

Source for the category list: OWASP Top 10:2025, https://top10.owasp.org/2025 (owasp.org/Top10/2025/ redirects there). Checked 2026-11-21.

## OWASP Top 10:2025 categories

- A01:2025 Broken Access Control
- A02:2025 Security Misconfiguration
- A03:2025 Software Supply Chain Failures
- A04:2025 Cryptographic Failures
- A05:2025 Injection
- A06:2025 Insecure Design
- A07:2025 Authentication Failures
- A08:2025 Software or Data Integrity Failures
- A09:2025 Security Logging and Alerting Failures
- A10:2025 Mishandling of Exceptional Conditions

Write the category as `A05:2025`, the CWE as `CWE-89`.

## Pick the playbook

Read the reference that matches the attack type with `skill_read`. Path is `references/<attack_type>.md`.

| Attack type | Reference | OWASP | Main CWE |
| --- | --- | --- | --- |
| sql_injection | references/sql_injection.md | A05:2025 | CWE-89 |
| xss | references/xss.md | A05:2025 | CWE-79 |
| path_traversal | references/path_traversal.md | A01:2025 | CWE-22 |
| credential_stuffing | references/credential_stuffing.md | A07:2025 | CWE-307 |
| prompt_injection | references/prompt_injection.md | A05:2025 | CWE-1427 |
| jailbreak | references/jailbreak.md | A05:2025 | CWE-1427 |
| unknown | references/unknown.md | decide from the evidence | decide from the evidence |

## Rules

- The evidence decides the endpoint, the parameter and the layer. A playbook only supplies the pattern.
- Fix the cause in code. A WAF rule, a blocklist or an escape of quotes is a stop-gap, never the main fix.
- Name the layer or the kind of function when you cannot see the file. Do not invent file names.
- The test request must be one that the fix makes fail. Give method, path, payload and the expected result.
