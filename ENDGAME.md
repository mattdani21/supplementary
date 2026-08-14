# ENDGAME — GapOS (takeover in flight)
**End state:** GAP BACKLOG DRAINED — the 12 ready tasks (GAP-020..GAP-031) done and merged to main.
- Each task: dsh-driven worktree card, commits on wt/gap-0xx, pnpm verify gate green, evidence in status.json
- Merge via the security-check gate (secret scan, dep audit, pnpm verify, diff hygiene)
- Old orchestrator contract fully replaced by the OS (AGENTS.md §3 loop = card instructions)

**Definition of done:** 0 ready GAP cards; all wt/gap-* merged; pnpm verify green on main.

**Overnight loop:** GAP cards drain one-per-profile; merge card follows.
**Never:** weakening a test to go green; skipping the security gate.
