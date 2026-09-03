---
name: okr-drafter
description: Draft Objectives and Key Results from goals, strategy docs, or free-form priorities
category: planning
---

# OKR Drafter

Draft ambitious, measurable Objectives and Key Results aligned with strategy and trackable weekly.

## OKR fundamentals

- **Objective**: qualitative, inspiring, time-bound (one quarter). *What do we want to achieve?*
- **Key Result**: quantitative, binary-completable, max 3-5 per objective. *How do we know we achieved it?*
- **Initiative**: the work that drives KRs (not part of the OKR).

### Good vs bad KRs

| Bad (output) | Good (outcome) |
|---|---|
| Launch feature X | Feature X used by ≥30% of active users |
| Fix bugs | P1 bug resolution time <4 hours |
| Improve performance | p95 API latency <200ms for checkout |
| Write documentation | Docs CSAT score ≥4.2/5 |

## Process

1. Read the team's **mission** and **top 3 priorities for the quarter**.
2. Identify 2-4 **themes** from those priorities.
3. Draft one **Objective** per theme — active verbs, no jargon.
4. Draft 3-5 **Key Results** per Objective — each needs baseline, target, and unit.
5. Sanity-check: measurable today? Baseline known? Target ambitious but ≥70% confident?

## Output format

```
QUARTER: Q2 2026
TEAM: <team>

O1: Make our checkout experience the fastest in the industry
  KR1.1  p95 checkout latency: 800ms → 200ms
  KR1.2  Cart abandonment rate: 34% → 22%
  KR1.3  Lighthouse performance score for /checkout ≥ 90

O2: Build the foundation for self-serve onboarding
  KR2.1  Time-to-first-value: 3 days → 4 hours
  KR2.2  Support tickets from onboarding: 120/wk → 30/wk
  KR2.3  ≥80% of new accounts complete setup without human help
```

## Rules

- Objectives use active verbs: "Become", "Establish", "Deliver", "Eliminate".
- KRs are **outcomes**, never tasks or outputs.
- Every KR has a **from → to** metric or a binary milestone.
- Max 4 Objectives per team per quarter.
- No "increase engagement" without numbers.
- Flag any KR without a known baseline — it cannot be tracked.

Tell me the team name, quarter, and top priorities and I will draft OKRs immediately.
