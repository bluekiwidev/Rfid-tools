# RFID Control Panel

This repository contains two complementary parts:

- CircuitPython firmware (`code.py`) for a Raspberry Pi Pico + MFRC522. It exposes a JSON-lines serial protocol over USB CDC.
- A web control panel (`public/`) and an optional Node.js Socket.IO proxy (`server.js`) to bridge the browser to a local serial port.

Quick features
- JSON-line command protocol (examples below).
- Browser UI supports two transports: `Server Proxy` (Socket.IO) and `Web Serial` (direct browser serial).
- Web Serial is the recommended default for browser-hosted deployments (GitHub Pages / Cloudflare Pages over HTTPS).
- UI includes a sidebar with settings, a serial-output full-page view, and Safe defaults (Web Serial selected).

Firmware JSON commands (examples)
- `{"cmd":"read_uid"}`
# RFID Control Panel

This repository contains two complementary parts:

- CircuitPython firmware (`code.py`) for a Raspberry Pi Pico + MFRC522. It exposes a JSON-lines serial protocol over USB CDC.
- A web control panel (`public/`) and an optional Node.js Socket.IO proxy (`server.js`) to bridge the browser to a local serial port.

Quick features
- JSON-line command protocol (examples below).
- Browser UI supports two transports: `Server Proxy` (Socket.IO) and `Web Serial` (direct browser serial).
- Web Serial is the recommended default for browser-hosted deployments (GitHub Pages / Cloudflare Pages over HTTPS).
- UI includes a sidebar with settings, a serial-output full-page view, and safe defaults (Web Serial selected).

Firmware JSON commands (examples)
- `{"cmd":"read_uid"}`
- `{"cmd":"dump", "uid":null}`
- `{"cmd":"read_block", "uid":null, "addr":8}`
- `{"cmd":"write_block", "uid":null, "addr":8, "data":[...]} `
- `{"cmd":"format_ndef", "uid":null, "start":4}`
- `{"cmd":"write_ndef", "uid":null, "text":"Hello"}`

Local development
1. Install dependencies (server only):

```bash
npm install
```

2. Start the Socket.IO proxy (optional — required only for `Server Proxy` mode):

```bash
npm start
```

3. Open the UI
- Server mode: open `http://localhost:3000/` when the server is running.
- Web Serial mode: open the deployed `public/index.html` over HTTPS (GitHub Pages or Cloudflare Pages). Web Serial requires a secure context and a Chromium-based browser.

UI notes
- The UI defaults to `Web Serial` and includes a sidebar (☰) with connection, mode, protocol, key and verbose toggles.
- The sidebar controls are synced with the main UI; changing one updates the other.
- When `Web Serial` is selected the port list and "List Serial Ports" button are hidden — the browser manages available serial devices.
- The Reset Pico button now fully resets UI state (clears logs, pending requests, closes Web Serial, resets indicators) and also requests a Pico reset via the server when available.

Key formats
- Provide MIFARE keys as comma-separated hex `FF,FF,FF,FF,FF,FF` or the literal `default`.

Deployment
- Static hosting (recommended for Web Serial): publish the `public/` folder (GitHub Pages or Cloudflare Pages).
- This project includes a `deploy` npm script (see `package.json`) that uses a `gh-pages` workflow if you prefer `npm run deploy`.
- Cloudflare Pages (example): set Build output directory to `public`. Local deploy with Wrangler:

```bash
npx wrangler login
npx wrangler pages deploy ./public --project-name=rfid-tools-site --branch main
```

- Workers Sites (Worker + assets) alternative: ensure `wrangler.toml` contains a `[site]` bucket and run:

```bash
npx wrangler deploy --site ./public
```

Troubleshooting
- `io is not defined`: the UI loads the Socket.IO client from a CDN when a local server is not available — this prevents the client from crashing on static hosts.
- Web Serial permission not showing: use Chrome/Edge, open the page top-level (not inside an iframe), and click the Connect button (direct user gesture) to trigger the browser prompt.
- If you use Wrangler and see authentication errors, run `npx wrangler login` or create an API token with Pages/Workers permissions and set `CLOUDFLARE_API_TOKEN` for CI.

Files of interest
- `code.py` — CircuitPython firmware
- `server.js` — Node.js server + Socket.IO proxy
- `public/index.html` & `public/client.js` — web UI (sidebar + Web Serial)
- `utils/` — low-level MFRC522 helpers and NDEF utilities

If you want screenshots, CI/CD samples, or a shorter Quick Start section I can add them — tell me what to include.
