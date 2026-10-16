import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(
  <main><h1>PostReady</h1><button onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })}>Open workspace</button></main>,
);
