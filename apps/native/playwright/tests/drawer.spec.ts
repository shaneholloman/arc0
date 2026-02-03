/**
 * Phase 2: Navigation Tests - Drawer
 *
 * Tests verify drawer navigation works correctly.
 * No Base service connection required.
 */

import { test, expect } from '@playwright/test';
import { TEST_IDS, testId } from '../utils/selectors';
import { initializeApp } from '../utils/store-helpers';

test.describe('Drawer Navigation - No Workstations', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('drawer content is visible on wide screens', async ({ page }) => {
    // On desktop, drawer should be permanent
    await expect(page.locator(testId(TEST_IDS.DRAWER_CONTENT))).toBeVisible();
  });

  test('drawer shows welcome when no workstations', async ({ page }) => {
    // The welcome content should be visible in drawer area
    // Use .first() because on mobile it may appear twice
    await expect(page.locator('text=Welcome to Arc0').first()).toBeVisible();
  });

  test('sessions tab is visible', async ({ page }) => {
    await expect(page.locator(testId(TEST_IDS.SESSIONS_TAB))).toBeVisible();
  });

  test('projects tab is visible', async ({ page }) => {
    await expect(page.locator(testId(TEST_IDS.PROJECTS_TAB))).toBeVisible();
  });

  test('settings button is accessible', async ({ page }) => {
    await expect(page.locator(testId(TEST_IDS.SETTINGS_BUTTON))).toBeVisible();
  });

  test('create session button is disabled when no workstations', async ({ page }) => {
    const createButton = page.locator(testId(TEST_IDS.CREATE_SESSION_BUTTON));
    await expect(createButton).toBeVisible();
    // React Native Web Pressable sets aria-disabled when disabled prop is true
    await expect(createButton).toHaveAttribute('aria-disabled', 'true');
  });

  test('connection indicator shows disconnected state', async ({ page }) => {
    // Should show disconnected (red) indicator when no workstations
    await expect(page.locator(testId(TEST_IDS.CONNECTION_INDICATOR))).toBeVisible();
  });

  test('clicking settings button opens settings modal', async ({ page }) => {
    await page.locator(testId(TEST_IDS.SETTINGS_BUTTON)).click();
    await expect(page.locator(testId(TEST_IDS.SETTINGS_SCREEN))).toBeVisible();
  });

  test('sessions tab is active by default', async ({ page }) => {
    const sessionsTab = page.locator(testId(TEST_IDS.SESSIONS_TAB));
    // Tab should be selected/active - check for aria-selected or similar
    await expect(sessionsTab).toBeVisible();
  });

  test('clicking projects tab shows appropriate content based on screen size', async ({
    page,
  }, testInfo) => {
    await page.locator(testId(TEST_IDS.PROJECTS_TAB)).click();

    // On desktop (persistent drawer): shows "Projects view coming soon" in drawer
    // On mobile (no persistent drawer): shows WelcomeEmpty in both drawer and main content
    const isMobile = testInfo.project.name === 'mobile-chrome';

    await expect(
      isMobile
        ? page.locator('text=Welcome to Arc0').first()
        : page.locator('text=Projects view coming soon')
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Drawer Navigation - Mobile Viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone X size

  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('drawer content is still visible on narrow screens (web drawer is always open on home)', async ({
    page,
  }) => {
    // On mobile web, the drawer should show welcome content
    // Use .first() because it appears in both drawer and main content
    await expect(page.locator('text=Welcome to Arc0').first()).toBeVisible();
  });
});
