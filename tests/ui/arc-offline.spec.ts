import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';

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

const seedPublishedLesson = async (page: Page, owner: string): Promise<string> => {
  const created = await post(page.request, owner, '/api/gaps', {
    title: 'Offline set theory',
    rawStatement: REFERENCE_GAP_STATEMENT,
    dailyMinutes: 25,
    sourcePolicy: 'sources_only',
  });
  const gapId = (created.gap as { id: string }).id;

  await post(page.request, owner, `/api/gaps/${gapId}/transition`, { type: 'define' });
  await post(page.request, owner, `/api/gaps/${gapId}/sources`, {
    gapId,
    filename: 'offline-set-theory.md',
    mediaType: 'text/markdown',
    text: SET_THEORY_SOURCE,
  });
  await post(page.request, owner, `/api/gaps/${gapId}/compile`, {
    idempotencyKey: `offline-${gapId}`,
    audioEnabled: true,
  });
  return gapId;
};

const activateServiceWorker = async (page: Page) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        });
      });
    }
  });
};

test('a visited Arc lesson keeps its text and explains offline limits', async ({
  context,
  page,
}, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The offline contract targets the mobile PWA.');
  test.setTimeout(90_000);

  const owner = `offline-${testInfo.project.name}-${testInfo.workerIndex}`;
  await context.addCookies([
    {
      name: 'gapos_owner',
      value: owner,
      url: 'http://127.0.0.1:3100',
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/arc');
  await activateServiceWorker(page);

  const gapId = await seedPublishedLesson(page, owner);
  const lessonPath = `/arc/skills/${gapId}/lesson`;
  await page.goto(lessonPath);
  await expect(page.getByRole('tab', { name: 'Theory' })).toBeVisible();
  await expect(
    page
      .locator('.arc-theory-text p')
      .filter({ hasText: 'Today we are going to earn one sentence' }),
  ).toBeVisible();

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: 'Theory' })).toBeVisible();
  await expect(
    page
      .locator('.arc-theory-text p')
      .filter({ hasText: 'Today we are going to earn one sentence' }),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'Practice' }).click();
  await page.getByLabel('A and B share no elements').check();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText('Practice was not submitted.')).toBeVisible();

  await page.goto('/arc/not-visited-while-offline', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Arc is offline.' })).toBeVisible();
  await expect(page.getByText(/signed audio need a network connection/i)).toBeVisible();
});

test('offline Arc documents never cross learner cache boundaries', async ({
  context,
  page,
}, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The offline contract targets the mobile PWA.');
  test.setTimeout(90_000);

  const ownerA = `offline-owner-a-${testInfo.workerIndex}`;
  const ownerB = `offline-owner-b-${testInfo.workerIndex}`;
  await context.addCookies([
    {
      name: 'gapos_owner',
      value: ownerA,
      url: 'http://127.0.0.1:3100',
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/arc');
  await activateServiceWorker(page);
  const gapId = await seedPublishedLesson(page, ownerA);
  await page.goto(`/arc/skills/${gapId}/lesson`);
  await expect(page.getByText('Offline set theory')).toBeVisible();

  const cacheUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      urls.push(...(await cache.keys()).map((request) => request.url));
    }
    return urls;
  });
  expect(cacheUrls.some((url) => url.includes('/api/'))).toBe(false);
  expect(cacheUrls.some((url) => new URL(url).searchParams.get('__gapos_owner') === ownerA)).toBe(
    true,
  );

  await context.addCookies([
    {
      name: 'gapos_owner',
      value: ownerB,
      url: 'http://127.0.0.1:3100',
      sameSite: 'Lax',
    },
  ]);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Arc is offline.' })).toBeVisible();
  await expect(page.getByText('Offline set theory')).toHaveCount(0);
});
