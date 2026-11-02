// QueueCraft - Content Script for YouTube & YouTube Kids

(() => {
  let queue = [];
  let currentIndex = 0;
  let isAutoPlayActive = false;

  // i18n helper with fallbacks
  function t(key, substitutions, fallback) {
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const msg = chrome.i18n.getMessage(key, substitutions);
      if (msg) return msg;
    }
    return fallback || key;
  }

  let currentTabId = null;
  let tabIdPromise = null;
  const storageArea = chrome.storage.local;

  function ensureTabId() {
    if (currentTabId !== null) return Promise.resolve(currentTabId);
    if (!tabIdPromise) {
      tabIdPromise = new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'getTabId' }, (res) => {
            if (res && res.tabId) {
              currentTabId = res.tabId;
            }
            resolve(currentTabId);
          });
        } else {
          resolve(null);
        }
      });
    }
    return tabIdPromise;
  }

  function getStorageKeys() {
    const suffix = currentTabId !== null ? `_${currentTabId}` : '';
    return {
      queueKey: `kp_queue${suffix}`,
      indexKey: `kp_current_index${suffix}`,
      autoplayKey: `kp_autoplay${suffix}`
    };
  }

  // Sync state from storage
  function loadQueue(callback) {
    if (!storageArea) return;
    ensureTabId().then(() => {
      const { queueKey, indexKey, autoplayKey } = getStorageKeys();
      storageArea.get([queueKey, indexKey, autoplayKey], (res) => {
        queue = res[queueKey] || [];
        currentIndex = res[indexKey] || 0;
        isAutoPlayActive = res[autoplayKey] || false;
        updateFloatingBar();
        updateAllButtonStates();
        if (callback) callback();
      });
    });
  }

  function saveQueue() {
    if (!storageArea) return;
    ensureTabId().then(() => {
      const { queueKey, indexKey, autoplayKey } = getStorageKeys();
      storageArea.set({
        [queueKey]: queue,
        [indexKey]: currentIndex,
        [autoplayKey]: isAutoPlayActive
      }, () => {
        updateFloatingBar();
        updateAllButtonStates();
      });
    });
  }

  // Toast feedback
  function showToast(msg) {
    let toast = document.getElementById('kp-toast-elem');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'kp-toast-elem';
      toast.className = 'kp-toast';
      (document.body || document.documentElement).appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('kp-show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('kp-show');
    }, 2000);
  }

  // Parse YouTube video ID
  function extractVideoId(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.searchParams.has('v')) {
        return parsed.searchParams.get('v');
      }
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (parsed.hostname.includes('youtu.be') && pathParts[0]) {
        return pathParts[0];
      }
      if ((pathParts[0] === 'watch' || pathParts[0] === 'shorts') && pathParts[1]) {
        return pathParts[1];
      }
    } catch (e) {}
    return null;
  }

  // Parse duration text (e.g. "3:45", "1:15:20") or text like "15 minutes, 30 seconds"
  function parseDurationText(str) {
    if (!str) return 0;
    const clean = str.trim();

    // 1. Digital format: e.g. "3:45", "03:45", "1:12:05"
    const matchTime = clean.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (matchTime) {
      if (matchTime[3] !== undefined) {
        return parseInt(matchTime[1], 10) * 3600 + parseInt(matchTime[2], 10) * 60 + parseInt(matchTime[3], 10);
      }
      return parseInt(matchTime[1], 10) * 60 + parseInt(matchTime[2], 10);
    }

    // 2. Text description: e.g. "3 minutes, 45 seconds" / "3 phút, 45 giây"
    let total = 0;
    const hrs = clean.match(/(\d+)\s*(?:hours?|hrs?|giờ)/i);
    const mins = clean.match(/(\d+)\s*(?:minutes?|mins?|phút)/i);
    const secs = clean.match(/(\d+)\s*(?:seconds?|secs?|giây)/i);
    if (hrs || mins || secs) {
      if (hrs) total += parseInt(hrs[1], 10) * 3600;
      if (mins) total += parseInt(mins[1], 10) * 60;
      if (secs) total += parseInt(secs[1], 10);
      return total;
    }

    return 0;
  }

  function formatDigitalDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${m}:${pad(s)}`;
  }

  function formatTotalDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    const totalMinutes = Math.round(seconds / 60);
    if (totalMinutes < 60) {
      return `${totalMinutes}m`;
    }
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }

  // Exact sum of durations of all queued videos
  function calculateTotalSeconds() {
    return queue.reduce((sum, item) => sum + (Number(item.durationSec) || 0), 0);
  }

  // Deep scraper to extract exact video duration from card/parent elements
  function extractDuration(card) {
    if (!card) return { sec: 0, text: '' };

    const selectors = [
      'ytd-thumbnail-overlay-time-status-renderer #text',
      'ytd-thumbnail-overlay-time-status-renderer span',
      '.ytk-thumbnail-overlay-time-status-renderer',
      '.ytd-thumbnail-overlay-time-status-renderer',
      'span#text.ytd-thumbnail-overlay-time-status-renderer',
      '.badge-shape-wiz__text',
      '[class*="time-status"] span',
      '[class*="time-status"]',
      '.ytk-compact-video-renderer__metadata span'
    ];

    for (const sel of selectors) {
      const el = card.querySelector(sel);
      if (el && el.textContent) {
        const text = el.textContent.trim();
        const sec = parseDurationText(text);
        if (sec > 0) {
          return { sec, text: formatDigitalDuration(sec) };
        }
      }
    }

    const ariaElems = card.querySelectorAll('[aria-label]');
    for (const el of ariaElems) {
      const label = el.getAttribute('aria-label') || '';
      const sec = parseDurationText(label);
      if (sec > 0) {
        return { sec, text: formatDigitalDuration(sec) };
      }
    }

    return { sec: 0, text: '' };
  }

  // Deep scraper to extract exact video title directly from YouTube & YouTube Kids DOM
  function extractTitle(card) {
    if (!card) return '';

    // Helper to sanitize title strings (removing leading/trailing "Video " or metadata)
    function sanitizeTitle(raw) {
      if (!raw) return '';
      let cleaned = raw.trim();
      // If title begins with "Video " (common in YouTube Kids aria-labels), strip it
      cleaned = cleaned.replace(/^Video\s+/i, '');
      return cleaned.trim();
    }

    // 1. YouTube Kids direct element selectors
    // Structure: .details .primary-text span[dir="auto"], .primary-text, .details
    const ytkSpecific = card.querySelector(
      '.primary-text span[dir="auto"], .primary-text span, .primary-text, .details span, .ytk-compact-video-renderer__title'
    );
    if (ytkSpecific) {
      const text = (ytkSpecific.textContent || '').trim();
      if (text && text !== 'YouTube Video' && text.length > 1) {
        return sanitizeTitle(text);
      }
    }

    // 2. Standard YouTube video-title & heading elements
    const standardTitle = card.querySelector(
      '#video-title, .title, [id="title"], h3, h4, yt-formatted-string#video-title'
    );
    if (standardTitle) {
      const text = (standardTitle.getAttribute('title') || standardTitle.textContent || '').trim();
      if (text && text !== 'YouTube Video' && text.length > 1) {
        return sanitizeTitle(text);
      }
    }

    // 3. Main link aria-label / title (e.g. <a aria-label="Video 🐱🐱🐱 ... 2 phút, 29 giây">)
    const mainLink = card.querySelector('a.yt-simple-endpoint[aria-label], a[href*="/watch"][aria-label]');
    if (mainLink) {
      let aria = (mainLink.getAttribute('aria-label') || '').trim();
      if (aria) {
        // Remove trailing duration text like "2 phút, 29 giây" or "2 minutes, 29 seconds" or "2:29"
        aria = aria.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/i, '');
        aria = aria.replace(/\s+\d+\s*(?:minutes?|mins?|phút)?(?:,\s*\d+\s*(?:seconds?|secs?|giây)?)?\s*$/i, '');
        const clean = sanitizeTitle(aria);
        if (clean && clean.length > 1) {
          return clean;
        }
      }
    }

    // 4. Any thumbnail or card level title
    const otherTitle = card.getAttribute('title') || (card.querySelector('[title]') && card.querySelector('[title]').getAttribute('title'));
    if (otherTitle && otherTitle.trim().length > 1) {
      return sanitizeTitle(otherTitle);
    }

    return '';
  }

  // Fullscreen detection to guarantee hiding in full screen (YouTube player & native browser fullscreen)
  function setupFullscreenDetection() {
    function checkFullscreen() {
      const isNativeFull = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );

      // YouTube & YouTube Kids player fullscreen detection via DOM classes / attributes
      const player = document.querySelector('#movie_player, .html5-video-player, ytd-player, ytk-player');
      const isPlayerFull = player ? (
        player.classList.contains('ytp-fullscreen') ||
        player.classList.contains('fullscreen') ||
        player.getAttribute('fullscreen') !== null
      ) : false;

      const isFull = isNativeFull || isPlayerFull;
      if (document.body) {
        document.body.classList.toggle('kp-is-fullscreen', isFull);
      }
      if (document.documentElement) {
        document.documentElement.classList.toggle('kp-is-fullscreen', isFull);
      }
    }

    document.addEventListener('fullscreenchange', checkFullscreen);
    document.addEventListener('webkitfullscreenchange', checkFullscreen);
    document.addEventListener('mozfullscreenchange', checkFullscreen);
    window.addEventListener('resize', checkFullscreen);

    // Watch for class changes on YouTube player (e.g. ytp-fullscreen toggle)
    const playerObserver = new MutationObserver(() => {
      checkFullscreen();
    });

    function attachPlayerObserver() {
      const player = document.querySelector('#movie_player, .html5-video-player, ytd-player, ytk-player');
      if (player && !player._kpObserved) {
        player._kpObserved = true;
        playerObserver.observe(player, { attributes: true, attributeFilter: ['class', 'fullscreen'] });
      }
    }

    setInterval(attachPlayerObserver, 1500);
    setInterval(checkFullscreen, 500);
  }

  // Minimal Floating Dock (Play with count + Exact total time + Clear button)
  function createFloatingBar() {
    if (document.getElementById('kp-floating-bar')) return;

    const playLabel = t('play', null, 'Play');
    const clearTitle = t('clearQueue', null, 'Clear Queue');
    const playTitle = t('playQueue', null, 'Play Queue');

    const bar = document.createElement('div');
    bar.id = 'kp-floating-bar';
    bar.innerHTML = `
      <button class="kp-dock-play-btn" id="kp-btn-start" title="${playTitle}">
        <span>▶ ${playLabel}</span>
        <span class="kp-dock-count" id="kp-bar-count">0</span>
      </button>
      <span class="kp-dock-time" id="kp-bar-time"></span>
      <button class="kp-dock-clear-btn" id="kp-btn-clear" title="${clearTitle}">✕</button>
    `;

    (document.body || document.documentElement).appendChild(bar);

    const btnStart = document.getElementById('kp-btn-start');
    if (btnStart) {
      btnStart.addEventListener('click', () => {
        if (queue.length === 0) return;
        isAutoPlayActive = true;
        currentIndex = 0;
        saveQueue();
        playVideoAt(0);
      });
    }

    const btnClear = document.getElementById('kp-btn-clear');
    if (btnClear) {
      btnClear.addEventListener('click', (e) => {
        e.stopPropagation();
        queue = [];
        currentIndex = 0;
        isAutoPlayActive = false;
        saveQueue();
        showToast(t('queueCleared', null, 'Queue cleared'));
      });
    }

    updateFloatingBar();
  }

  function updateFloatingBar() {
    const bar = document.getElementById('kp-floating-bar');
    if (!bar) return;

    const countSpan = document.getElementById('kp-bar-count');
    if (countSpan) {
      countSpan.textContent = queue.length;
    }

    const timeSpan = document.getElementById('kp-bar-time');
    if (timeSpan) {
      const totalSec = calculateTotalSeconds();
      if (queue.length > 0 && totalSec > 0) {
        timeSpan.textContent = formatTotalDuration(totalSec);
        timeSpan.style.display = 'inline';
      } else {
        timeSpan.textContent = '';
        timeSpan.style.display = 'none';
      }
    }

    const playBtnText = document.querySelector('#kp-btn-start span:first-child');
    if (playBtnText) {
      const playLabel = t('play', null, 'Play');
      playBtnText.textContent = isAutoPlayActive
        ? `▶ ${t('playingStatus', [String(currentIndex + 1), String(queue.length)], `Playing (${currentIndex + 1}/${queue.length})`)}`
        : `▶ ${playLabel}`;
    }

    // Display whenever there is at least one video in the queue, regardless of page or play mode
    if (queue.length === 0) {
      bar.classList.add('kp-collapsed');
    } else {
      bar.classList.remove('kp-collapsed');
    }
  }

  // Update visual state and overlays for thumbnails
  function updateAllButtonStates() {
    const allButtons = document.querySelectorAll('.kp-add-btn');
    allButtons.forEach((btn) => {
      const vid = btn.dataset.kpVideoId;
      if (!vid) return;

      const thumbContainer = btn.parentElement;
      const foundIdx = queue.findIndex(v => v.id === vid);

      if (foundIdx !== -1) {
        btn.classList.add('kp-added');
        const badgeTitle = t('queueItem', [String(foundIdx + 1)], `Queue #${foundIdx + 1}`) + ` (${t('removeFromQueue', null, 'Click to remove')})`;
        btn.title = badgeTitle;
        btn.innerHTML = `<span class="kp-order-text">${foundIdx + 1}</span>`;

        if (thumbContainer) {
          thumbContainer.classList.add('kp-thumbnail-selected');
          let overlay = thumbContainer.querySelector('.kp-selected-overlay');
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'kp-selected-overlay';
            thumbContainer.insertBefore(overlay, btn);
          }
        }
      } else {
        btn.classList.remove('kp-added');
        btn.title = t('addToQueue', null, 'Add to Queue');
        btn.innerHTML = '+';

        if (thumbContainer) {
          thumbContainer.classList.remove('kp-thumbnail-selected');
          const overlay = thumbContainer.querySelector('.kp-selected-overlay');
          if (overlay) overlay.remove();
        }
      }
    });
  }

  // Play video at index
  function playVideoAt(index) {
    if (index >= queue.length) {
      isAutoPlayActive = false;
      saveQueue();
      showToast(t('queueFinished', null, 'Queue finished'));
      return;
    }
    currentIndex = index;
    saveQueue();
    const item = queue[index];
    const statusText = t('playingStatus', [String(index + 1), String(queue.length)], `Playing (${index + 1}/${queue.length})`);
    showToast(`▶ ${statusText}`);

    let targetUrl = item.url;
    if (window.location.hostname.includes('youtubekids.com')) {
      targetUrl = `https://www.youtubekids.com/watch?v=${item.id}`;
    } else if (window.location.hostname.includes('youtube.com') && targetUrl.includes('youtubekids.com')) {
      targetUrl = `https://www.youtube.com/watch?v=${item.id}`;
    }

    window.location.href = targetUrl;
  }

  // Auto Advance when Video Ends
  function setupVideoEndListener() {
    setInterval(() => {
      const video = document.querySelector('video');
      if (video && !video.dataset.kpListenerAttached) {
        video.dataset.kpListenerAttached = 'true';
        video.addEventListener('ended', () => {
          if (!isAutoPlayActive) return;
          loadQueue(() => {
            if (currentIndex + 1 < queue.length) {
              setTimeout(() => {
                playVideoAt(currentIndex + 1);
              }, 1000);
            } else {
              isAutoPlayActive = false;
              saveQueue();
              showToast(t('queueFinished', null, 'Queue finished'));
            }
          });
        });
      }
    }, 1200);
  }

  // Attach (+) buttons to video thumbnail cards
  function attachButtons() {
    const cardSelectors = [
      'ytd-rich-item-renderer',
      'ytd-video-renderer',
      'ytd-grid-video-renderer',
      'ytd-compact-video-renderer',
      'ytk-compact-video-renderer',
      'ytk-grid-video-renderer',
      'ytk-video-renderer',
      'yt-horizontal-list-renderer .ytk-item',
      '.ytk-compact-video-renderer',
      '.ytk-grid-video-renderer',
      'ytk-shelf-renderer',
      '[class*="video-renderer"]'
    ];

    const cards = document.querySelectorAll(cardSelectors.join(','));

    cards.forEach((card) => {
      const linkElem = card.querySelector('a[href*="/watch"], a#thumbnail, a.ytk-compact-video-renderer__link');
      if (!linkElem) return;

      const href = linkElem.getAttribute('href');
      const videoId = extractVideoId(href);
      if (!videoId) return;

      const thumbContainer = card.querySelector(
        'ytd-thumbnail, #thumbnail, .thumbnail, .ytk-thumbnail, .ytk-compact-video-renderer__thumbnail, [class*="thumbnail"]'
      ) || linkElem;

      if (!thumbContainer || card.querySelector(`.kp-add-btn[data-kp-video-id="${videoId}"]`)) {
        return;
      }

      if (window.getComputedStyle(thumbContainer).position === 'static') {
        thumbContainer.style.position = 'relative';
      }

      const titleElem = card.querySelector(
        '#video-title, .title, [id="title"], h3, .ytk-compact-video-renderer__title, [class*="video-title"]'
      );
      const title = titleElem ? (titleElem.getAttribute('title') || titleElem.textContent || '').trim() : 'YouTube Video';

      const img = thumbContainer.querySelector('img');
      const thumbUrl = (img && (img.currentSrc || img.src)) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      const btn = document.createElement('button');
      btn.className = 'kp-add-btn';
      btn.dataset.kpVideoId = videoId;
      btn.title = t('addToQueue', null, 'Add to Queue');
      btn.innerHTML = '+';

      const existingIdx = queue.findIndex(v => v.id === videoId);
      if (existingIdx !== -1) {
        btn.classList.add('kp-added');
        const badgeTitle = t('queueItem', [String(existingIdx + 1)], `Queue #${existingIdx + 1}`) + ` (${t('removeFromQueue', null, 'Click to remove')})`;
        btn.title = badgeTitle;
        btn.innerHTML = `<span class="kp-order-text">${existingIdx + 1}</span>`;

        thumbContainer.classList.add('kp-thumbnail-selected');
        let overlay = thumbContainer.querySelector('.kp-selected-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = 'kp-selected-overlay';
          thumbContainer.appendChild(overlay);
        }
      }

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const fullUrl = href.startsWith('http') ? href : (window.location.origin + href);
        const itemIdx = queue.findIndex(v => v.id === videoId);

        if (itemIdx !== -1) {
          queue.splice(itemIdx, 1);
          if (currentIndex >= queue.length) {
            currentIndex = Math.max(0, queue.length - 1);
          }
          saveQueue();
          showToast(t('removedToast', null, 'Removed from queue'));
        } else {
          const durationData = extractDuration(card);
          const dynamicTitle = extractTitle(card);
          const newItem = {
            id: videoId,
            title: dynamicTitle || 'YouTube Video',
            url: fullUrl,
            thumb: thumbUrl,
            durationSec: durationData.sec,
            durationText: durationData.text,
            addedAt: Date.now()
          };
          queue.push(newItem);
          saveQueue();
          showToast(t('addedToast', [String(queue.length)], `Added #${queue.length}`));
        }
      });

      thumbContainer.appendChild(btn);
    });

    // Handle standalone thumbnails
    const standaloneThumbs = document.querySelectorAll('a#thumbnail[href*="/watch"]:not([data-kp-processed])');
    standaloneThumbs.forEach((thumbLink) => {
      thumbLink.dataset.kpProcessed = 'true';
      if (thumbLink.querySelector('.kp-add-btn') || thumbLink.closest(cardSelectors.join(','))) return;

      const href = thumbLink.getAttribute('href');
      const videoId = extractVideoId(href);
      if (!videoId) return;

      if (window.getComputedStyle(thumbLink).position === 'static') {
        thumbLink.style.position = 'relative';
      }

      const img = thumbLink.querySelector('img');
      const thumbUrl = (img && (img.currentSrc || img.src)) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      const btn = document.createElement('button');
      btn.className = 'kp-add-btn';
      btn.dataset.kpVideoId = videoId;
      btn.title = t('addToQueue', null, 'Add to Queue');
      btn.innerHTML = '+';

      const existingIdx = queue.findIndex(v => v.id === videoId);
      if (existingIdx !== -1) {
        btn.classList.add('kp-added');
        const badgeTitle = t('queueItem', [String(existingIdx + 1)], `Queue #${existingIdx + 1}`) + ` (${t('removeFromQueue', null, 'Click to remove')})`;
        btn.title = badgeTitle;
        btn.innerHTML = `<span class="kp-order-text">${existingIdx + 1}</span>`;

        thumbLink.classList.add('kp-thumbnail-selected');
        let overlay = thumbLink.querySelector('.kp-selected-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = 'kp-selected-overlay';
          thumbLink.appendChild(overlay);
        }
      }

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const fullUrl = href.startsWith('http') ? href : (window.location.origin + href);
        const itemIdx = queue.findIndex(v => v.id === videoId);

        if (itemIdx !== -1) {
          queue.splice(itemIdx, 1);
          if (currentIndex >= queue.length) {
            currentIndex = Math.max(0, queue.length - 1);
          }
          saveQueue();
          showToast(t('removedToast', null, 'Removed from queue'));
        } else {
          const parentContainer = thumbLink.parentElement || thumbLink;
          const durationData = extractDuration(parentContainer);
          const dynamicTitle = extractTitle(parentContainer) || thumbLink.getAttribute('title') || thumbLink.getAttribute('aria-label') || '';
          const newItem = {
            id: videoId,
            title: dynamicTitle || 'YouTube Video',
            url: fullUrl,
            thumb: thumbUrl,
            durationSec: durationData.sec,
            durationText: durationData.text,
            addedAt: Date.now()
          };
          queue.push(newItem);
          saveQueue();
          showToast(t('addedToast', [String(queue.length)], `Added #${queue.length}`));
        }
      });

      thumbLink.appendChild(btn);
    });
  }

  // Initialize
  function init() {
    createFloatingBar();
    setupVideoEndListener();
    setupFullscreenDetection();
    attachButtons();

    // Query current tab ID from background service worker to isolate queue per tab
    ensureTabId().then(() => {
      loadQueue();
    });

    let debounceTimer;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        attachButtons();
      }, 150);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener('yt-navigate-finish', () => {
      updateFloatingBar();
      setTimeout(attachButtons, 500);
    });
    window.addEventListener('popstate', () => {
      updateFloatingBar();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // React to storage changes for this tab only (e.g. from popup targeting this tab)
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      const isTargetArea = area === 'session' || area === 'local';
      if (!isTargetArea) return;

      const { queueKey, indexKey, autoplayKey } = getStorageKeys();
      let changed = false;

      if (changes[queueKey]) {
        queue = changes[queueKey].newValue || [];
        changed = true;
      }
      if (changes[indexKey]) {
        currentIndex = changes[indexKey].newValue || 0;
        changed = true;
      }
      if (changes[autoplayKey]) {
        isAutoPlayActive = changes[autoplayKey].newValue || false;
        changed = true;
      }

      if (changed) {
        updateFloatingBar();
        updateAllButtonStates();
      }
    });
  }
})();
