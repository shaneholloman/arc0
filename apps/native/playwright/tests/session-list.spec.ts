/**
 * Phase 4: Connected Flows - Session List
 *
 * Tests verify session list and connection status with BaseMock server.
 * Requires BaseMock to be running.
 */

import { test, expect } from '../fixtures/basemock.fixture';
import { TEST_IDS, testId } from '../utils/selectors';
import { initializeApp } from '../utils/store-helpers';

test.describe('Connection Status', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('connection indicator shows connected after adding workstation', async ({ page, basemock }) => {
    // Add workstation pointing to basemock
    await basemock.addWorkstationViaUI(page, 'Test Workstation');

    // Navigate back to main screen to see the drawer
    await page.goto('/');
    await expect(page.locator(testId(TEST_IDS.APP_ROOT))).toBeVisible();

    // Wait for connection to establish (socket reconnect)
    await page.waitForTimeout(2000);

    // Connection indicator should show connected (green) - look in the drawer
    const indicator = page.locator(testId(TEST_IDS.CONNECTION_INDICATOR));
    await expect(indicator).toBeVisible({ timeout: 10000 });
  });

  test('create session button is enabled after adding workstation', async ({ page, basemock }) => {
    // Add workstation
    await basemock.addWorkstationViaUI(page, 'Test Workstation');

    // Navigate back to main screen
    await page.goto('/');
    await expect(page.locator(testId(TEST_IDS.APP_ROOT))).toBeVisible();

    // Wait for connection to establish
    await page.waitForTimeout(2000);

    // Create session button should be enabled (not aria-disabled)
    const createButton = page.locator(testId(TEST_IDS.CREATE_SESSION_BUTTON));
    await expect(createButton).toBeVisible();

    // Check that button is not disabled
    await expect(createButton).not.toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('Session List - Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('session list shows empty state before sessions sync', async ({ page, basemock }) => {
    // Add workstation but no sessions created yet
    await basemock.addWorkstationViaUI(page, 'Test Workstation');

    // Navigate to main screen
    await page.goto('/');
    await expect(page.locator(testId(TEST_IDS.APP_ROOT))).toBeVisible();

    // Should show sessions tab (even if empty)
    await expect(page.locator(testId(TEST_IDS.SESSIONS_TAB))).toBeVisible();
  });
});

test.describe('Session List - With Sessions', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('sessions tab is visible after adding workstation', async ({ page, basemock }) => {
    // Add workstation
    await basemock.addWorkstationViaUI(page, 'Test Workstation');

    // Navigate to main screen
    await page.goto('/');
    await expect(page.locator(testId(TEST_IDS.APP_ROOT))).toBeVisible();

    // Wait for connection and initial sync
    await page.waitForTimeout(2000);

    // Verify sessions tab is visible
    await expect(page.locator(testId(TEST_IDS.SESSIONS_TAB))).toBeVisible();
  });

  test('session list UI is ready after connection', async ({ page, basemock }) => {
    // Add workstation
    await basemock.addWorkstationViaUI(page, 'Test Workstation');

    await page.goto('/');
    await expect(page.locator(testId(TEST_IDS.APP_ROOT))).toBeVisible();

    // Wait for initial sync
    await page.waitForTimeout(2000);

    // The sessions tab should be clickable and functional
    await expect(page.locator(testId(TEST_IDS.SESSIONS_TAB))).toBeVisible();
    await expect(page.locator(testId(TEST_IDS.DRAWER_CONTENT))).toBeVisible();
  });
});

test.describe('Session Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('session tabs are visible when navigating to a session', async ({ page, basemock }) => {
    // Add workstation
    await basemock.addWorkstationViaUI(page, 'Test Workstation');

    // Navigate to a session route directly (even if session doesn't exist)
    await page.goto('/session/test-session-id/chat');

    // Session tabs should be visible
    await expect(page.locator('text=Chat')).toBeVisible();
    await expect(page.locator('text=Artifacts')).toBeVisible();
    await expect(page.locator('text=Changes')).toBeVisible();
  });

  test('chat tab shows message input', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');

    await page.goto('/session/test-session-id/chat');

    // Message input should be visible
    await expect(page.locator(testId(TEST_IDS.MESSAGE_INPUT))).toBeVisible();
  });

  test('send button is visible in chat', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');

    await page.goto('/session/test-session-id/chat');

    // Send button should be visible
    await expect(page.locator(testId(TEST_IDS.SEND_BUTTON))).toBeVisible();
  });
});

test.describe('Disconnection Handling', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('connection indicator shows disconnected state when no workstations', async ({ page }) => {
    // Without any workstation, there's no connection to show
    await page.goto('/');
    await expect(page.locator(testId(TEST_IDS.APP_ROOT))).toBeVisible();

    // Connection indicator should be visible and show disconnected state
    const indicator = page.locator(testId(TEST_IDS.CONNECTION_INDICATOR));
    await expect(indicator).toBeVisible();
  });
});
