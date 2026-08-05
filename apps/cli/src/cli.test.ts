/**
 * The scripted CLI session (GAP-025): new gap -> source -> compile -> study -> mastery, run
 * end to end in-process against the in-memory repositories — no server, no database. The same
 * commands the binary dispatches; the acceptance's "scripted session runs end to end without a
 * server".
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import { createServerContext, type ServerContext } from '../../web/src/server/context.js';
import type { CliIO } from './commands.js';
import {
  compileCommand,
  gapNew,
  masteryCommand,
  planCommand,
  sourceAdd,
  studyCommand,
} from './commands.js';

const collectIO = (): { io: CliIO; lines: string[]; answers: string[] } => {
  const lines: string[] = [];
  const answers: string[] = [];
  return {
    lines,
    answers,
    io: {
      out: (line: string) => lines.push(line),
      prompt: async (_question: string) => answers.shift() ?? '',
    },
  };
};

describe('the scripted CLI session (GAP-025)', () => {
  it('runs gap new -> source add -> compile -> plan -> study -> mastery end to end', async () => {
    const context: ServerContext = createServerContext({ logLevel: 'error' });

    // 1. gap new
    const created = collectIO();
    await gapNew(
      context,
      [
        '--title',
        'Relations and proof techniques',
        '--statement',
        REFERENCE_GAP_STATEMENT,
        '--minutes',
        '35',
      ],
      created.io,
    );
    const gapId = created.lines[0]!.split(' ')[1]!;
    expect(created.lines[0]).toContain('created');
    expect(gapId).toMatch(/^gap_/);

    // 2. source add
    const sourced = collectIO();
    await sourceAdd(context, [gapId, '--text', SET_THEORY_SOURCE], sourced.io);
    expect(sourced.lines[0]).toContain('added');

    // 3. compile
    const compiled = collectIO();
    await compileCommand(context, [gapId], compiled.io);
    expect(compiled.lines[0]).toContain('complete');

    // 4. plan
    const planned = collectIO();
    await planCommand(context, [gapId], planned.io);
    expect(planned.lines.some((l) => l.startsWith('plan:'))).toBe(true);
    expect(planned.lines.some((l) => l.includes('day 1'))).toBe(true);

    // 5. study — answer every question
    const studied = collectIO();
    studied.answers.push(
      'the union of equivalence classes is disjoint',
      'a partition of the set',
      'by applying the definition',
    );
    await studyCommand(context, [gapId], studied.io);
    expect(studied.lines.some((l) => l.startsWith('day 1:'))).toBe(true);
    expect(studied.lines.some((l) => l.startsWith('Q:'))).toBe(true);
    expect(studied.lines.some((l) => l.startsWith('correct') || l.startsWith('incorrect'))).toBe(
      true,
    );

    // 6. mastery
    const mastered = collectIO();
    await masteryCommand(context, [gapId], mastered.io);
    expect(mastered.lines[0]).toContain('mastery:');
  });
});
