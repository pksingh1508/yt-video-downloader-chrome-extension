import { canonicalYouTubeUrl } from './shared';

export async function openStudio(input?: string): Promise<void> {
  const url = input ? canonicalYouTubeUrl(input) : undefined;
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    window.location.href = `./index.html${url ? `?url=${encodeURIComponent(url)}` : ''}`;
    return;
  }
  const result = await chrome.runtime.sendMessage({ type: 'OPEN_STUDIO', url });
  if (!result?.ok)
    throw new Error(
      result?.error ||
        'Couldn’t open your workspace. Reload the extension and try again.',
    );
}
