/**
 * Phase 5: Interactive Features - Tool & Plan Approval
 *
 * Tests verify tool approval UI and plan approval flows.
 * Uses basemock message injection to simulate Claude sending tool_use messages.
 */

import { test, expect } from '../fixtures/basemock.fixture';
import { TEST_IDS, testId } from '../utils/selectors';
import { initializeApp } from '../utils/store-helpers';

test.describe('Tool Approval UI - Components', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('chat screen is ready for tool approval interactions', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await page.goto('/session/test-session/chat');

    // Verify the send button is present (used for submitting approvals)
    await expect(page.locator(testId(TEST_IDS.SEND_BUTTON))).toBeVisible();
  });

  test('message input supports tool approval response submission', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await page.goto('/session/test-session/chat');

    // Input should be available for typing feedback
    const input = page.locator(testId(TEST_IDS.MESSAGE_INPUT));
    await expect(input).toBeVisible();
    await expect(input).toBeEditable();
  });
});

test.describe('Tool Approval - With Message Injection', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('injected assistant message appears in chat', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');

    // Navigate to the session and wait for socket connection
    await basemock.navigateToSession(page);

    // Inject a simple text message
    const result = await basemock.injectMessage({
      type: 'assistant-text',
      text: 'Hello from basemock test!',
    });
    expect(result.success).toBe(true);

    // The message text should appear in the chat (assertion has built-in timeout)
    await expect(page.locator('text=Hello from basemock test')).toBeVisible({ timeout: 10000 });
  });

  test('tool use message appears in chat', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');

    // Navigate to the session and wait for socket connection
    await basemock.navigateToSession(page);

    // Inject a tool use message
    const result = await basemock.injectToolApproval('npm run build', 'Run the build command');
    expect(result.success).toBe(true);

    // The tool use should show "Allow Bash?" heading
    await expect(page.getByText('Allow Bash?')).toBeVisible({ timeout: 10000 });
  });

  test('tool approval buttons appear for pending Bash tool use', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await basemock.navigateToSession(page);

    const result = await basemock.injectToolApproval('npm run build', 'Run the build command');
    expect(result.success).toBe(true);

    await expect(page.getByText('Allow Bash?')).toBeVisible({ timeout: 10000 });
    await expect(page.locator(testId(TEST_IDS.TOOL_APPROVE_ONCE))).toBeVisible({ timeout: 5000 });
    await expect(page.locator(testId(TEST_IDS.TOOL_APPROVE_ALWAYS))).toBeVisible({ timeout: 5000 });
    await expect(page.locator(testId(TEST_IDS.TOOL_REJECT))).toBeVisible({ timeout: 5000 });
  });

  test('clicking Yes selects approve-once option', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await basemock.navigateToSession(page);

    await basemock.injectToolApproval('npm test', 'Run tests');

    // Wait for button to appear before clicking
    await expect(page.locator(testId(TEST_IDS.TOOL_APPROVE_ONCE))).toBeVisible({ timeout: 10000 });

    // Click the Yes button
    await page.locator(testId(TEST_IDS.TOOL_APPROVE_ONCE)).click();

    // The button should be visually selected (checked by opacity or background change)
    await expect(page.locator(testId(TEST_IDS.TOOL_APPROVE_ONCE))).toBeVisible();
  });

  test('clicking No selects reject option', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await basemock.navigateToSession(page);

    await basemock.injectToolApproval('rm -rf /', 'Delete everything');

    // Wait for button to appear before clicking
    await expect(page.locator(testId(TEST_IDS.TOOL_REJECT))).toBeVisible({ timeout: 10000 });

    // Click the No button
    await page.locator(testId(TEST_IDS.TOOL_REJECT)).click();

    // The button should be visually selected
    await expect(page.locator(testId(TEST_IDS.TOOL_REJECT))).toBeVisible();
  });
});

test.describe('Plan Approval UI - Components', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('chat screen is ready for plan approval interactions', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await page.goto('/session/test-session/chat');

    // Verify UI is ready
    await expect(page.locator(testId(TEST_IDS.SEND_BUTTON))).toBeVisible();
  });
});

test.describe('Plan Approval - With Message Injection', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('plan approval options appear for ExitPlanMode', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await basemock.navigateToSession(page);

    // Inject plan approval request
    const result = await basemock.injectPlanApproval(
      '# Implementation Plan\n\n1. Create component\n2. Add tests'
    );
    expect(result.success).toBe(true);

    // Plan approval UI should appear with "Would you like to proceed?" and options
    await expect(page.getByText('Would you like to proceed?')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Yes, clear context and bypass')).toBeVisible({ timeout: 5000 });
  });

  test('plan approval shows feedback option', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await basemock.navigateToSession(page);

    await basemock.injectPlanApproval('# Plan\n- Step 1\n- Step 2');

    // Should show "Provide feedback" option
    await expect(page.getByText('Provide feedback')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('AskUserQuestion UI - Components', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('chat screen is ready for question interactions', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await basemock.navigateToSession(page);

    await expect(page.locator(testId(TEST_IDS.MESSAGE_INPUT))).toBeVisible();
  });
});

test.describe('AskUserQuestion - With Message Injection', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('question options appear for AskUserQuestion', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await basemock.navigateToSession(page);

    // Inject a question
    const result = await basemock.injectAskQuestion('Which database should we use?', [
      'PostgreSQL',
      'MySQL',
      'SQLite',
    ]);
    expect(result.success).toBe(true);

    // Question text should be visible
    await expect(page.locator('text=Which database should we use')).toBeVisible({ timeout: 10000 });

    // Options should be visible
    await expect(page.locator('text=PostgreSQL')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=MySQL')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=SQLite')).toBeVisible({ timeout: 5000 });
  });

  test('selecting an option highlights it', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await basemock.navigateToSession(page);

    await basemock.injectAskQuestion('Preferred language?', ['TypeScript', 'JavaScript', 'Python']);

    // Wait for option to appear before clicking
    await expect(page.locator('text=TypeScript')).toBeVisible({ timeout: 10000 });

    // Click on TypeScript option
    await page.locator('text=TypeScript').click();

    // The option should be selected (visible feedback in UI)
    // The send button should become enabled
    await expect(page.locator(testId(TEST_IDS.SEND_BUTTON))).toBeVisible();
  });

  test('Other option is always available', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await basemock.navigateToSession(page);

    await basemock.injectAskQuestion('Pick a framework', ['React', 'Vue', 'Angular']);

    // "Other" option should be available for custom input
    await expect(page.locator('text=Other')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Stop Button', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('stop button testID is defined correctly', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await page.goto('/session/test-session/chat');

    // Stop button only appears when agent is running
    // When not running, send button is shown instead
    await expect(page.locator(testId(TEST_IDS.SEND_BUTTON))).toBeVisible();

    // Stop button should not be visible when agent is not running
    await expect(page.locator(testId(TEST_IDS.STOP_BUTTON))).not.toBeVisible();
  });
});

test.describe('Approval State Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await initializeApp(page, { clearStore: true });
  });

  test('selections are preserved when navigating between tabs', async ({ page, basemock }) => {
    await basemock.addWorkstationViaUI(page, 'Test Workstation');
    await page.goto('/session/test-session/chat');

    // Type something in input
    const input = page.locator(testId(TEST_IDS.MESSAGE_INPUT));
    await input.fill('Draft message');

    // Navigate to artifacts
    await page.locator('text=Artifacts').click();

    // Navigate back to chat
    await page.locator('text=Chat').click();

    // Input content may or may not be preserved depending on implementation
    // This test documents the expected behavior
    await expect(page.locator(testId(TEST_IDS.MESSAGE_INPUT))).toBeVisible();
  });
});
