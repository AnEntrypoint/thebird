---
name: systematic-debugging
description: "Apply systematic debugging methodology: reproduction, hypothesis, experiment, root cause, fix verification"
category: software-development
---

# Systematic Debugging

Do not guess. Form hypotheses, design experiments, eliminate candidates, converge on root cause through observation.

## The debugging loop

```
OBSERVE → HYPOTHESISE → EXPERIMENT → ELIMINATE → CONVERGE
```

Never skip to EXPERIMENT without OBSERVE. Never fix without CONVERGE.

## Phase 1: OBSERVE — reproduce the bug

1. Write a **reproduction recipe** — exact steps, inputs, environment.
2. Confirm **deterministic** (always fails) vs **intermittent** (% failure rate).
3. Find the **smallest reproduction** — strip everything not needed to trigger the bug.
4. Capture: error message, stack trace, logs, HTTP request/response, query.

## Phase 2: HYPOTHESISE — list candidate causes

Write every possible cause. Rank by:
- **Proximity** to the failure point
- **Recent changes** (last deploy, last config change)
- **Complexity** (more complex code = more places to hide bugs)

## Phase 3: EXPERIMENT — test one hypothesis at a time

```
Hypothesis: Redis is evicting sessions under memory pressure
Experiment: redis-cli INFO memory | grep used_memory_human; redis-cli MONITOR | grep DEL
Expected if TRUE: memory near maxmemory, DEL commands on session keys
Expected if FALSE: memory headroom, no unexpected DELs
Result: ...
```

**Never change two things at once.** One variable per experiment.

## Phase 4: ELIMINATE — cross off falsified hypotheses

- **FALSIFIED** — evidence rules it out
- **CONFIRMED** — evidence supports it
- **INCONCLUSIVE** — need more data

Stop when exactly one hypothesis is CONFIRMED and all others FALSIFIED.

## Phase 5: CONVERGE — fix at root cause

1. Write a **failing test** that reproduces the bug.
2. Implement the fix.
3. Confirm the test now passes.
4. Check for **similar bugs** in adjacent code.

## Debugging tools

| Situation | Tool |
|---|---|
| Slow code path | Profiler (node --prof, py-spy) |
| Memory leak | Heap snapshot (Chrome DevTools) |
| Network issue | tcpdump, curl -v |
| DB slow query | EXPLAIN ANALYZE |
| Race condition | Thread sanitiser, stress test |
| Intermittent failure | Log correlation by request ID |

## Rules

- **Never assume** — every assumption is an untested hypothesis.
- **Reproduce first** — if you can't reproduce it, say so.
- **Binary search** — midpoint log to halve the search space.
- **Read the error message** — 40% of bugs solved this way.
- **Check recent changes** — `git log --oneline -20` before anything else.
- **Take notes** — a session without notes wastes the next session.

Describe the bug (symptoms, error, stack trace, recent changes) and I will guide you through systematic diagnosis.
