---
name: log-triage
description: Triage application and system logs to find root causes, anomalies, and error patterns
category: ops
---

# Log Triage

Given logs, structured JSONL, or excerpts — identify errors, anomalies, and root causes quickly.

## What you do

1. **Parse** — identify format (plain text, JSON, syslog, nginx, k8s).
2. **Classify** — group by level (ERROR/WARN/INFO) and origin (service, host, pod).
3. **Correlate** — link errors by request ID, trace ID, or timestamp.
4. **Identify root cause** — find the first error in the causal chain.
5. **Summarise** — triage report with counts, timeline, top errors.

## Triage process

### Step 1 — Extract errors
```bash
# JSON logs
jq 'select(.level == "error" or .level == "fatal")' app.log | jq -c '{ts, msg, service, err}'
# Plain text
grep -E 'ERROR|FATAL|panic|exception' app.log | sort | uniq -c | sort -rn | head -20
```

### Step 2 — Find the first error (usually root cause)
```bash
grep -m1 -E 'ERROR|FATAL' app.log
```

### Step 3 — Correlate by request/trace ID
```bash
grep '"trace_id":"abc123"' *.log | sort -k1
```

### Step 4 — Count error frequency
```bash
jq -r 'select(.level=="error") | .msg' app.log | sort | uniq -c | sort -rn
```

## Common patterns

| Error pattern | Likely cause |
|---|---|
| `connection refused` on DB port | DB down or pool exhausted |
| `timeout` on upstream | Upstream slow or dead; check circuit breaker |
| `OOM killed` in k8s | Memory limit too low or memory leak |
| `too many open files` | File descriptor limit; check `ulimit -n` |
| `certificate has expired` | TLS cert needs renewal |
| `ECONNRESET` in Node.js | Client disconnected; benign unless spike |
| `deadlock detected` in Postgres | Competing transactions; check slow query log |

## Triage report format

```
LOG TRIAGE REPORT — <date>
Source: <file or service>
Time range: <start> → <end>

SUMMARY
  Total lines: N | ERROR: N | WARN: N | INFO: N

TOP ERRORS
  1. [N×] "message" — first seen <ts>
  2. [N×] "message" — first seen <ts>

ROOT CAUSE HYPOTHESIS
  First error at <ts>: "<message>"
  Caused by: <analysis>
  Likely trigger: <deploy/traffic/dependency>

RECOMMENDED ACTIONS
  1. ...
```

Paste the logs (or describe the file) and I will triage immediately.
