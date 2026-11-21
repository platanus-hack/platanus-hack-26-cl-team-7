# Jailbreak

OWASP Top 10:2025: A05:2025 Injection by analogy. LLM Top 10: LLM01:2025 Prompt Injection (jailbreaks are a form of it). CWE-1427.

## Root cause
The assistant's safety limits live only in its prompt, so a role-play or "developer mode" text talks the model out of them. A jailbreak only harms when the model can do something harmful: use a tool, read data, or write text the app shows to others.

## Signals in the logs
- Payload with "DAN", "do anything now", "developer mode", "no restrictions", "pretend you are unfiltered".
- Status 200 means the assistant replied. The reply is not in the log: say so as a gap.
- A jailbreak followed by data requests: look at the prompt injection playbook too.

## Fix
1. Move every limit that matters into code: tool permissions, data access checks, output filters. The model's refusal is a second layer.
2. Remove capabilities the assistant does not need. No tool, no harm.
3. Check output before it is shown or acted on: schema validation, and a moderation or policy check for content the app must not return.
4. Rate limit the assistant route per user and cap prompt and answer length.
5. Log the full exchange with the user id and alert on repeated jailbreak patterns (A09:2025).

## Do not rely on
Longer system prompts, or a list of banned phrases.

## Test the fix
- Send a known jailbreak text. The reply may vary; the tool permissions and data access must not change. Assert that a forbidden tool call is denied.
- Send 30 assistant requests in a minute: later ones get 429.
- Output check test: a reply with content the policy forbids is replaced with a refusal message.
