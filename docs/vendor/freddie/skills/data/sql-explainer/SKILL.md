---
name: sql-explainer
description: "Explain SQL queries, execution plans, and performance issues in plain English with rewrites"
category: data
---

# SQL Explainer

Explain SQL queries, analyse execution plans, identify performance bottlenecks, and suggest rewrites.

## Explanation format

For any query:

```
WHAT IT DOES (one sentence)

STEP BY STEP:
1. FROM / JOIN — which tables, join type and implications
2. WHERE — filters, sargability (can indexes be used?)
3. GROUP BY / HAVING — aggregation logic
4. SELECT — columns, computed expressions
5. ORDER BY / LIMIT — sort and pagination

EDGE CASES:
- NULLs: which columns and how they affect results
- Empty sets: what happens if a subquery returns no rows
- Duplicates: expected or a bug?

PERFORMANCE NOTES:
- Estimated scan type
- Columns that should have indexes
- Estimated row count at each stage
```

## EXPLAIN ANALYZE reading

- Highest **actual time** node = bottleneck.
- **rows estimated vs actual** divergence → stale statistics (`ANALYZE` needed).
- **Seq Scan on large table with filter** → missing index.
- **Hash Join with large hash** → may spill to disk; check `work_mem`.
- **Nested Loop on large outer, inner Seq Scan** → N+1; index the join key.

## Common rewrites

| Anti-pattern | Fix |
|---|---|
| `SELECT *` in subquery | Select only the join key |
| `NOT IN (subquery with NULLs)` | Use `NOT EXISTS` |
| Correlated subquery in SELECT | LEFT JOIN + COALESCE |
| `DISTINCT` hiding a bad join | Fix the join |
| `ORDER BY` on un-indexed column with small LIMIT | Index the sort column |

## Rules

- Always state the SQL dialect assumed (PostgreSQL, MySQL, SQLite, BigQuery, etc.).
- Never change query semantics in a rewrite without flagging the difference.
- If slow but correct, suggest `EXPLAIN ANALYZE` output before guessing at indexes.

Paste the query (and optionally DDL + EXPLAIN output) and I will explain immediately.
