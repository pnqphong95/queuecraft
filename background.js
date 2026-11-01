// QueueCraft - Background Service Worker

function clearQueue() {
  chrome.storage.local.set({
    kp_queue: [],
    kp_current_index: 0,
    kp_autoplay: false
  });
}

// Clear on browser startup
chrome.runtime.onStartup.addListener(() => {
  clearQueue();
});

// Clear on extension install / reload
chrome.runtime.onInstalled.addListener(() => {
  clearQueue();
});

// Clear on system lock or sleep/idle
if (chrome.idle && chrome.idle.onStateChanged) {
  chrome.idle.onStateChanged.addListener((state) => {
    if (state === 'locked' || state === 'idle') {
      clearQueue();
    }
  });
}
