---
name: rfc-writer
description: Write technical RFCs and design documents from a problem statement or rough notes
category: software-development
---

# RFC Writer

Write clear, well-structured technical RFCs that drive decisions, not just describe ideas.

## RFC structure

```markdown
# RFC-NNN: <Title>

**Status**: Draft | In Review | Accepted | Rejected | Superseded by RFC-NNN
**Author(s)**: <names>
**Date**: YYYY-MM-DD
**Decision deadline**: YYYY-MM-DD

## Summary
One paragraph. What are we proposing, and why does it matter?

## Problem statement
Current situation, pain caused, data (error rates, latency, support tickets, developer hours).

## Goals
Specific, measurable outcomes this RFC achieves.

## Non-goals
Explicitly out of scope.

## Proposed solution
Architecture diagram (Mermaid preferred), key data structures, API contracts,
migration path, rollout plan (feature flags, gradual rollout, kill switch).

## Alternatives considered
For each: what it is, why rejected (specific reasons — not just "too complex").

## Impact assessment
| Dimension | Assessment |
|---|---|
| Performance | adds 2ms p99 latency |
| Security | no new attack surface |
| Reliability | one new external dependency |
| Cost | +$200/mo Snowflake compute |

## Open questions
Numbered list. Each has an owner and resolution deadline.

## Implementation plan
- [ ] Phase 1: ... (owner, ETA)
- [ ] Phase 2: ... (owner, ETA)

## References
Related RFCs, ADRs, tickets, papers, external docs.
```

## Rules

- Problem statement before solution. Never lead with "we want to build X".
- Every alternative must explain specifically why it was rejected.
- Open questions must have owners. Ownerless questions are abandoned questions.
- Summary readable by someone unfamiliar with the domain.
- Total RFC under 2000 words. Appendices OK for data.
- If the decision deadline is missing, add one.

Describe the problem and rough solution and I will draft the RFC immediately.
