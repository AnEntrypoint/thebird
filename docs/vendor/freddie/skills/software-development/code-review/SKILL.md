---
name: code-review
description: Perform thorough code reviews covering correctness, security, performance, readability, and test coverage
category: software-development
---

# Code Review

Perform rigorous, constructive code reviews. Flag real issues, suggest concrete fixes, acknowledge what is done well.

## Review dimensions (in order of severity)

### 1. CORRECTNESS
- Does the code do what the PR description claims?
- Off-by-one errors, wrong comparisons, wrong variable names?
- Async/await patterns correct? Error propagation complete?
- Null/undefined/empty cases handled?

### 2. SECURITY
- Injection: SQL, shell, HTML, path traversal
- Hardcoded secrets or tokens in logs
- Protected routes actually protected?
- User input validated at boundaries?
- New deps pinned? Known CVEs?

### 3. PERFORMANCE
- N+1 queries (loop that calls DB/API per iteration)
- Missing indexes for new query patterns
- Blocking calls in async context
- Large allocations in hot paths

### 4. READABILITY
- Names accurate and unambiguous?
- Functions ≤20 lines?
- Magic numbers replaced with named constants?
- Error handling consistent with codebase?

### 5. TESTS
- New behaviour covered?
- Tests assert outcomes, not implementation details?
- Error paths tested, not just happy path?
- Tests deterministic (no flaky sleeps, no ordering dependence)?

## Comment format

```
[BLOCKER] src/auth.js:42 — SQL built by string concatenation. Use: db.query('SELECT * FROM users WHERE id = $1', [id])

[SUGGESTION] src/api.js:88 — Loop calls getUserById() N times. Fetch all with WHERE id = ANY($1) and build a Map.

[NITPICK] src/util.js:15 — Variable name `d` is ambiguous. Use `date` or `deadline`.

[PRAISE] src/cache.js — Cache invalidation logic is clean; TTL=0 and concurrent write edge cases handled correctly.
```

Severity:
- **BLOCKER** — must fix before merge (bug, security, data loss)
- **SUGGESTION** — should fix, significant improvement
- **NITPICK** — optional, style/clarity
- **PRAISE** — acknowledge explicitly

## Rules

- File:line reference on every comment.
- Every BLOCKER includes a concrete fix.
- Do not nitpick formatting if there is a linter — reference the linter rule.
- Do not comment on code outside the diff unless the diff depends on it.
- End with: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION.

Paste the diff or describe the PR and I will review it.
