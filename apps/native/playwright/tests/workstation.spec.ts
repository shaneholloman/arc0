/**
 * Phase 3: Workstation Management Tests
 *
 * Tests verify adding/editing workstations through UI.
 * No real Base service - connection tests fail gracefully.
 */

import { test, expect } from '@playwright/test';
import { TEST_IDS, testId } from '../utils/selectors';
import { initializeApp } from '../utils/store-helpers';

test.describe('Workstation Management - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
    // Navigate to settings
    await page.locator(testId(TEST_IDS.SETTINGS_BUTTON)).click();
    await expect(page.locator(testId(TEST_IDS.SETTINGS_SCREEN))).toBeVisible();
  });

  test('workstation list shows empty state initially', async ({ page }) => {
    await expect(page.locator(testId(TEST_IDS.WORKSTATION_EMPTY))).toBeVisible();
    await expect(page.locator('text=No workstations configured')).toBeVisible();
  });

  test('add workstation button is visible', async ({ page }) => {
    await expect(page.locator(testId(TEST_IDS.ADD_WORKSTATION_BUTTON))).toBeVisible();
    await expect(page.locator('text=Add Workstation')).toBeVisible();
  });
});

test.describe('Workstation Add Modal', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
    await page.locator(testId(TEST_IDS.SETTINGS_BUTTON)).click();
    await expect(page.locator(testId(TEST_IDS.SETTINGS_SCREEN))).toBeVisible();
    // Open add modal
    await page.locator(testId(TEST_IDS.ADD_WORKSTATION_BUTTON)).click();
  });

  test('add workstation modal opens with URL field', async ({ page }) => {
    await expect(page.locator(testId(TEST_IDS.WORKSTATION_URL_INPUT))).toBeVisible();
  });

  test('add workstation modal has secret field', async ({ page }) => {
    await expect(page.locator(testId(TEST_IDS.WORKSTATION_SECRET_INPUT))).toBeVisible();
  });

  test('name field is not visible initially (shown after successful test)', async ({ page }) => {
    // Name input should not be visible until test connection succeeds
    await expect(page.locator(testId(TEST_IDS.WORKSTATION_NAME_INPUT))).not.toBeVisible();
  });

  test('test connection button is visible', async ({ page }) => {
    await expect(page.locator(testId(TEST_IDS.WORKSTATION_TEST_BUTTON))).toBeVisible();
    await expect(page.locator('text=Test Connection')).toBeVisible();
  });

  test('save button is visible', async ({ page }) => {
    await expect(page.locator(testId(TEST_IDS.WORKSTATION_SAVE_BUTTON))).toBeVisible();
  });

  test('cancel button is visible', async ({ page }) => {
    await expect(page.locator(testId(TEST_IDS.WORKSTATION_CANCEL_BUTTON))).toBeVisible();
    await expect(page.locator('text=Cancel')).toBeVisible();
  });

  test('clicking cancel closes the modal', async ({ page }) => {
    await page.locator(testId(TEST_IDS.WORKSTATION_CANCEL_BUTTON)).click();
    // Modal should be closed - URL input should not be visible
    await expect(page.locator(testId(TEST_IDS.WORKSTATION_URL_INPUT))).not.toBeVisible();
  });

  test('can enter URL in input field', async ({ page }) => {
    const urlInput = page.locator(testId(TEST_IDS.WORKSTATION_URL_INPUT));
    await urlInput.fill('https://test.arc0.ai');
    await expect(urlInput).toHaveValue('https://test.arc0.ai');
  });

  test('can enter secret in input field', async ({ page }) => {
    const secretInput = page.locator(testId(TEST_IDS.WORKSTATION_SECRET_INPUT));
    await secretInput.fill('test-secret-123');
    await expect(secretInput).toHaveValue('test-secret-123');
  });

  test('test connection button is disabled when URL is empty', async ({ page }) => {
    const secretInput = page.locator(testId(TEST_IDS.WORKSTATION_SECRET_INPUT));
    await secretInput.fill('test-secret');

    // URL is empty, test button should be disabled
    const testButton = page.locator(testId(TEST_IDS.WORKSTATION_TEST_BUTTON));
    await expect(testButton).toBeVisible();

    // React Native Web Pressable sets aria-disabled when disabled prop is true
    await expect(testButton).toHaveAttribute('aria-disabled', 'true');
  });

  test('test connection button is disabled when secret is empty', async ({ page }) => {
    const urlInput = page.locator(testId(TEST_IDS.WORKSTATION_URL_INPUT));
    await urlInput.fill('https://test.arc0.ai');

    // Secret is empty, test button should be disabled
    const testButton = page.locator(testId(TEST_IDS.WORKSTATION_TEST_BUTTON));
    await expect(testButton).toBeVisible();

    // React Native Web Pressable sets aria-disabled when disabled prop is true
    await expect(testButton).toHaveAttribute('aria-disabled', 'true');
  });

  test('test connection shows error when server unreachable', async ({ page }) => {
    const urlInput = page.locator(testId(TEST_IDS.WORKSTATION_URL_INPUT));
    const secretInput = page.locator(testId(TEST_IDS.WORKSTATION_SECRET_INPUT));

    await urlInput.fill('https://nonexistent.invalid');
    await secretInput.fill('test-secret');

    // Click test connection
    await page.locator(testId(TEST_IDS.WORKSTATION_TEST_BUTTON)).click();

    // Wait for error message (testing state may be too brief to catch)
    // Error could be connection timeout or error message
    await expect(
      page
        .locator('text=Connection timeout')
        .or(page.locator('text=error'))
        .or(page.locator('text=Failed'))
    ).toBeVisible({ timeout: 20000 });
  });

  test('URL validation shows error for invalid URL format', async ({ page }) => {
    const urlInput = page.locator(testId(TEST_IDS.WORKSTATION_URL_INPUT));
    const secretInput = page.locator(testId(TEST_IDS.WORKSTATION_SECRET_INPUT));

    await urlInput.fill('not-a-valid-url');
    await secretInput.fill('test-secret');

    // Try to save
    await page.locator(testId(TEST_IDS.WORKSTATION_SAVE_BUTTON)).click();

    // Should show validation error
    await expect(page.locator('text=valid URL')).toBeVisible();
  });

  test('HTTP URL shows security warning', async ({ page }) => {
    const urlInput = page.locator(testId(TEST_IDS.WORKSTATION_URL_INPUT));
    await urlInput.fill('http://localhost:3001');

    // Should show HTTP warning
    await expect(page.locator('text=HTTPS')).toBeVisible();
  });
});

test.describe('Workstation Modal Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
    await page.locator(testId(TEST_IDS.SETTINGS_BUTTON)).click();
    await expect(page.locator(testId(TEST_IDS.SETTINGS_SCREEN))).toBeVisible();
  });

  test('clicking outside modal closes it', async ({ page }) => {
    // Open modal
    await page.locator(testId(TEST_IDS.ADD_WORKSTATION_BUTTON)).click();
    await expect(page.locator(testId(TEST_IDS.WORKSTATION_URL_INPUT))).toBeVisible();

    // Click on the backdrop (outside the modal content)
    // The backdrop covers the whole screen, modal is centered
    await page.mouse.click(10, 10);

    // Modal should be closed
    await expect(page.locator(testId(TEST_IDS.WORKSTATION_URL_INPUT))).not.toBeVisible();
  });
});
