# PostReady for Chrome

A Manifest V3 Chrome extension that turns a YouTube video or selected clip into a verified MP4 for uploading to X. Adapted from the PostReady website; this repository includes its own local processing companion and does not need the original project folder.

## Install in Chrome

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run setup
npm run build
npm start
```

1. Open `chrome://extensions` in Chrome 120 or newer.
2. Enable **Developer mode** in the upper right.
3. Click **Load unpacked** and select **dist** inside this repository, not the repository root.
4. Pin **PostReady** using Chrome’s extensions menu.

The workspace opens on first installation. Keep `npm start` running while processing, previewing, or downloading videos. On future sessions, only `npm start` is needed. The companion binds to `127.0.0.1:3002`; the original website can keep using port 3001. Run commands from this repository’s root.

## Use it

1. Open a YouTube video and click PostReady’s toolbar icon, or paste a link into the popup from any page. Watch links, Shorts, `youtu.be`, embed, live-video links for finished videos, and mobile links are accepted.
2. Click **Choose clip & format**. In the workspace, click **Use this link**, then **Get video**. Opening another link reuses the workspace and keeps your current edit until you explicitly choose the new link.
3. Set start/end times using `m:ss` or `h:mm:ss`, an upload preset, 720p or 1080p, and Original / 16:9 / 1:1 / 9:16. Frame shapes preserve the whole image with padding.
4. Click **Prepare for X**. You can close the popup or workspace while the companion processes. Reopening restores the edit and export status.
5. Preview the verified result and click **Download MP4** to choose where Chrome saves it. Open X and attach that file to your post.

**My downloads** shows active and completed exports. Cancel active work or delete completed/failed exports there. Export preferences, edits, selected job, and theme survive closing Chrome. Completed files and job history live in `.data` and expire after 24 hours. Copies saved to Downloads are kept until you remove them yourself. A preview’s metadata expires after one hour or a companion restart; load the video link again if prompted.

## Output and upload limits

Exports are MP4 with H.264 High Profile, progressive 30 fps, YUV 4:2:0, square pixels, stereo AAC-LC, and streaming metadata at the beginning. Silent sources get an AAC track. The companion checks actual codecs, dimensions, duration, frame rate, file size, and a full decode before enabling download.

- **Standard:** up to 2:20 and 512 MB.
- **Premium:** under 4 hours and 16 GB for eligible accounts on x.com / iOS. Clips above 2 hours use 720p automatically.

Presets follow [X’s web video guide](https://help.x.com/en/using-x/x-videos) and [longer-video guide](https://help.x.com/en/using-x/premium-longer-videos), checked October 16, 2026. Account eligibility and X’s current policies still determine whether an upload is accepted. PostReady does not sign into X or publish posts.

## Why a local companion?

Chrome cannot execute yt-dlp or FFmpeg itself. The companion downloads, transcodes, and verifies files on your computer. It only accepts local clients and explicitly approved origins, including this extension’s stable ID. The manifest contains a public key, not a signing secret.

You do not need the original website running, a hosted service, Python, API keys, or an X login. `npm run setup` downloads the official yt-dlp binary and verifies its SHA-256 checksum. FFmpeg and FFprobe come from npm dependencies. Keep the manifest public key unchanged so the companion recognizes the extension ID: `plmpenlemcoifmbkbijdhpnieaklcbii`. Publishing under a Chrome Web Store key would require updating that key and the companion’s allowed ID together.

## Permissions and privacy

- `activeTab`: reads the current tab’s URL when you invoke the toolbar popup. No always-on access to browsing history and no content scripts.
- `storage`: hands selected links from the popup to the workspace. Editing preferences and drafts use extension-local browser storage.
- `downloads`: opens Chrome’s Save dialog and saves the verified MP4.
- `http://127.0.0.1/*`: talks to the local companion. Chrome host patterns do not support port restrictions; the extension’s content security policy restricts connections to port 3002.

Thumbnails load from YouTube, and the companion contacts YouTube and yt-dlp’s official JavaScript challenge component service when necessary. Fonts, scripts, and styles are bundled. There is no analytics, remote executable extension code, or automatic cookie access. Loopback-only binding, explicit origin checks, validated YouTube URLs, and subprocess argument arrays are retained from the website. This remains a single-user local application; do not expose the companion publicly.

## Troubleshooting and configuration

- **Companion offline:** run `npm start` here. The popup and workspace reconnect automatically. Check `http://127.0.0.1:3002/api/health`.
- **Tools need setup:** run `npm run setup`, then restart the companion.
- **Port already in use:** stop the other process on port 3002. The packaged extension expects this port. Port changes require updating `src/config.ts`, manifest CSP, and the companion together.
- **YouTube blocks a download:** retry or choose another public finished video. Private, paid, age/region-restricted, removed, upcoming, and currently live videos can fail. Run `npm run setup` again to update yt-dlp.
- **Optional sign-in:** copy `.env.example` to `.env` and set `YTDLP_COOKIES_FILE` to your own Netscape-format cookie file outside the repository. Cookies are credentials; never commit them. This does not guarantee video availability.
- **Restart interrupted an export:** the job becomes failed, and you can load the link and export again. Closing Chrome alone does not stop the companion.
- **Changed extension code:** run `npm run build`, then click the extension’s reload button in `chrome://extensions` and reopen its pages.

Optional `.env` overrides include `DATA_DIR`, `YTDLP_PATH`, `FFMPEG_PATH`, and `FFPROBE_PATH`; see `.env.example`. When using a custom FFmpeg path, keep an executable named `ffmpeg` alongside it so yt-dlp can locate it. `.env`, `.tools`, `.data`, and generated builds are ignored by Git.

## Development and verification

```sh
npm run dev          # Companion + web preview at http://127.0.0.1:5174
npm test             # URL/clip/access validation, real FFmpeg pipeline, cancellation, HTTP files/Range, persistence
npm run build        # TypeScript + packaged MV3 manifest and assets
npx playwright install chromium
npm run test:e2e     # Loads the real extension in an isolated Chromium profile
```

Stop `npm run dev` / `npm start` before the end-to-end suite, which uses port 3002 for its fixture companion. Browser tests replace only YouTube network access with a generated local video; actual conversion, verification, CORS, extension storage, worker messaging, preview playback, file downloads, and job deletion use production code. They also check offline guidance/reconnection and that exports survive closing the workspace. Browser tests never use your regular Chrome profile. GitHub Actions runs both suites and uploads the packaged extension.

For a manual live check, use your own public YouTube video, confirm current-tab capture from the toolbar, export a short range, and upload the saved MP4 to an eligible X account. No automated test publishes to X. `dist` is the loadable unpacked extension; it does not contain the Node companion. Distribution to another computer needs the companion setup there too.

Only download and repost content you own or have permission to use.
