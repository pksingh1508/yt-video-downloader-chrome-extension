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
    args: [
      `--disable-extensions-except=${directory}`,
      `--load-extension=${directory}`,
    ],
  });
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  expect(worker.url()).toBe(`${extension}/background.js`);
});

test.afterAll(async () => {
  await context?.close();
});

test('installed popup hands off valid links, reuses the studio, and exports survive closing it', async () => {
  await expect
    .poll(
      () =>
        context
          .pages()
          .filter((page) => page.url() === `${extension}/index.html`).length,
    )
    .toBe(1);
  let studio = context
    .pages()
    .find((page) => page.url() === `${extension}/index.html`)!;
  await expect(
    studio.getByText('Ready to process', { exact: true }),
  ).toBeVisible();
  const popup = await context.newPage();
  await popup.goto(`${extension}/popup.html`);
  await expect(popup.getByText('Local companion connected')).toBeVisible();
  const input = popup.getByRole('textbox', { name: 'YouTube video link' });
  await input.fill('https://evil.test/video');
  await expect(
    popup.getByRole('button', { name: 'Choose clip & format' }),
  ).toBeDisabled();
  await input.fill('https://youtu.be/jNQXAC9IVRw?t=1');
  await popup.getByRole('button', { name: 'Choose clip & format' }).click();
  await expect(
    studio.getByText('A video from your toolbar is ready.'),
  ).toBeVisible();
  expect(
    context.pages().filter((page) => page.url() === `${extension}/index.html`),
  ).toHaveLength(1);
  await studio.getByRole('button', { name: 'Use this link' }).click();
  await expect(
    studio.getByRole('textbox', { name: 'YouTube video link' }),
  ).toHaveValue('https://www.youtube.com/watch?v=jNQXAC9IVRw');
  await studio.getByRole('button', { name: 'Get video', exact: true }).click();
  await expect(
    studio.getByRole('heading', { name: 'Extension test fixture' }),
  ).toBeVisible();
  await studio.getByRole('textbox', { name: 'Clip end time' }).fill('0:02');
  await studio.getByRole('button', { name: '9:16', exact: true }).click();
  await studio.getByRole('button', { name: 'Dark theme' }).click();
  await studio.reload();
  await expect(
    studio.getByRole('textbox', { name: 'Clip end time' }),
  ).toHaveValue('0:02');
  await expect(
    studio.getByRole('button', { name: '9:16', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(studio.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(
    studio.getByText('Ready to process', { exact: true }),
  ).toBeVisible();
  await studio
    .getByRole('button', { name: 'Prepare for X', exact: true })
    .click();
  await expect(
    studio.getByText('Preparing video…', { exact: true }),
  ).toBeVisible();
  await studio.close();
  studio = await context.newPage();
  await studio.goto(`${extension}/index.html`);
  await expect(
    studio.getByRole('button', { name: 'Download MP4', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      studio!
        .locator('video')
        .evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  const media = await studio
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
  await studio
    .getByRole('button', { name: 'Download MP4', exact: true })
    .click();
  await expect
    .poll(() =>
      studio!.evaluate(async () => {
        const downloads = await chrome.downloads.search({
          limit: 1,
          orderBy: ['-startTime'],
        });
        return downloads[0]?.state;
      }),
    )
    .toBe('complete');
  await studio
    .getByRole('button', { name: 'My downloads', exact: true })
    .click();
  await expect(
    studio.getByRole('heading', { name: 'Extension test fixture' }),
  ).toBeVisible();
  await studio
    .getByRole('button', { name: 'Delete export: Extension test fixture' })
    .click();
  await expect(
    studio.getByText('A home for your next great post.'),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('popup explains an offline companion and reconnects without reopening', async () => {
  const popup = await context.newPage();
  await popup.route('http://127.0.0.1:3002/api/**', (route) => route.abort());
  await popup.goto(`${extension}/popup.html`);
  await expect(popup.getByText('Local companion is offline')).toBeVisible();
  await expect(popup.getByText('npm start', { exact: true })).toBeVisible();
  await expect(
    popup.getByRole('button', { name: 'Open workspace', exact: true }),
  ).toBeEnabled();
  await popup.unroute('http://127.0.0.1:3002/api/**');
  await expect(popup.getByText('Local companion connected')).toBeVisible();
  await popup.close();
});
