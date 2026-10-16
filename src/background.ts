chrome.runtime.onInstalled.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
