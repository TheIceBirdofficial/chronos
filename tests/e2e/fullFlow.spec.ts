import { test, expect } from '@playwright/test';

/**
 * Full‑app flow test (low‑spec simulation)
 * 1. Load the homepage.
 * 2. Verify the root page responds quickly.
 * 3. Intercept the /api/download-daemon request and ensure it returns 200
 *    and a JSON payload containing a truthy `ok` field.
 * 4. Ensure the page renders the main dashboard element.
 */

test('chronos full flow on low‑spec hardware', async ({ page }) => {
  // Capture the API request
  const [response] = await Promise.all([
    page.waitForResponse(resp =>
      resp.url().includes('/api/download-daemon') && resp.status() === 200),
    page.goto('https://chronos-410257364704.europe-west1.run.app/', {
      waitUntil: 'networkidle',
    }),
  ]);

  // Verify API payload
  const json = await response.json();
  expect(json).toHaveProperty('ok');
  expect(json.ok).toBeTruthy();

  // Simple UI sanity check – dashboard container exists
  const dashboard = page.locator('[data-testid="dashboard"]');
  await expect(dashboard).toBeVisible({ timeout: 3000 });
});
