# PostReady for Chrome

A Manifest V3 Chrome extension that turns a YouTube video or selected clip into a verified MP4 for uploading to X. Adapted from the PostReady website; this repository includes its own local processing companion and does not need the original project folder.

## Development

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run setup
npm run build
npm start
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository’s **dist** directory. Keep `npm start` running while processing or downloading videos. The companion binds to `127.0.0.1:3002`; the original website can keep using port 3001.

Chrome cannot execute yt-dlp or FFmpeg itself. The companion downloads, transcodes, and verifies files on your computer. It only accepts local clients and explicitly approved origins, including this extension’s stable ID. The manifest contains a public key, not a signing secret.

Use `npm run dev` for a web preview at `http://127.0.0.1:5174`. Rebuild and reload in Chrome to test packaged extension changes. `npm test` exercises real FFmpeg processing, cancellation, validation, and HTTP downloads; `npm run build` checks TypeScript and the packaged manifest.

Only download and repost content you own or have permission to use. No browser cookies are read automatically. Exports stay in `.data` and expire after 24 hours.
