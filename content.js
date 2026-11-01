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

  // Sync state from storage
  function loadQueue(callback) {
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(['kp_queue', 'kp_current_index', 'kp_autoplay'], (res) => {
      queue = res.kp_queue || [];
      currentIndex = res.kp_current_index || 0;
      isAutoPlayActive = res.kp_autoplay || false;
      updateFloatingBar();
      updateAllButtonStates();
      if (callback) callback();
    });
  }

  function saveQueue() {
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.set({
      kp_queue: queue,
      kp_current_index: currentIndex,
      kp_autoplay: isAutoPlayActive
    }, () => {
      updateFloatingBar();
      updateAllButtonStates();
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

  // Fullscreen detection to guarantee hiding in full screen
  function setupFullscreenDetection() {
    function checkFullscreen() {
      const isFull = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      if (document.body) {
        document.body.classList.toggle('kp-is-fullscreen', isFull);
      }
    }

    document.addEventListener('fullscreenchange', checkFullscreen);
    document.addEventListener('webkitfullscreenchange', checkFullscreen);
    document.addEventListener('mozfullscreenchange', checkFullscreen);
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

    const isWatchingVideo = window.location.pathname.includes('/watch') || window.location.pathname.includes('/shorts');
    if (queue.length === 0 || isWatchingVideo) {
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
          queue.push({
            id: videoId,
            title: title || 'YouTube Video',
            url: fullUrl,
            thumb: thumbUrl,
            durationSec: durationData.sec,
            durationText: durationData.text,
            addedAt: Date.now()
          });
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
          const durationData = extractDuration(thumbLink.parentElement || thumbLink);
          queue.push({
            id: videoId,
            title: 'YouTube Video',
            url: fullUrl,
            thumb: thumbUrl,
            durationSec: durationData.sec,
            durationText: durationData.text,
            addedAt: Date.now()
          });
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
    loadQueue();
    setupVideoEndListener();
    setupFullscreenDetection();
    attachButtons();

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

  // Sync across tabs
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.kp_queue) queue = changes.kp_queue.newValue || [];
        if (changes.kp_current_index) currentIndex = changes.kp_current_index.newValue || 0;
        if (changes.kp_autoplay) isAutoPlayActive = changes.kp_autoplay.newValue || false;
        updateFloatingBar();
        updateAllButtonStates();
      }
    });
  }
})();
