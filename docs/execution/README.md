# GapOS / Arc execution package

Reviewed 2026-09-05 against `90885116e5ba9ff0d5feb214631e5b1970abfc1d` on `main`. This is a source review and a proposed delivery plan. A specification describes intended behavior; it does not establish that the behavior already exists. Recorded historical results are not new measurements.

## Read in this order

1. Repository instructions at the root, then [Intent](INTENT.md).
2. [Current code and context](CONTEXT.md), including the verification limits.
3. [Roadmap](ROADMAP.md) to select a dependency-ready work packet.
4. [Technical specification](TECHNICAL_SPEC.md) and the selected [work packet](WORK_PACKETS.md).

Existing product goals, ADRs, schemas and task evidence remain authoritative for their domains. These documents make the next work explicit; they do not silently retire an existing decision. Recheck the target branch and open PRs before executing an old packet.

## Developer and test pair

The coordinator hands both roles the same packet ID, base commit, acceptance criteria, permitted files and fixture contract. One implementer owns the code branch. The verifier independently derives failure cases from the specification and records its own observations. When two agents are unavailable, perform separate implementation and verification passes and disclose that independence was unavailable.

The implementer reads the named sources, reproduces the current behavior, changes only the assigned scope and hands over a commit plus commands. The verifier reads the contract before the implementation explanation, tests success and refusal/error paths, inspects the diff and returns `pass`, `changes_requested` or `blocked` against that exact commit. A test that never ran is `not_run`, never a pass. Do not mark an existing unmet gate complete merely because a packet's preparation is complete.

Use distinct branches/worktrees when executing concurrently. Packets with overlapping owned files run serially unless the coordinator explicitly partitions the edits. The coordinator integrates one reviewed change at a time, reruns the affected integration gate and reconciles status. Tests may add fixtures under their assigned test paths; shared configuration and schema edits have one owner.

## Handoff record

```yaml
packet_id: selected ID
base_commit: exact SHA
implementation_commit: exact SHA
acceptance_results: # one entry for every numbered criterion
  - criterion: AC1
    outcome: pass | fail | not_run
    command: exact command and working directory
    evidence: result or repository artifact path
changed_files: []
remaining_risks: []
verifier: independent reviewer identity or independence unavailable
verdict: pass | changes_requested | blocked
```

Keep test data synthetic and generated evidence free of credentials. Work packets authorize their stated code/document scope, not external sends, purchases, model training, production deployment or data migration. Respect the repository's existing authorization boundaries.

## Skills

Repository-scoped skills are in `.agents/skills/gapos-deliver/` and `.agents/skills/gapos-verify/`. Invoke the applicable skill with a packet ID. If the client does not discover repository skills, open its `SKILL.md` explicitly; no personal skill installation is required.

`tasks/backlog.yaml` is the existing controller plan and `tasks/status.json` records executed evidence. GAPX packet IDs are a proposed extension, deliberately distinct from existing GAP IDs. When a GAPX packet is selected for implementation, register it in those native files with its dependency state before work; do not create a second outcome ledger. Open PRs #14 (agent setup) and #15 (learner journey) existed at review time; reconcile overlap before execution.
