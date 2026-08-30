feat(arc): GAP-032 — Arc adaptive-learning UI over the real engine

The GapOS engine becomes the Arc app (founder spec docs/ARC-UI.md, visual
spec docs/prototypes/arc-skill-learning-prototype.html).

Screens (apps/web, /arc): Today, Skills, AI calibration, Skill map, Lesson
(theory + notebook), Progress, Profile — prototype design language, dark/light
from persisted preference, focus rings, aria labels, reduced-motion support;
root redirects to /arc, manifest start_url updated.

REAL, not demo (the prototype's static JS did not survive):
- Notebook proofs execute learner code server-side in a fresh node:vm realm
  (no host objects, 16K cell cap, 1s timeout, 4K output cap); checks are
  expressions evaluated in the same realm, correctness by execution; the
  reference solution is validated the same way by the independent verifier at
  generation time (code_proof question type, verifier + grading support).
- Audio: lesson page drives a real audio element on the compiled lesson's TTS
  artefact (play/pause, ±15s, 1x/1.25x/1.5x, waveform, transcript drawer).
- Calibration: real 3-step flow through provider adapters (arc_calibration
  contract, adaptive diagnostic: correct baseline -> 3 gaps / difficulty 3,
  miss -> 4 gaps / difficulty 1), persisted (migration 006 arc_calibrations),
  creates the real gap; answer key never leaves the server.
- Proofs record attempt + mastery evidence; proofs ledger reads mastery.
- Spaced review: Profile toggle gates the real due-review queue in Today
  without cancelling scheduling (learner_preferences, migration 006).

Specs/ops: openapi.yaml documents the /arc/* surface; generation schemas
regenerated; 4 new telemetry metrics; evaluation scorer understands code
proofs; docs/ARC-UI.md spec committed alongside.

Gate: pnpm verify 434 passed / 0 failed; arc-postgres e2e 2/2 on a real
Postgres; web build green. Evidence in tasks/status.json (GAP-032).

Known limitation: node:vm is not a hard security boundary; the sandbox is
caps-hardened for the learner surface but a production hardening pass should
move execution into a dedicated worker with OS-level isolation.
