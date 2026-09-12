import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { SET_THEORY_SOURCE } from '@gapos/test-fixtures';

const openAsNewLearner = async (page: Page, testInfo: TestInfo) => {
  const owner = `journey-${testInfo.project.name}-${testInfo.workerIndex}`;
  await page.context().addCookies([
    {
      name: 'gapos_owner',
      value: owner,
      url: 'http://127.0.0.1:3100',
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/arc/calibrate?subject=Python%20for%20data%20work');
};

test('the Arc journey reaches practice, correction and server-graded review', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await openAsNewLearner(page, testInfo);

  await page.getByLabel('Daily focus').selectOption('25');
  await page.getByLabel('Only sources I provide').check();
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(
    page.getByRole('heading', { name: /what would .*useful.* look like/i }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Build a project I can show' }).click();
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

  await page.getByRole('link', { name: /start the proof/i }).click();
  await expect(page.getByRole('button', { name: 'Play theory audio' })).toBeVisible();
  const theoryTab = page.getByRole('tab', { name: 'Theory' });
  await theoryTab.focus();
  await theoryTab.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Practice' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByLabel('A and B share no elements').check();
  await page.getByLabel('How certain was this answer?').selectOption('low');
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText(/not yet.*use the correction/i)).toBeVisible();
  await expect(page.getByText(/next retrieval/i)).toBeVisible();

  await page.getByRole('link', { name: 'Profile' }).click();
  await page.getByRole('checkbox', { name: /spaced review/i }).check();
  await expect(page.getByRole('checkbox', { name: /spaced review/i })).toBeChecked();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('link', { name: /ready/i }).click();

  await expect(page.getByRole('heading', { name: 'Due reviews' })).toBeVisible();
  await page.getByLabel('every element of A is an element of B').check();
  await page.getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByText('Review complete.')).toBeVisible();
  await expect(page.getByText(/next retrieval/i)).toBeVisible();
});
