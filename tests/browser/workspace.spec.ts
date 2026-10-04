import { test, expect } from '@playwright/test';
test('complete reviewer workflow: consent, proposed delivery, checkout and ledger', async ({
  page,
  context,
}) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Pick up the conversation.' })).toBeVisible();
  await page.getByRole('button', { name: 'Start rehearsal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Play the customer' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create a payment link', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Yes, let’s discuss it' }).click();
  await page.getByRole('button', { name: 'Create a payment link', exact: true }).click();
  await expect(page.getByText('Prepared for WhatsApp, SMS, and email.')).toBeVisible();
  await expect(
    page.getByText('Delivery is simulated. No message was sent; the invoice remains outstanding.'),
  ).toBeVisible();
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Open simulated checkout' }).click();
  const checkout = await popup;
  await expect(checkout.getByRole('heading', { name: 'Hello, Aanya.' })).toBeVisible();
  await checkout.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(checkout.getByText('Simulated payment confirmed', { exact: true })).toBeVisible();
  await checkout.close();
  await expect(
    page.locator('.panel-status').getByText('Payment received', { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Finish conversation' }).click();
  await page.getByRole('button', { name: 'Activity journal', exact: true }).click();
  await expect(page.getByText('Simulated payment confirmed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Trust & decisions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rules outside the model' })).toBeVisible();
});
test('stop contact before consent remains durable in this browser', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Open Nisha Patel', exact: true }).click();
  await page.getByRole('button', { name: 'Start rehearsal', exact: true }).click();
  await page.getByRole('button', { name: 'Stop contacting me', exact: true }).click();
  await expect(page.locator('.panel-status').getByText('Contact stopped')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start rehearsal', exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Open Nisha Patel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start rehearsal', exact: true })).toBeDisabled();
});
test('search, evidence download and disabled live setup work without credentials', async ({
  page,
}) => {
  await page.goto('/demo');
  await page.getByRole('textbox', { name: 'Search customers' }).fill('Kabir');
  await expect(page.locator('.people>li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.locator('.people>li')).toHaveCount(10);
  await page.getByRole('button', { name: 'Closed', exact: true }).click();
  await expect(page.locator('.people>li')).toHaveCount(0);
  await page.getByRole('button', { name: 'All customers', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export evidence' }).click();
  expect((await downloading).suggestedFilename()).toBe('reprise-evidence.json');
  await page.getByRole('button', { name: 'Live voice setup', exact: true }).click();
  await expect(
    page.getByText('The public desk has no credentials or live calling.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify agent configuration' })).toHaveCount(0);
});
test('landing and mobile desk remain readable and within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A missed payment. A considered next step.' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('link', { name: 'Sit down at the recovery desk' }).click();
  await page.getByRole('button', { name: 'Open Kabir Shah', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start rehearsal', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Start rehearsal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Yes, let’s discuss it' })).toBeVisible();
});
test('separate reviewer browsers have isolated fictional ledgers', async ({ browser }) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const first = await a.newPage(),
    second = await b.newPage();
  await first.goto('/demo');
  await first.getByRole('button', { name: 'Start rehearsal', exact: true }).click();
  await first.getByRole('button', { name: 'Stop contacting me', exact: true }).click();
  await expect(first.locator('.panel-status').getByText('Contact stopped')).toBeVisible();
  await second.goto('/demo');
  await expect(second.locator('.panel-status').getByText('Ready', { exact: true })).toBeVisible();
  await expect(second.getByRole('button', { name: 'Start rehearsal', exact: true })).toBeEnabled();
  await a.close();
  await b.close();
});
