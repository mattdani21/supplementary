import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const openAsNewLearner = async (page: Page, testInfo: TestInfo, path = '/arc') => {
  const owner = `ui-${testInfo.project.name}-${testInfo.workerIndex}`;
  await page.context().addCookies([
    {
      name: 'gapos_owner',
      value: owner,
      url: 'http://127.0.0.1:3100',
      sameSite: 'Lax',
    },
  ]);
  await page.goto(path);
};

test.describe('Arc responsive foundation', () => {
  test('first run has one clear action and one active navigation item', async ({
    page,
  }, testInfo) => {
    await openAsNewLearner(page, testInfo);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /start calibration/i })).toBeVisible();
    await expect(page.locator('.arc-nav [aria-current="page"]')).toHaveCount(1);

    await page.getByRole('link', { name: 'Skills' }).click();
    await expect(page).toHaveURL(/\/arc\/skills$/);
    await expect(page.locator('.arc-nav [aria-current="page"]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Skills' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('primary navigation and icon controls meet minimum touch targets', async ({
    page,
  }, testInfo) => {
    await openAsNewLearner(page, testInfo);

    const targets = page.locator('.arc-nav-link, .arc-icon-button, .arc-avatar');
    await expect(targets.first()).toBeVisible();
    for (let index = 0; index < (await targets.count()); index += 1) {
      const box = await targets.nth(index).boundingBox();
      expect(box, `target ${index} has a rendered box`).not.toBeNull();
      expect(box!.width, `target ${index} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `target ${index} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('key Arc entry routes have no serious accessibility violations', async ({
    page,
  }, testInfo) => {
    for (const path of ['/arc', '/arc/skills', '/arc/calibrate', '/arc/profile']) {
      await openAsNewLearner(page, testInfo, path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(serious, `${path}: ${serious.map((item) => item.id).join(', ')}`).toEqual([]);
    }
  });
});
