import { API_BASE } from './config';

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: options?.signal ?? AbortSignal.timeout(path === '/api/inspect' ? 130_000 : 15_000),
      headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers },
    });
  } catch {
    throw new Error('Couldn’t reach the local companion. Run npm start in the extension project, then try again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The request failed. Please try again.');
  return body as T;
}

export const fileUrl = (id: string, preview = false) =>
  `${API_BASE}/api/jobs/${encodeURIComponent(id)}/file${preview ? '?preview=1' : ''}`;

export async function downloadFile(id: string): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.downloads) {
    await chrome.downloads.download({ url: fileUrl(id), saveAs: true });
    return;
  }
  const link = document.createElement('a');
  link.href = fileUrl(id);
  link.download = '';
  link.click();
}
