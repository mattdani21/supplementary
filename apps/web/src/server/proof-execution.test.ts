import { describe, expect, it, vi } from 'vitest';
import { createServerContext } from './context.js';
import { ProofExecutionUnavailableError } from './proof-execution.js';
import { arcLessonHandler, arcRunCellHandler } from './api.js';

describe('GAPX-03 proof execution gate', () => {
  it('returns 503 and does not invoke the executor when disabled', async () => {
    const context = createServerContext({ proofExecution: 'disabled' });
    const runCell = vi.spyOn(await import('../../../worker/src/notebook/executor.js'), 'runCell');

    await expect(
      arcRunCellHandler(context, 'owner', 'gap_1', { questionId: 'q1', code: '1' }),
    ).rejects.toBeInstanceOf(ProofExecutionUnavailableError);
    expect(runCell).not.toHaveBeenCalled();
    runCell.mockRestore();
  });

  it('still allows reading a saved lesson when execution is disabled', async () => {
    const context = createServerContext({ proofExecution: 'disabled' });
    await context.uow.users.create({
      id: 'owner',
      email: 'owner@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    await expect(arcLessonHandler(context, 'owner', 'missing')).rejects.toMatchObject({
      code: 'gap_not_found',
    });
  });
});
