# Four-minute scoreboard walkthrough

From `ultimo-paso/`, generate the report from the three saved result files.

```sh
python3 -m scoreboard.report
```

Open `scoreboard/report.html`. All figures below come from the consolidated trials.

## 0:00–0:45 · What the proxy can observe

An HTTP response can tell an agent which action succeeded and what to try next.
The proxy can read that response before the client sees it. Point to the two
rows that measure different events. One records whether the backend executed.
The other records whether recognizable evidence reached the client.

## 0:45–1:30 · Mock bank

In all five direct scripted trials, the state check recorded a file read and
the response contained evidence. Through the proxy, the file read still
happened in all five trials. The client received evidence in zero. Across
25 protected benign requests, the evaluator recorded zero blocks.

## 1:30–2:15 · Langflow

In the in-band trial the evidence appeared in a later response to the same
client. Evidence reached the client in three of three direct trials and zero
of three protected trials. The state check recorded execution in all six.
The evaluator recorded zero blocks across nine protected benign requests.

## 2:15–3:15 · The agent’s next decision

For DeepSeek on the mock bank, show the response oracle first. Evidence reached
the client on both direct runs and neither protected run. The model declared
success on one direct run. Its declaration and the independent observation
answer different questions.

Across two runs per arm, requests went from 74 to 80 and completion tokens
from 9,514 to 26,155. The protected arm changed both the response and the
handling of later requests. These trials leave open how much either change
contributed to the model’s behavior.

## 3:15–4:00 · Where the defense ends

In the blind control, backend execution occurred in three of three trials
per arm. The operation produces no in-band evidence even on a direct
connection. The state check is what reveals the outcome here. Close with the
research question: how much does losing evidence change an agent’s ability
to finish a task whose next step depends on that evidence?
