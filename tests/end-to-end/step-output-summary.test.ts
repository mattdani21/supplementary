/**
 * The generation step log must stay small: the `synthesise_audio` step records a summary —
 * per-segment checksums, total byte size, segment count and storage keys — never the raw audio
 * payload. The audio bytes already live in object storage (the artefacts table holds each
 * segment's storage key + checksum), so persisting them again in `generation_steps.output`
 * turned a 7-day curriculum into 100+ MB of JSONB per run.
 *
 * Deterministic by construction: the in-memory repositories, the seeded math track and the fake
 * TTS provider — no network, no database, exactly like the compile-math-gap suite it sits beside.
 */

import { describe, expect, it } from 'vitest';
import type { OwnerId } from '@gapos/database';
import type { AudioSynthesisStepOutput } from '../../apps/worker/src/pipeline/compile.js';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import { compileSeededMathGap } from '../../scripts/compile-math-gap.js';

const OWNER: OwnerId = 'user_step_output';
/** A key of this suite's own, so it never collides with the GAP-033 acceptance compile. */
const IDEMPOTENCY_KEY = 'step-output-summary';

const buildContext = (): ServerContext => createServerContext({ logLevel: 'error' });

describe('the synthesise_audio step output is a small summary, not the audio payload', () => {
  it('records checksum, byte size, segment count and storage keys — never raw audio bytes', async () => {
    const context = buildContext();
    const summary = await compileSeededMathGap(context, OWNER, IDEMPOTENCY_KEY);

    const steps = await context.uow.generation.listSteps(OWNER, summary.runId);
    const audioSteps = steps.filter(
      (step) => step.step === 'synthesise_audio' && step.state === 'succeeded',
    );
    expect(audioSteps.length, 'every lesson records a synthesise_audio step').toBeGreaterThan(0);

    for (const step of audioSteps) {
      const output = step.output as AudioSynthesisStepOutput | undefined;
      expect(output, 'the step records an output summary').toBeDefined();
      const recorded = output as AudioSynthesisStepOutput;

      // Exactly the summary shape — nothing else, and certainly not an array of per-segment
      // payload objects carrying the audio buffer.
      expect(Object.keys(recorded).sort()).toEqual(['bytes', 'checksum', 'segments', 'storageKey']);

      expect(recorded.segments, 'the segment count is recorded').toBeGreaterThan(0);
      expect(recorded.bytes, 'the total byte size is recorded').toBeGreaterThan(0);
      expect(recorded.checksum, 'one checksum per segment').toHaveLength(recorded.segments);
      expect(recorded.storageKey, 'one storage key per segment').toHaveLength(recorded.segments);
      for (const checksum of recorded.checksum) {
        expect(typeof checksum).toBe('string');
      }

      // No raw audio payload in the log: the fake's stub envelope never appears, and the whole
      // serialized summary is a few hundred bytes — not a multi-megabyte blob.
      const serialized = JSON.stringify(recorded);
      expect(serialized).not.toContain('FAKE-AUDIO:');
      expect(serialized.length).toBeLessThan(10_000);
    }

    // Traceability: the recorded checksums and storage keys are exactly the artefacts table rows
    // for the same lesson, so the step log can verify what object storage holds.
    const lessons = await context.uow.curricula.listLessons(OWNER, summary.curriculumId);
    const dayOne = lessons.find((lesson) => lesson.day === 1);
    expect(dayOne, 'the course publishes a Day-1 lesson').toBeDefined();
    const audioArtefacts = (await context.uow.curricula.listArtefacts(OWNER, dayOne!.id))
      .filter((artefact) => artefact.kind === 'audio')
      .sort((a, b) => a.segmentOrdinal - b.segmentOrdinal);
    expect(audioArtefacts.length, 'Day 1 publishes audio segments').toBeGreaterThan(0);

    const dayOneStep = audioSteps.find((step) => step.subject === dayOne!.id);
    const dayOneOutput = dayOneStep?.output as AudioSynthesisStepOutput | undefined;
    expect(dayOneOutput, 'Day 1 records a synthesise_audio summary').toBeDefined();
    expect(dayOneOutput!.storageKey).toEqual(audioArtefacts.map((artefact) => artefact.storageKey));
    expect(dayOneOutput!.checksum).toEqual(audioArtefacts.map((artefact) => artefact.checksum));
  });
});
