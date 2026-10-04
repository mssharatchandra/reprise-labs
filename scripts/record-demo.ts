import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
const base = 'http://127.0.0.1:4175';
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'ignore',
  env: {
    ...process.env,
    PORT: '4175',
    DATABASE_PATH: `.local/recording-${Date.now()}.db`,
    BOLNA_API_KEY: '',
    BOLNA_AGENT_ID: '',
    DEMO_PHONE_NUMBER: '',
    APP_BASE_URL: base,
  },
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/healthz')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  mkdirSync('docs/screenshots', { recursive: true });
  mkdirSync('artifacts', { recursive: true });
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: '.local/video', size: { width: 1440, height: 1000 } },
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole('button', { name: 'Open Aanya Rao', exact: true }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/workspace.png', fullPage: true });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Open Aanya Rao', exact: true }).click();
  await page.getByRole('button', { name: 'Start rehearsal' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Yes, let’s discuss it' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Create a payment link', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'docs/screenshots/conversation.png', fullPage: true });
  // Navigate in the same tab so the recorded viewport shows the checkout.
  const link = await page
    .getByRole('link', { name: 'Open simulated checkout' })
    .getAttribute('href');
  await page.goto(base + link);
  await page.getByRole('button', { name: 'Confirm simulated payment' }).waitFor();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Confirm simulated payment' }).click();
  await page.getByText('Simulated payment confirmed', { exact: true }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/checkout.png', fullPage: true });
  await page.waitForTimeout(2000);
  await page.goto(base);
  await page.getByRole('button', { name: 'Open Nisha Patel', exact: true }).click();
  await page.getByRole('button', { name: 'Start rehearsal' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop contacting me' }).click();
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Activity journal' }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Trust & decisions' }).click();
  await page.waitForTimeout(2000);
  const video = page.video();
  await context.close();
  if (video) copyFileSync(await video.path(), 'artifacts/product-walkthrough.webm');
  await browser.close();
  console.log(
    'Recorded a scripted product walkthrough and synthetic screenshots. No phone calls or provider spend.',
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
