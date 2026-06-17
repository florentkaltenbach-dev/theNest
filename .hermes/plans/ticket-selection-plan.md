# Ticket Selection Plan

## 5 Steps to Choose the Next Safe Ticket

1. **Check WIP limits** — Verify both `Working` (max 2) and `Review` (max 2) lanes are under capacity. Stop if either is full.

2. **Query for ai-ready tickets** — Search Linear issues with `ai-ready` suitability label. Exclude `human-only` and `needs-spec` tickets.

3. **Filter by priority** — Among ai-ready candidates, identify highest priority based on Linear's priority field or order in board.

4. **Verify no blockers** — Confirm ticket has no `blocked` status modifier and all dependencies are satisfied.

5. **Branch using ticket's gitBranchName** — Extract the `gitBranchName` field from the chosen ticket and execute `git checkout -b <gitBranchName>` to begin work.