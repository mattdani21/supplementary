import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SET_THEORY_SOURCE } from '@gapos/test-fixtures';

const openAsNewLearner = async (page: Page, testInfo: TestInfo) => {
  const owner = `journey-${testInfo.project.name}-${testInfo.workerIndex}`;
  await page.context().addCookies([
    {
      name: 'gapos_owner',
      value: owner,
      domain: '127.0.0.1',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/arc/calibrate?subject=Python%20for%20data%20work');
};

test('calibration, source setup and compilation stay inside Arc', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await openAsNewLearner(page, testInfo);

  await page.getByRole('button', { name: /continue/i }).click();
  await expect(
    page.getByRole('heading', { name: /what would .*useful.* look like/i }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Build a project I can show' }).click();
  await page.getByLabel('Daily focus').selectOption('25');
  await page.getByLabel('Only sources I provide').check();
  await page.getByRole('button', { name: /continue/i }).click();

  await page.getByRole('button', { name: '12' }).click();
  await expect(page.getByText(/grade it privately/i)).toBeVisible();
  await page.getByRole('button', { name: /run my calibration/i }).click();
  await expect(page.getByRole('heading', { name: /focused path/i })).toBeVisible();
  await page.getByRole('link', { name: /review sources and compile/i }).click();

  await expect(page).toHaveURL(/\/arc\/skills\/[^/]+\/setup$/);
  await expect(page.getByText('25 minutes')).toBeVisible();
  await expect(page.getByText('Provided sources only')).toBeVisible();
  await page.getByLabel('Source content').fill(SET_THEORY_SOURCE);
  await page.getByRole('button', { name: 'Attach source' }).click();
  await expect(page.getByText(/source attached/i)).toBeVisible();

  await page.getByRole('button', { name: /compile my route/i }).click();
  await expect(page).toHaveURL(/\/arc\/skills\/[^/]+$/, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Clear the gaps in order.' })).toBeVisible();
  await expect(page.getByRole('link', { name: /start the proof/i })).toBeVisible();
});
