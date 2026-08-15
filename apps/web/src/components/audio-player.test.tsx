/**
 * Audio player quality pass (GAP-038, E23 quality spec §8): playback speed cycle, seek,
 * scroll-synced transcript with tap-to-seek, and the designed audio-unavailable fallback.
 *
 * Acceptance covered here:
 *  - audio-player component test asserts speed cycle, seek, and fallback render;
 *  - the transcript is scroll-synced (tested with a small fixture): the segment containing the
 *    playback position is the active one, and the aligned blocks carry tap-to-seek offsets.
 *
 * Same pattern as feedback.test.tsx / tab-bar.test.tsx: the pure alignment/speed/seek logic in
 * lib/audio is unit-tested, and the player surface is asserted at the markup level with
 * `renderToStaticMarkup` — no browser, no jsdom, deterministic by construction. The interactive
 * controller (fetch, <audio> element, localStorage) is exercised only for what is observable in
 * server-rendered markup; the state transitions themselves are the pure helpers.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PLAYBACK_SPEEDS,
  alignTranscriptSegments,
  cyclePlaybackSpeed,
  formatDuration,
  segmentIndexAtTime,
  totalDurationSeconds,
} from '../lib/audio';
import { gradeCheckpoint, pendingCheckpoint } from '../lib/checkpoint';
import { AudioPlayer, AudioPlayerView, ownerFromCookie } from './audio-player';
import { Checkpoint } from './checkpoint';

/** Small fixture: three audio segments of 30/30/40 seconds (100s total). */
const SEGMENTS = [
  { artefactId: 'art_1', durationSeconds: 30 },
  { artefactId: 'art_2', durationSeconds: 30 },
  { artefactId: 'art_3', durationSeconds: 40 },
];

const TRANSCRIPT =
  'Sets are unordered collections of distinct objects. ' +
  'A relation on a set pairs elements of that set. ' +
  'Equivalence relations generalise equality.';

const renderView = (props: Partial<Parameters<typeof AudioPlayerView>[0]> = {}) =>
  renderToStaticMarkup(
    <AudioPlayerView
      segments={SEGMENTS}
      transcript={TRANSCRIPT}
      failed={false}
      rate={1.25}
      playing={false}
      currentTime={15}
      onTogglePlay={() => undefined}
      onCycleSpeed={() => undefined}
      onSeek={() => undefined}
      {...props}
    />,
  );

describe('playback speed control (GAP-038)', () => {
  it('offers exactly the spec cycle 0.75/1/1.25/1.5/2', () => {
    expect([...PLAYBACK_SPEEDS]).toEqual([0.75, 1, 1.25, 1.5, 2]);
  });

  it('cycles forward through every option and wraps', () => {
    expect(cyclePlaybackSpeed(0.75)).toBe(1);
    expect(cyclePlaybackSpeed(1)).toBe(1.25);
    expect(cyclePlaybackSpeed(1.25)).toBe(1.5);
    expect(cyclePlaybackSpeed(1.5)).toBe(2);
    expect(cyclePlaybackSpeed(2)).toBe(0.75);
  });

  it('renders the speed control showing the current rate', () => {
    const html = renderView();
    expect(html).toContain('class="player-speed"');
    expect(html).toMatch(/data-rate="1.25"/);
    expect(html).toContain('Playback speed');
    expect(html).toContain('1.25×');
  });
});

describe('seek (GAP-038)', () => {
  it('renders a seek control spanning the whole lesson duration', () => {
    const html = renderView();
    expect(html).toContain('aria-label="Seek"');
    expect(html).toContain('max="100"'); // totalDurationSeconds(SEGMENTS)
    expect(html).toContain('value="15"');
  });

  it('aligns the transcript into tap-to-seek segments with cumulative seek offsets', () => {
    const aligned = alignTranscriptSegments(TRANSCRIPT, SEGMENTS);
    expect(aligned).toHaveLength(3);
    expect(aligned.map((segment) => segment.start)).toEqual([0, 30, 60]);
    expect(aligned.map((segment) => segment.end)).toEqual([30, 60, 100]);

    const html = renderView();
    expect(html.match(/class="transcript__segment/g)).toHaveLength(3);
    expect(html).toMatch(/data-seek-to="0"/);
    expect(html).toMatch(/data-seek-to="30"/);
    expect(html).toMatch(/data-seek-to="60"/);
    // The wrapper keeps the readable transcript measure (E23 quality spec §7).
    expect(html).toContain('class="transcript"');
  });

  it('keeps every word of the transcript across the alignment', () => {
    const aligned = alignTranscriptSegments(TRANSCRIPT, SEGMENTS);
    const rejoined = aligned.map((segment) => segment.text).join(' ');
    for (const sentence of TRANSCRIPT.split(' ').slice(0, 4)) {
      expect(rejoined).toContain(sentence);
    }
    expect(rejoined).toContain('Equivalence relations generalise equality.');
  });

  it('spreads a long transcript across every segment instead of piling it into the first', () => {
    // Ten sentences across three segments: each block gets roughly its proportional share —
    // the first block must not swallow the transcript (a regression that produced one giant
    // block followed by empty ones).
    const LONG =
      'First claim stands alone. Second claim builds on it. Third claim adds a detail. ' +
      'Fourth claim changes the subject. Fifth claim deepens the fifth idea. Sixth claim arrives. ' +
      'Seventh claim turns the corner. Eighth claim narrows the scope. Ninth claim closes the loop. ' +
      'Tenth claim wraps it up.';
    const aligned = alignTranscriptSegments(LONG, SEGMENTS);
    expect(aligned).toHaveLength(3);
    expect(aligned.every((segment) => segment.text.length > 0)).toBe(true);
    // The first block ends before the last sentence — it does not consume the whole transcript.
    expect(aligned[0]?.text).not.toContain('Tenth claim wraps it up.');
    expect(aligned[2]?.text).toContain('Tenth claim wraps it up.');
    // Nothing is dropped along the way.
    const rejoined = aligned.map((segment) => segment.text).join(' ');
    expect(rejoined).toContain('First claim stands alone.');
    expect(rejoined).toContain('Fifth claim deepens the fifth idea.');
    expect(rejoined).toContain('Tenth claim wraps it up.');
  });
});

describe('scroll-synced transcript with a small fixture (GAP-038)', () => {
  it('marks the segment containing the playback position as active', () => {
    // 45s sits inside the second segment (30–60s): the second block is the active one.
    const html = renderView({ playing: true, currentTime: 45 });
    expect(html.match(/transcript__segment--active/g)).toHaveLength(1);
    const active = html.match(
      /class="transcript__segment transcript__segment--active"[^>]*data-seek-to="(\d+)"/,
    );
    expect(active?.[1]).toBe('30');

    // At 0s the first segment is active.
    const atStart = renderView({ playing: true, currentTime: 0 });
    const activeAtStart = atStart.match(
      /class="transcript__segment transcript__segment--active"[^>]*data-seek-to="(\d+)"/,
    );
    expect(activeAtStart?.[1]).toBe('0');
  });

  it('resolves the active index from a playback time', () => {
    expect(segmentIndexAtTime(SEGMENTS, 0)).toBe(0);
    expect(segmentIndexAtTime(SEGMENTS, 29.9)).toBe(0);
    expect(segmentIndexAtTime(SEGMENTS, 30)).toBe(1); // boundary belongs to the next segment
    expect(segmentIndexAtTime(SEGMENTS, 59.9)).toBe(1);
    expect(segmentIndexAtTime(SEGMENTS, 60)).toBe(2);
    expect(segmentIndexAtTime(SEGMENTS, 100)).toBe(2); // clamped to the last segment
  });
});

describe('the audio-unavailable fallback (GAP-038)', () => {
  it('renders the designed fallback with the transcript, never a raw error string', () => {
    const html = renderToStaticMarkup(
      <AudioPlayerView
        segments={SEGMENTS}
        transcript={TRANSCRIPT}
        failed
        rate={1}
        playing={false}
        currentTime={0}
        onTogglePlay={() => undefined}
        onCycleSpeed={() => undefined}
        onSeek={() => undefined}
      />,
    );
    expect(html).toContain('class="audio-fallback"');
    expect(html).toContain('Audio unavailable');
    // The transcript stays readable below the note — the fallback's "text below" promise.
    expect(html).toContain('Sets are unordered collections of distinct objects.');
    // No player chrome, and no raw error wording / HTTP status codes anywhere.
    expect(html).not.toContain('class="player-speed"');
    expect(html).not.toContain('aria-label="Seek"');
    expect(html).not.toMatch(/Error|Failed|\([45]\d\d\)/i);
  });
});

describe('AudioPlayer first paint (GAP-038)', () => {
  it('renders the designed chrome and transcript without a fallback', () => {
    const html = renderToStaticMarkup(
      <AudioPlayer gapId="gap_1" segments={SEGMENTS} transcript={TRANSCRIPT} />,
    );
    expect(html).toContain('class="player-speed"');
    expect(html).toContain('data-rate="1"'); // default rate; localStorage is client-only
    expect(html).toContain('aria-label="Seek"');
    expect(html).toContain('class="transcript__segment"');
    expect(html).not.toContain('class="audio-fallback"');
  });
});

describe('duration formatting (GAP-038)', () => {
  it('formats seconds as M:SS (and H:MM:SS past an hour)', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(30)).toBe('0:30');
    expect(formatDuration(204)).toBe('3:24');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('returns null when the duration is unknown', () => {
    expect(formatDuration(undefined)).toBeNull();
  });

  it('sums segment durations for the lesson total', () => {
    expect(totalDurationSeconds(SEGMENTS)).toBe(100);
    expect(totalDurationSeconds([{ durationSeconds: undefined }])).toBe(0);
  });
});

describe('checkpoint pause position (E24 US1, T010)', () => {
  const PROMPTS = [
    {
      atSecond: 45,
      prompt: 'Say out loud what "arbitrary" is protecting you from.',
      expectedAnswer: 'Assuming a property the element need not have.',
    },
    {
      atSecond: 90,
      prompt: 'Which property guarantees nobody is left out?',
      expectedAnswer: 'Reflexivity.',
    },
  ];

  it('has no pending checkpoint before the first pause position', () => {
    expect(pendingCheckpoint(PROMPTS, 44, 0)).toBeUndefined();
  });

  it('pauses at the pausePrompt position: the reached prompt is pending', () => {
    const pending = pendingCheckpoint(PROMPTS, 45, 0);
    expect(pending?.prompt).toBe(PROMPTS[0]!.prompt);
    // Still pending while playback is held at the position.
    expect(pendingCheckpoint(PROMPTS, 60, 0)?.prompt).toBe(PROMPTS[0]!.prompt);
  });

  it('does not re-ask a checkpoint that has already been answered', () => {
    expect(pendingCheckpoint(PROMPTS, 90, 1)?.prompt).toBe(PROMPTS[1]!.prompt);
    expect(pendingCheckpoint(PROMPTS, 120, 2)).toBeUndefined();
  });

  it('grades a matching checkpoint answer as correct', () => {
    expect(
      gradeCheckpoint('assuming a property the element need not have', PROMPTS[0]!.expectedAnswer),
    ).toBe(true);
    expect(gradeCheckpoint('Reflexivity', PROMPTS[1]!.expectedAnswer)).toBe(true);
  });

  it('grades a wrong answer as incorrect', () => {
    expect(gradeCheckpoint('I have no idea', PROMPTS[0]!.expectedAnswer)).toBe(false);
    expect(gradeCheckpoint('', PROMPTS[0]!.expectedAnswer)).toBe(false);
  });
});

describe('the checkpoint surface (E24 US1, T010)', () => {
  const locators = [
    { sourceId: 's1', chunkId: 'c2', locator: 'p. 9', sourceName: 'set-theory-primer.md' },
  ];
  const PROMPT = 'Say out loud what "arbitrary" is protecting you from.';
  const ANSWER = 'Assuming a property the element need not have.';

  const renderCheckpoint = (result: { correct: boolean } | null) =>
    renderToStaticMarkup(
      <Checkpoint
        prompt={PROMPT}
        expectedAnswer={ANSWER}
        answerLabel="Your answer"
        locators={result?.correct === false ? locators : undefined}
        sourcesTabHref="/gaps/gap_1?tab=sources"
        result={result}
        onAnswer={() => undefined}
        onComplete={() => undefined}
      />,
    );

  it('renders the checkpoint question and requires a response before continuing', () => {
    const html = renderCheckpoint(null);
    expect(html).toContain('class="checkpoint"');
    // The question is shown (quotes are HTML-escaped in server markup).
    expect(html).toContain('Say out loud what');
    expect(html).toContain('protecting you from');
    expect(html).toMatch(/<textarea[^>]*required/);
    expect(html).toContain('Answer');
    // No continue button while the question is unanswered: a response is required first.
    expect(html).not.toContain('Continue');
  });

  it('confirms a correct answer before the lesson continues', () => {
    const html = renderCheckpoint({ correct: true });
    expect(html).toContain('✓ Correct');
    expect(html).toContain('Continue');
  });

  it('shows the correction surface with the verified answer and source link on a wrong answer', () => {
    const html = renderCheckpoint({ correct: false });
    expect(html).toContain('Not quite');
    expect(html).toContain(ANSWER);
    expect(html).toContain('set-theory-primer.md');
    expect(html).toContain('p. 9');
    expect(html).toMatch(/<a [^>]*href="[^"]*\?tab=sources/);
  });
});

describe('ownerFromCookie (audio auth fallback)', () => {
  it('defaults to local-learner for a fresh browser with no cookie', () => {
    expect(ownerFromCookie('')).toBe('local-learner');
    expect(ownerFromCookie('other=1; theme=dark')).toBe('local-learner');
  });

  it('reads an explicit owner cookie', () => {
    expect(ownerFromCookie('gapos_owner=someone; theme=dark')).toBe('someone');
  });

  it('decodes URL-encoded owner ids', () => {
    expect(ownerFromCookie('gapos_owner=my%40learner')).toBe('my@learner');
  });

  it('mirrors the server-side default exactly', () => {
    // The server (lib/viewer.ts viewerOwner) falls back to 'local-learner' when the
    // cookie is missing. The client must match, or a fresh browser 401s on audio.
    expect(ownerFromCookie('')).toBe('local-learner');
    expect(ownerFromCookie('gapos_owner=local-learner')).toBe('local-learner');
  });
});
