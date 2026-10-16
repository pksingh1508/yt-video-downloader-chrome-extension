import { canonicalYouTubeUrl } from './shared';

const studioUrl = chrome.runtime.getURL('index.html');
let opening = Promise.resolve();

async function focusStudio(input?: string) {
  const url = input ? canonicalYouTubeUrl(input) : undefined;
  if (url)
    await chrome.storage.local.set({
      pendingVideo: { url, requestedAt: Date.now() },
    });
  const tabs = await chrome.tabs.query({ url: `${studioUrl}*` });
  const tab = tabs.find((tab) => tab.id !== undefined);
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: studioUrl });
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL('')) ||
    message?.type !== 'OPEN_STUDIO'
  )
    return;
  if (message.url !== undefined && typeof message.url !== 'string') {
    respond({ ok: false, error: 'Enter a YouTube video link.' });
    return;
  }
  // Serialize simultaneous clicks so they reuse a single workspace tab.
  opening = opening.catch(() => {}).then(() => focusStudio(message.url));
  void opening.then(
    () => respond({ ok: true }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install')
    opening = opening.catch(() => {}).then(() => focusStudio());
});
