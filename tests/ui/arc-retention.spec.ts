import { expect, test, type APIRequestContext, type TestInfo } from '@playwright/test';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';

interface QuestionView {
  readonly id: string;
  readonly payload: {
    readonly type: 'multiple_choice' | 'short_answer' | 'worked_problem' | 'code_proof';
    readonly answer: string;
  };
}

const post = async (
  request: APIRequestContext,
  owner: string,
  path: string,
  data: object,
): Promise<Record<string, unknown>> => {
  const response = await request.post(path, {
    headers: { 'x-owner-id': owner },
    data,
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as Record<string, unknown>;
};

test('a filled gap is findable as a retained capability', async ({ context, page }, testInfo) => {
  test.setTimeout(90_000);
  const owner = `retention-${testInfo.project.name}-${testInfo.workerIndex}`;
  await context.addCookies([
    {
      name: 'gapos_owner',
      value: owner,
      url: 'http://127.0.0.1:3100',
      sameSite: 'Lax',
    },
  ]);

  const created = await post(page.request, owner, '/api/gaps', {
    title: 'Relations and proof techniques',
    rawStatement: REFERENCE_GAP_STATEMENT,
    dailyMinutes: 25,
    sourcePolicy: 'sources_only',
  });
  const gapId = (created.gap as { id: string }).id;
  await post(page.request, owner, `/api/gaps/${gapId}/transition`, { type: 'define' });
  await post(page.request, owner, `/api/gaps/${gapId}/sources`, {
    gapId,
    filename: 'retention-set-theory.md',
    mediaType: 'text/markdown',
    text: SET_THEORY_SOURCE,
  });
  await post(page.request, owner, `/api/gaps/${gapId}/compile`, {
    idempotencyKey: `retention-compile-${gapId}`,
  });

  const curriculumResponse = await page.request.get(`/api/gaps/${gapId}/curriculum`, {
    headers: { 'x-owner-id': owner },
  });
  expect(curriculumResponse.ok()).toBe(true);
  const { lessons } = (await curriculumResponse.json()) as {
    lessons: { day: number; questions: QuestionView[] }[];
  };
  const finalProof = lessons
    .find((lesson) => lesson.day === 3)!
    .questions.find((question) => question.payload.type === 'code_proof')!;

  for (const sessionId of ['retention-session-1', 'retention-session-2']) {
    for (const question of lessons.flatMap((lesson) => lesson.questions)) {
      if (sessionId.endsWith('2') && question.id === finalProof.id) continue;
      const key = `${sessionId}:${question.id}`;
      if (question.payload.type === 'code_proof') {
        await post(page.request, owner, `/api/arc/gaps/${gapId}/proofs`, {
          questionId: question.id,
          sessionId,
          code: question.payload.answer,
          idempotencyKey: key,
        });
      } else {
        await post(page.request, owner, `/api/gaps/${gapId}/attempts`, {
          questionId: question.id,
          sessionId,
          response: question.payload.answer,
          confidence: 'high',
          idempotencyKey: key,
        });
      }
    }
  }

  const filled = await post(page.request, owner, `/api/arc/gaps/${gapId}/proofs`, {
    questionId: finalProof.id,
    sessionId: 'retention-session-2',
    code: finalProof.payload.answer,
    idempotencyKey: 'retention-final-proof',
  });
  expect((filled.proof as { filled: boolean }).filled).toBe(true);

  await page.goto('/arc/skills');
  await page.getByRole('searchbox', { name: 'Search your skills' }).fill('Relations');
  await expect(page.locator(`.arc-capability-card[href="/arc/skills/${gapId}"]`)).toBeVisible();
  await expect(page.getByText('1 filled')).toBeVisible();
});
