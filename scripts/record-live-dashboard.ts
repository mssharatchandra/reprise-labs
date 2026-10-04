import { chromium } from '@playwright/test';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
const base = 'http://localhost:4173';
const browser = await chromium.launch();
try {
  mkdirSync('artifacts', { recursive: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      recordVideo: { dir: '.local/live-dashboard', size: { width: 1440, height: 1000 } },
    }),
    page = await context.newPage();
  await page.goto(base + '/workspace');
  await page.locator('.case-heading h2').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2000);
  await page
    .getByRole('heading', { name: 'The phone conversation', exact: true })
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  const transcript = page.locator('.transcript');
  await transcript.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await page.waitForTimeout(2500);
  await page.getByRole('link', { name: 'View receipt', exact: true }).scrollIntoViewIfNeeded();
  const receipt = await page
    .getByRole('link', { name: 'View receipt', exact: true })
    .getAttribute('href');
  await page.goto(base + receipt);
  await page.getByText('Simulated payment confirmed', { exact: true }).waitFor();
  await page.waitForTimeout(2500);
  await page.goto(base + '/workspace');
  await page.getByRole('button', { name: 'Activity journal', exact: true }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.waitForTimeout(2500);
  const video = page.video();
  await context.close();
  if (video) copyFileSync(await video.path(), 'artifacts/live-dashboard.webm');
  writeFileSync(
    'artifacts/live-dashboard-notes.json',
    JSON.stringify(
      {
        source:
          'Screen recording of the actual local operator ledger after the permitted phone demo.',
        financialMode: 'simulated',
        content: [
          'Fictional Aanya invoice marked recovered by checkout',
          'Finalized original phone transcript',
          'Simulated checkout receipt',
          'Live provider and tool journal',
        ],
        privateData: 'No operator token, API key, private capability or phone number is displayed.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Recorded the real phone demo ledger. No new calls or state changes were made.');
} finally {
  await browser.close();
}
