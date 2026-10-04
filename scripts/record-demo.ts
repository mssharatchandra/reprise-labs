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
  mkdirSync('public/screenshots', { recursive: true });
  mkdirSync('artifacts', { recursive: true });
  browser = await chromium.launch();
  // Capture the landing page outside the walkthrough so its embedded video cannot recurse into itself.
  const landing = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await landing.goto(base);
  await landing.evaluate(() => document.fonts.ready);
  await landing.screenshot({ path: 'docs/screenshots/landing.png', fullPage: true });
  await landing.close();
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      recordVideo: { dir: '.local/video', size: { width: 1440, height: 1000 } },
    }),
    page = await context.newPage();
  await page.goto(base + '/demo');
  await page.getByRole('button', { name: 'Start rehearsal', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/screenshots/workspace.png', fullPage: true });
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Start rehearsal', exact: true }).click();
  await page.getByRole('heading', { name: 'Play the customer' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Yes, let’s discuss it' }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Create a payment link', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'docs/screenshots/conversation.png', fullPage: true });
  const link = await page
    .getByRole('link', { name: 'Open simulated checkout' })
    .getAttribute('href');
  await page.goto(base + link);
  await page.getByRole('button', { name: 'Pay', exact: true }).waitFor();
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await page.getByText('Simulated payment confirmed', { exact: true }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/checkout.png', fullPage: true });
  await page.waitForTimeout(1800);
  await page.goto(base + '/demo');
  await page.getByRole('button', { name: 'Open Nisha Patel', exact: true }).click();
  await page.getByRole('button', { name: 'Start rehearsal', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Stop contacting me', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Activity journal', exact: true }).click();
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Trust & decisions', exact: true }).click();
  await page.waitForTimeout(1800);
  const video = page.video();
  await context.close();
  if (video) copyFileSync(await video.path(), 'artifacts/product-walkthrough.webm');
  for (const name of ['workspace', 'landing', 'checkout', 'conversation'])
    copyFileSync(`docs/screenshots/${name}.png`, `public/screenshots/${name}.png`);
  console.log(
    'Recorded the updated public desk walkthrough with synthetic screenshots. No paid calls.',
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
