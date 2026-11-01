// QueueCraft - Popup Manager with Drag-to-Reorder & i18n Support

document.addEventListener('DOMContentLoaded', () => {
  const videoList = document.getElementById('video-list');
  const headerCount = document.getElementById('header-count');
  const headerTime = document.getElementById('header-time');
  const btnPlay = document.getElementById('btn-play');
  const btnClear = document.getElementById('btn-clear');
  const actionBar = document.getElementById('action-bar');

  // i18n helper with fallbacks
  function t(key, substitutions, fallback) {
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const msg = chrome.i18n.getMessage(key, substitutions);
      if (msg) return msg;
    }
    return fallback || key;
  }

  let queue = [];
  let currentIndex = 0;
  let isAutoPlayActive = false;
  let dragSrcIndex = null;

  // Initialize static UI strings with current locale
  if (btnClear) {
    btnClear.textContent = t('clear', null, 'Clear');
  }

  function loadState() {
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(['kp_queue', 'kp_current_index', 'kp_autoplay'], (res) => {
      queue = res.kp_queue || [];
      currentIndex = res.kp_current_index || 0;
      isAutoPlayActive = res.kp_autoplay || false;
      render();
    });
  }

  function saveState() {
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.set({
      kp_queue: queue,
      kp_current_index: currentIndex,
      kp_autoplay: isAutoPlayActive
    }, () => {
      render();
    });
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

  function getTargetUrl(item, activeTabUrl) {
    if (activeTabUrl && activeTabUrl.includes('youtubekids.com')) {
      return `https://www.youtubekids.com/watch?v=${item.id}`;
    }
    if (activeTabUrl && activeTabUrl.includes('youtube.com')) {
      return `https://www.youtube.com/watch?v=${item.id}`;
    }
    return item.url || `https://www.youtube.com/watch?v=${item.id}`;
  }

  function render() {
    videoList.innerHTML = '';
    const count = queue.length;
    headerCount.textContent = t('vidsCount', [String(count)], `${count} vids`);

    if (count === 0) {
      if (headerTime) headerTime.textContent = '';
      if (actionBar) actionBar.style.display = 'none';
      videoList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📺</div>
          <div class="empty-title">${t('emptyTitle', null, 'Queue is empty')}</div>
          <div class="empty-hint">${t('emptyHint', null, 'Click (+) on any video to add')}</div>
        </div>
      `;
      return;
    }

    const totalSeconds = calculateTotalSeconds();
    if (headerTime) {
      headerTime.textContent = totalSeconds > 0 ? formatTotalDuration(totalSeconds) : '';
    }

    if (actionBar) actionBar.style.display = 'flex';
    btnPlay.textContent = isAutoPlayActive
      ? `▶ ${t('playingStatus', [String(currentIndex + 1), String(count)], `Playing (${currentIndex + 1}/${count})`)}`
      : `▶ ${t('playQueue', null, 'Play Queue')}`;

    const dragTooltip = t('dragReorder', null, 'Drag to reorder');
    const removeTooltip = t('remove', null, 'Remove');

    queue.forEach((item, idx) => {
      const li = document.createElement('li');
      const isCurrent = isAutoPlayActive && idx === currentIndex;
      li.className = `video-item ${isCurrent ? 'active' : ''}`;
      li.draggable = true;
      li.dataset.index = idx;

      const durBadge = item.durationText ? `<span class="video-dur-badge">${item.durationText}</span>` : '';

      li.innerHTML = `
        <span class="drag-handle" title="${dragTooltip}">⋮⋮</span>
        <span class="video-order">${idx + 1}</span>
        <div class="video-thumb-container">
          <img class="video-thumb" src="${item.thumb || 'https://i.ytimg.com/vi/' + item.id + '/hqdefault.jpg'}" alt="thumb">
          ${durBadge}
        </div>
        <div class="video-info">
          <span class="video-title" title="${item.title}">${item.title}</span>
        </div>
        <button class="btn-remove-item" title="${removeTooltip}">✕</button>
      `;

      // Drag and Drop Event Listeners
      li.addEventListener('dragstart', (e) => {
        dragSrcIndex = idx;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
      });

      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        document.querySelectorAll('.video-item').forEach(el => el.classList.remove('drag-over'));
      });

      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        li.classList.add('drag-over');
      });

      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over');
      });

      li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        const targetIndex = idx;

        if (dragSrcIndex !== null && dragSrcIndex !== targetIndex) {
          const movedItem = queue.splice(dragSrcIndex, 1)[0];
          queue.splice(targetIndex, 0, movedItem);

          if (currentIndex === dragSrcIndex) {
            currentIndex = targetIndex;
          } else if (dragSrcIndex < currentIndex && targetIndex >= currentIndex) {
            currentIndex--;
          } else if (dragSrcIndex > currentIndex && targetIndex <= currentIndex) {
            currentIndex++;
          }

          saveState();
        }
      });

      // Jump directly to video on click
      li.querySelector('.video-info').addEventListener('click', () => {
        currentIndex = idx;
        isAutoPlayActive = true;
        saveState();
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs && tabs[0];
          const target = getTargetUrl(item, activeTab ? activeTab.url : '');
          if (activeTab) {
            chrome.tabs.update(activeTab.id, { url: target });
          } else {
            chrome.tabs.create({ url: target });
          }
        });
      });

      // Remove single item
      li.querySelector('.btn-remove-item').addEventListener('click', (e) => {
        e.stopPropagation();
        queue.splice(idx, 1);
        if (currentIndex >= queue.length) {
          currentIndex = Math.max(0, queue.length - 1);
        }
        saveState();
      });

      videoList.appendChild(li);
    });
  }

  // Play Queue button
  btnPlay.addEventListener('click', () => {
    if (queue.length === 0) return;
    isAutoPlayActive = true;
    currentIndex = 0;
    saveState();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs && tabs[0];
      const target = getTargetUrl(queue[0], activeTab ? activeTab.url : '');
      if (activeTab && activeTab.url && (activeTab.url.includes('youtube.com') || activeTab.url.includes('youtubekids.com'))) {
        chrome.tabs.update(activeTab.id, { url: target });
      } else {
        chrome.tabs.create({ url: target });
      }
    });
  });

  // Clear Queue button
  btnClear.addEventListener('click', () => {
    queue = [];
    currentIndex = 0;
    isAutoPlayActive = false;
    saveState();
  });

  // Storage listener
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes.kp_queue) queue = changes.kp_queue.newValue || [];
        if (changes.kp_current_index) currentIndex = changes.kp_current_index.newValue || 0;
        if (changes.kp_autoplay) isAutoPlayActive = changes.kp_autoplay.newValue || false;
        render();
      }
    });
  }

  loadState();
});
