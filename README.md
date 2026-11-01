# QueueCraft - YouTube & YouTube Kids Playlist & Autoplay

QueueCraft is a lightweight, distraction-free Chrome extension for **YouTube** and **YouTube Kids**. It allows users to quickly queue up videos from any browse or search page by clicking a `(+)` button on video thumbnails, then autoplays them sequentially.

## Features

- **One-Click Queuing**: Click `(+)` on thumbnails on YouTube or YouTube Kids. Queued videos show dynamic order badges (`1`, `2`, `3`...).
- **Drag-to-Reorder**: Reorder the playlist on the fly inside the popup.
- **Accurate Total Duration**: Calculates and displays the exact summed runtime across all queued videos.
- **Minimal Floating Dock**: A pill-shaped floating dock (`[ ▶ Play | 3 ] 18m [ ✕ ]`) that stays unobtrusive and auto-hides while watching videos.
- **Session Auto-Reset**: Resets the queue when closing the browser or putting the system to sleep.
- **Multi-language Support (i18n)**: English (`en`) and Vietnamese (`vi`).
- **Seamless Kids & Main Platform Switching**: Works transparently whether you are on `youtube.com` or `youtubekids.com`.

## Installation (Local Development)

1. Clone or download this repository.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in top right).
4. Click **Load unpacked** and select this directory.

## Project Structure

```
├── manifest.json        # Extension Manifest V3
├── background.js        # Service worker for startup & sleep/idle reset
├── content.js           # Injected DOM script for buttons & video detection
├── content.css          # Minimal styles for badges & dock
├── popup.html           # Queue manager popup UI
├── popup.js             # Drag-and-drop & playback controller
├── _locales/            # Internationalization (en, vi)
└── icons/               # Extension icons (16px, 48px, 128px)
```

## Packaging for Chrome Web Store

Run:
```bash
zip -r queuecraft.zip manifest.json background.js content.js content.css popup.html popup.js _locales/ icons/ -x "*.DS_Store*"
```

Upload `queuecraft.zip` to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## License

MIT
