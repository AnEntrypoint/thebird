---
name: weekly-review
description: Facilitate a structured weekly review covering what shipped, blockers, decisions, and next week's priorities
category: planning
---

# Weekly Review

Facilitate a structured weekly review. Surface what matters, clear blockers, align on priorities.

## Review structure (45 minutes)

### 1. SHIPPED THIS WEEK (10 min)
Format: `[scope] description — impact`
Example: `[checkout] Reduced p95 latency 800ms → 210ms — unblocks Q2 KR1.1`

### 2. IN PROGRESS (5 min)
State + estimated completion date. Flag anything >50% over estimate.

### 3. BLOCKERS (10 min)
For each: what is blocked, who can unblock it, ETA.
Escalate anything blocked >2 days without a clear owner.

### 4. DECISIONS NEEDED (10 min)
Format: `[decision] options + recommendation + owner + deadline`

### 5. NEXT WEEK PRIORITIES (10 min)
Top 3-5 items, ranked by impact, with an owner.

## Output format

```
WEEKLY REVIEW — Week of 2026-04-28

SHIPPED
✓ [auth] Migrated session storage to Redis — reduces DB load 40%
✓ [infra] Upgraded k8s cluster to 1.29 — zero downtime

IN PROGRESS
→ [checkout] Payment provider migration — 60% done, ETA 2026-05-05
→ [data] ETL pipeline — blocked (see blockers)

BLOCKERS
⚠ ETL pipeline needs Snowflake credentials — owner: @alice, ETA: 2026-05-02
⚠ Design review for onboarding — waiting on design since 2026-04-25

DECISIONS NEEDED
? Monorepo vs multi-repo for mobile — recommend monorepo — owner: @bob — deadline: 2026-05-03

NEXT WEEK
1. Finish payment provider migration — @carol
2. Unblock ETL pipeline — @dave
3. Ship onboarding v2 to 10% of new signups — @eve
```

## Rules

- Shipped items: completed/shipped/merged only — no "worked on X".
- Blockers must have an owner and deadline, or they are risks not blockers.
- Decisions without a deadline are discussions not decisions.
- Next week: ≤5 priorities. Help rank and drop if the team lists more.
- Carry unresolved blockers from last week to the top of this week's list.

Paste last week's notes, Jira/Linear export, or describe what happened and I will produce the review.
