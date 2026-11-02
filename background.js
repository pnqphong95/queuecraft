// QueueCraft - Background Service Worker (Per-tab queue isolation)

const storageArea = chrome.storage.local;

// Clear all queues on browser startup
chrome.runtime.onStartup.addListener(() => {
  storageArea.get(null, (items) => {
    const keysToRemove = Object.keys(items || {}).filter(k => k.startsWith('kp_'));
    if (keysToRemove.length > 0) storageArea.remove(keysToRemove);
  });
});

// Clear on extension install / reload
chrome.runtime.onInstalled.addListener(() => {
  storageArea.get(null, (items) => {
    const keysToRemove = Object.keys(items || {}).filter(k => k.startsWith('kp_'));
    if (keysToRemove.length > 0) storageArea.remove(keysToRemove);
  });
});

// Clear on system lock or sleep/idle
if (chrome.idle && chrome.idle.onStateChanged) {
  chrome.idle.onStateChanged.addListener((state) => {
    if (state === 'locked' || state === 'idle') {
      storageArea.get(null, (items) => {
        const keysToRemove = Object.keys(items || {}).filter(k => k.startsWith('kp_'));
        if (keysToRemove.length > 0) storageArea.remove(keysToRemove);
      });
    }
  });
}

// Clean up isolated queue when a tab is closed
if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    storageArea.remove([
      `kp_queue_${tabId}`,
      `kp_current_index_${tabId}`,
      `kp_autoplay_${tabId}`
    ]);
  });
}

// Message handler to provide tabId to caller (content scripts, etc.)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTabId') {
    const tabId = sender.tab ? sender.tab.id : null;
    sendResponse({ tabId });
    return false;
  }
});
