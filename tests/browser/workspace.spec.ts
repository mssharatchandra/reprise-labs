import { test, expect } from '@playwright/test';

test('complete recovery workflow: consent, link, checkout and ledger evidence', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Recovery workspace.' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Aanya Rao', exact: true }).click();
  await page.getByRole('button', { name: 'Start rehearsal' }).click();
  await expect(page.getByText('PLAY THE CUSTOMER')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create a payment link', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Yes, let’s discuss it' }).click();
  await page.getByRole('button', { name: 'Create a payment link', exact: true }).click();
  await expect(page.getByText('No message sent. Invoice remains outstanding.')).toBeVisible();
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Open simulated checkout' }).click();
  const checkout = await popupPromise;
  await expect(checkout.getByRole('heading', { name: 'A fresh start.' })).toBeVisible();
  await checkout.getByRole('button', { name: 'Confirm simulated payment' }).click();
  await expect(checkout.getByText('Simulated payment confirmed', { exact: true })).toBeVisible();
  await checkout.close();
  await expect(page.locator('.panel-status').getByText('Recovered', { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole('button', { name: 'Finish conversation' }).click();
  await page.getByRole('button', { name: 'Activity journal' }).click();
  await expect(page.getByText('Simulated payment confirmed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Trust & decisions' }).click();
  await expect(page.getByRole('heading', { name: 'Rules outside the model' })).toBeVisible();
});
test('stop contact before consent is durable and disabled in the workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Nisha Patel', exact: true }).click();
  await page.getByRole('button', { name: 'Start rehearsal' }).click();
  await page.getByRole('button', { name: 'Stop contacting me' }).click();
  await expect(page.locator('.panel-status').getByText('Contact disabled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start rehearsal' })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Open Nisha Patel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start rehearsal' })).toBeDisabled();
});
test('search, filters, evidence download and setup are functional', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search customers' }).fill('Kabir');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await page.getByRole('button', { name: 'Closed', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'All customers' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export evidence' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('reprise-evidence.json');
  await page.getByRole('button', { name: 'Live voice setup' }).click();
  await expect(page.getByRole('heading', { name: 'Live connection checklist' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify agent configuration' })).toBeDisabled();
});
test('mobile layout stays within the viewport and keeps actions accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open Kabir Shah', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Open Kabir Shah', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start rehearsal' })).toBeVisible();
  await page.getByRole('button', { name: 'Start rehearsal' }).click();
  await expect(page.getByRole('button', { name: 'Yes, let’s discuss it' })).toBeVisible();
});
