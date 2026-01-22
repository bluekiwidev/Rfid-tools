RFID Control Panel

This workspace contains two parts:

- CircuitPython firmware (`code.py`, in root) to run on a Raspberry Pi Pico running CircuitPython and an MFRC522 connected via SPI.
- A Node.js server (`server.js`) which serves a web UI and proxies JSON commands to the Pico over USB serial.

Firmware serial protocol (JSON lines):
- {"cmd":"read_uid"}
- {"cmd":"dump", "uid":"0x..."}
- {"cmd":"read_block", "uid":"0x...", "addr":8}
- {"cmd":"write_block", "uid":"0x...", "addr":8, "data":[...]}
- {"cmd":"format_ndef", "uid":"0x...", "start":4}
- {"cmd":"write_ndef", "uid":"0x...", "text":"Hello"}

Server setup:

1. From this project folder, install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open http://localhost:3000 and connect to the Pico serial port (e.g. `/dev/tty.usbmodem...`).

Notes & caveats:
- The firmware assumes default MIFARE Classic keys and will attempt to authenticate using those keys.
- NDEF formatting/writing implemented here is a simple TLV writer that writes an NDEF text record across 16-byte blocks; it is a best-effort helper and may not cover all tag types or complex use-cases.
- Use the web UI or send JSON commands over the serial CDC data port to control the tag.
