# Credential stuffing

OWASP Top 10:2025: A07:2025 Authentication Failures. CWE-307 (excessive authentication attempts). Related: CWE-287, CWE-521.

## Root cause
The login accepts unlimited attempts, so lists of leaked username and password pairs can be tried at speed. Reused passwords then give access.

## Signals in the logs
- Many failed logins from one IP in a short time (Reaper: 5 in 60 s).
- Many different usernames from one IP, or one password across many usernames (password spray).
- A 200 on `/login` among many 401s: one account may be taken over. The log does not show which account.

## Fix
1. Rate limit the login route per IP and per account, with a growing delay. Return 429 after the limit.
2. Lock or step up an account after repeated failures: a CAPTCHA or an email check, not a permanent lock that lets attackers lock out users.
3. Offer MFA and require it for sensitive accounts.
4. Reject passwords found in breach lists when users set them (CWE-521).
5. Give the same response and timing for an unknown user and a wrong password.
6. Log failed and successful logins with IP and account id, and alert on a success after many failures (A09:2025).

## Do not rely on
Blocking one IP only: the attack rotates addresses. Do it as an extra, not the fix.

## Test the fix
- Ten wrong logins for one account in one minute: the sixth and later get 429.
- A login for an unknown user and a known user with a wrong password return the same body and status.
- An integration test checks that a correct password after the limit is still refused until the delay ends.
