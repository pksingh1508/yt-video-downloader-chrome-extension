import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { EXTENSION_ID } from '../../src/config';

const extension = `chrome-extension://${EXTENSION_ID}`;
let context: BrowserContext;
const errors: string[] = [];

test.beforeAll(async () => {
  const directory = path.resolve('dist');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    viewport: { width: 440, height: 600 },
    args: [
      `--disable-extensions-except=${directory}`,
      `--load-extension=${directory}`,
    ],
  });
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
});

test.afterAll(async () => {
  await context?.close();
});

test('complete editing, export, preview, and download stay inside the popup', async () => {
  expect(
    context.pages().filter((page) => page.url() === `${extension}/index.html`),
  ).toHaveLength(0);
  let popup = await context.newPage();
  await popup.goto(`${extension}/popup.html`);
  const initialTabCount = context.pages().length;
  await expect(popup.getByText('Local companion connected')).toBeVisible();
  const input = popup.getByRole('textbox', { name: 'YouTube video link' });
  await input.fill('https://evil.test/video');
  await expect(
    popup.getByRole('button', { name: 'Choose clip & format' }),
  ).toBeDisabled();
  await input.fill('https://youtu.be/jNQXAC9IVRw?t=1');
  await popup.getByRole('button', { name: 'Choose clip & format' }).click();
  await expect(
    popup.getByRole('heading', { name: 'Extension test fixture' }),
  ).toBeVisible();
  expect(context.pages()).toHaveLength(initialTabCount);
  expect(popup.url()).toBe(`${extension}/popup.html`);
  await popup.getByRole('textbox', { name: 'Clip end time' }).fill('0:05');
  await expect(popup.getByRole('alert')).toContainText('within the source');
  await expect(
    popup.getByRole('button', { name: 'Prepare for X', exact: true }),
  ).toBeDisabled();
  await popup.getByRole('textbox', { name: 'Clip end time' }).fill('0:02');
  await popup.getByRole('button', { name: '9:16', exact: true }).click();
  await popup.getByRole('button', { name: 'Dark theme' }).click();
  await popup.reload();
  await expect(
    popup.getByRole('textbox', { name: 'Clip end time' }),
  ).toHaveValue('0:02');
  await expect(
    popup.getByRole('button', { name: '9:16', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(popup.getByText('Local companion connected')).toBeVisible();
  await popup
    .getByRole('button', { name: 'Prepare for X', exact: true })
    .click();
  await expect(
    popup.getByText('Preparing video…', { exact: true }),
  ).toBeVisible();
  await popup.close();
  popup = await context.newPage();
  await popup.goto(`${extension}/popup.html`);
  await expect(
    popup.getByRole('button', { name: 'Download MP4', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      popup!
        .locator('video')
        .evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  const media = await popup
    .locator('video')
    .evaluate((element: HTMLVideoElement) => ({
      width: element.videoWidth,
      height: element.videoHeight,
      duration: element.duration,
    }));
  expect(media.width).toBe(720);
  expect(media.height).toBe(1280);
  expect(media.duration).toBeCloseTo(2, 0);
  // A headless browser accepts Save As automatically. Inspect Chrome's real download record.
  await popup
    .getByRole('button', { name: 'Download MP4', exact: true })
    .click();
  await expect
    .poll(() =>
      popup!.evaluate(async () => {
        const downloads = await chrome.downloads.search({
          limit: 1,
          orderBy: ['-startTime'],
        });
        return downloads[0]?.state;
      }),
    )
    .toBe('complete');
  await popup
    .getByRole('button', { name: 'My downloads', exact: true })
    .click();
  await expect(popup.locator('.history-title strong')).toHaveText(
    'Extension test fixture',
  );
  await popup
    .getByRole('button', { name: 'Delete export: Extension test fixture' })
    .click();
  await expect(popup.getByText('No exports yet.')).toBeVisible();
  expect(
    context.pages().filter((page) => page.url() === `${extension}/index.html`),
  ).toHaveLength(0);
  expect(
    await popup.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.querySelector('.popup')!.getBoundingClientRect().height,
    })),
  ).toEqual({ width: 440, height: 600 });
  expect(errors).toEqual([]);
  await popup.close();
});

test('popup explains an offline companion and reconnects without reopening', async () => {
  const popup = await context.newPage();
  await popup.route('http://127.0.0.1:3002/api/**', (route) => route.abort());
  await popup.goto(`${extension}/popup.html`);
  await expect(popup.getByText('Local companion is offline')).toBeVisible();
  await expect(popup.getByText('npm start', { exact: true })).toBeVisible();
  await expect(
    popup
      .getByRole('navigation', { name: 'Popup views' })
      .getByRole('button', { name: 'Create a video', exact: true }),
  ).toBeEnabled();
  await popup.unroute('http://127.0.0.1:3002/api/**');
  await expect(popup.getByText('Local companion connected')).toBeVisible();
  await popup.close();
});

test('failed video loads can be retried and exports can be cancelled within the popup', async () => {
  const popup = await context.newPage();
  await popup.goto(`${extension}/popup.html`);
  await expect(popup.getByText('Local companion connected')).toBeVisible();
  await popup.getByRole('button', { name: 'New video', exact: true }).click();
  await popup.route(
    'http://127.0.0.1:3002/api/inspect',
    (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'This video is unavailable.' }),
      }),
    { times: 1 },
  );
  await popup
    .getByRole('textbox', { name: 'YouTube video link' })
    .fill('https://youtu.be/jNQXAC9IVRw');
  const tabCount = context.pages().length;
  await popup.getByRole('button', { name: 'Choose clip & format' }).click();
  await expect(popup.getByRole('alert')).toHaveText(
    'This video is unavailable.',
  );
  await popup.getByRole('button', { name: 'Choose clip & format' }).click();
  await expect(
    popup.getByRole('heading', { name: 'Extension test fixture' }),
  ).toBeVisible();
  await popup.getByRole('textbox', { name: 'Clip end time' }).fill('0:02');
  await popup
    .getByRole('button', { name: 'Prepare for X', exact: true })
    .click();
  await popup
    .getByRole('region', { name: 'Export status' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(
    popup
      .getByRole('region', { name: 'Export status' })
      .getByText('Export cancelled.', { exact: true })
      .first(),
  ).toBeVisible();
  await popup
    .getByRole('button', { name: 'My downloads', exact: true })
    .click();
  await expect(popup.locator('.history-title span')).toContainText('cancelled');
  expect(context.pages()).toHaveLength(tabCount);
  expect(errors).toEqual([]);
  await popup.close();
});
