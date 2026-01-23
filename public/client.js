let socket = null;
if (typeof io !== 'undefined') {
  try { socket = io({ autoConnect: false }); } catch (e) { socket = null; }
}
const pending = {};

// Web Serial state
let webserialPort = null;
let webserialWriter = null;
let webserialReader = null;
let webserialReadLoop = null;

function webserialSendLine(line) {
  if (!webserialWriter) throw new Error('not connected');
  const enc = new TextEncoder();
  return webserialWriter.write(enc.encode(line + '\n'));
}

async function webserialStartReader() {
  if (!webserialPort) return;
  try {
    const reader = webserialPort.readable.getReader();
    webserialReader = reader;
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // port closed from device/host side
        handleTransportError('webserial port closed');
        break;
      }
      if (!value) continue;
      buf += new TextDecoder().decode(value);
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          handleSerialData(obj);
        } catch (e) {
          // fallback: raw text
          handleSerialRaw(line);
        }
      }
    }
  } catch (e) {
    console.warn('webserial read loop ended', e);
    handleTransportError('webserial read error: ' + (e && e.message ? e.message : String(e)));
  } finally {
    try { if (webserialReader) { webserialReader.releaseLock(); webserialReader = null; } } catch (e) {}
  }
}

async function webserialConnect() {
  if (!('serial' in navigator)) throw new Error('Web Serial not supported');
  webserialPort = await navigator.serial.requestPort();
  await webserialPort.open({ baudRate: 115200 });
  if (webserialPort.writable) {
    webserialWriter = webserialPort.writable.getWriter();
  }
  webserialStartReader();
}

async function webserialDisconnect() {
  try { if (webserialReader) { await webserialReader.cancel(); webserialReader.releaseLock(); webserialReader = null; } } catch (e) {}
  try { if (webserialWriter) { await webserialWriter.releaseLock(); webserialWriter = null; } } catch (e) {}
  try { if (webserialPort) { await webserialPort.close(); webserialPort = null; } } catch (e) {}
}

function sendCmdAwait(cmd, timeout=12000) {
  return new Promise((resolve, reject) => {
    const txn = 't' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
    cmd.txn = txn;
    const to = setTimeout(() => {
      if (pending[txn]) {
        delete pending[txn];
        setReaderState('timeout');
        setStatus('error', 'command timeout');
        reject(new Error('timeout'));
      }
    }, timeout);
    pending[txn] = { resolve, reject, to };
    // send via selected transport
    const mode = getConnMode();
    if (mode === 'webserial' && webserialPort && webserialWriter) {
      try {
        webserialSendLine(JSON.stringify(cmd)).catch(err => {
          // if send fails, reject immediately
          clearTimeout(to); delete pending[txn]; reject(err);
        });
      } catch (e) { clearTimeout(to); delete pending[txn]; reject(e); }
    } else {
      if (socket) socket.emit('serial_cmd', cmd);
      else { clearTimeout(to); delete pending[txn]; reject(new Error('no_server_connection')); }
    }
  });
}

function handleTransportError(msg) {
  try {
    console.warn('transport error:', msg);
    setStatus('error', msg || 'transport error');
    setReaderState('timeout');
    // reject pending txns
    for (const t of Object.keys(pending)) {
      try { clearTimeout(pending[t].to); pending[t].reject(new Error('transport_error: ' + msg)); } catch (e) {}
      try { delete pending[t]; } catch (e) {}
    }
    // close webserial resources if applicable
    try { if (webserialReader) { webserialReader.cancel(); webserialReader.releaseLock(); webserialReader = null; } } catch (e) {}
    try { if (webserialWriter) { webserialWriter.releaseLock(); webserialWriter = null; } } catch (e) {}
    try { if (webserialPort) { webserialPort.close(); webserialPort = null; } } catch (e) {}
  } catch (e) { console.warn('handleTransportError failed', e); }
}

const $ = (id) => document.getElementById(id);
const log = (t) => { $('log').value += t + '\n'; $('log').scrollTop = $('log').scrollHeight; };

function pretty(obj) {
  try { return JSON.stringify(obj, null, 2); } catch (e) { return String(obj); }
}

function isVerbose() { const v = $('verbose') || $('sb_verbose'); return !!v && v.checked; }

function getProtocol() { const p = $('protocol') || $('sb_protocol'); return p ? p.value : 'auto'; }
function getKey() { const k = $('key') || $('sb_key'); return k ? (k.value ? k.value.trim() : null) : null; }

function getConnMode() { const c = $('conn_mode') || $('sb_conn_mode'); return c ? c.value : 'server'; }

function setStatus(state, detail) {
  const dot = $('status-dot');
  const txt = $('status-text');
  const det = $('status-detail');
  det.textContent = detail || '';
  if (state === 'connected') {
    dot.style.background = '#0a0';
    txt.textContent = 'Connected';
  } else if (state === 'connecting') {
    dot.style.background = '#fa0';
    txt.textContent = 'Connecting...';
  } else if (state === 'error') {
    dot.style.background = '#c60';
    txt.textContent = 'Error';
  } else {
    dot.style.background = '#c00';
    txt.textContent = 'Disconnected';
  }
}

function setReaderState(state) {
  const el = $('reader-status');
  if (!el) return;
  const s = (state || '').toLowerCase();
  let text = 'idle';
  let bg = '#ECE1E9';
  let color = '#2E6467';
  if (s === 'ready') { text = 'ready'; bg = '#dff0d8'; color = '#267326'; }
  else if (s === 'waiting' || s === 'place_tag' || s === 'waiting_for_tag') { text = 'waiting for card'; bg = '#fff3cd'; color = '#856404'; }
  else if (s === 'reading' || s === 'read') { text = 'reading'; bg = '#d1ecf1'; color = '#0c5460'; }
  else if (s.indexOf('write') !== -1 || s === 'writing_block' || s === 'writing_ndef' || s === 'writing') { text = 'writing'; bg = '#f8d7da'; color = '#721c24'; }
  else if (s === 'busy' || s === 'formatting_ndef') { text = 'busy'; bg = '#e2e3e5'; color = '#6c757d'; }
  else if (s === 'timeout') { text = 'timeout'; bg = '#f8d7da'; color = '#721c24'; }
  else if (s === 'dump_complete' || s === 'read_complete' || s === 'write_block_complete' || s === 'write_ndef_complete') { text = 'ready'; bg = '#dff0d8'; color = '#267326'; }
  else { text = state || 'idle'; }
  el.textContent = text;
  el.style.background = bg;
  el.style.color = color;
}

$('list').addEventListener('click', () => {
  if (!socket) { alert('No server connection: switch to Server Proxy or use Web Serial'); return; }
  if (!socket.connected) {
    socket.connect();
    socket.once('connect', () => { socket.emit('list_ports'); });
  } else {
    socket.emit('list_ports');
  }
});

function sendCmd(cmd) {
  const mode = getConnMode();
  if (mode === 'webserial' && webserialPort && webserialWriter) {
    try { webserialSendLine(JSON.stringify(cmd)); } catch (e) { log('WebSerial send error: ' + e); }
  } else {
    if (socket) socket.emit('serial_cmd', cmd);
    else alert('No server connection: switch to Server Proxy or use Web Serial');
  }
}

if (socket) socket.on('ports', (ports) => {
  const sel = $('ports'); sel.innerHTML = '';
  ports.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.path || p.comName || p.vendorId || p; opt.text = p.path || p.comName || JSON.stringify(p);
    sel.appendChild(opt);
  });
});

$('connect').addEventListener('click', async () => {
  const mode = getConnMode();
  console.log('connect clicked, mode=', mode);
  if (mode === 'webserial') {
    try {
      setStatus('connecting', 'webserial');
      await webserialConnect();
      setStatus('connected', 'webserial');
      setReaderState('ready');
    } catch (e) {
      console.error(e);
      setStatus('error', String(e));
      alert('Web Serial connect failed: ' + e);
    }
    return;
  }
  const p = $('ports').value;
  if (!p) { alert('select port'); return }
  setStatus('connecting', p);
  if (!socket) { alert('No server connection'); return; }
  if (!socket.connected) {
    socket.connect();
    socket.once('connect', () => { socket.emit('connect_serial', { path: p }); });
  } else {
    socket.emit('connect_serial', { path: p });
  }
});

$('disconnect').addEventListener('click', async () => {
  const mode = getConnMode();
  if (mode === 'webserial') {
    await webserialDisconnect();
    setStatus('disconnected', 'webserial');
    setReaderState('idle');
    return;
  }
  if (!socket) { alert('No server connection'); return; }
  if (!socket.connected) { socket.connect(); socket.once('connect', () => { socket.emit('disconnect_serial'); }); }
  else socket.emit('disconnect_serial');
});

// Reset Pico (UI clear + request server to toggle DTR)
$('reset_pico').addEventListener('click', async () => {
  // clear UI state
  $('log').value = '';
  $('simple_uid').textContent = '-';
  $('simple_block0').textContent = '-';
  $('simple_read_result').textContent = '-';
  $('dump_table_wrap').innerHTML = '';
  // reset mode and reader indicators
  modeSelect.value = 'simple'; updateMode();
  setReaderState('idle');
  setStatus('disconnected', 'reset');
  // clear ports list
  try { const p = $('ports'); if (p) p.innerHTML = ''; } catch (e) {}
  // cancel and reject any pending txn promises
  try {
    for (const t of Object.keys(pending)) {
      try { clearTimeout(pending[t].to); pending[t].reject(new Error('reset')); } catch (e) {}
      try { delete pending[t]; } catch (e) {}
    }
  } catch (e) {}

  // close Web Serial if open
  try {
    if (webserialPort) await webserialDisconnect();
  } catch (e) {}

  // ask server to reset the attached Pico (if server connected)
  if (socket) socket.emit('reset_pico');
});

$('clear_log').addEventListener('click', () => { $('log').value = ''; });

// Mode handling (use sidebar controls as fallback)
const modeSelect = $('mode') || $('sb_mode');
function updateMode() {
  const m = (modeSelect && modeSelect.value) ? modeSelect.value : 'simple';
  const simple = $('simple_ui');
  const adv = $('advanced_ui');
  if (simple) simple.style.display = m === 'simple' ? 'block' : 'none';
  if (adv) adv.style.display = m === 'advanced' ? 'block' : 'none';
}
if (modeSelect) modeSelect.addEventListener('change', updateMode);
updateMode();

// Default connection mode to Web Serial for browser-hosted UI (prefers top control if present, otherwise sidebar)
const connModeSelect = $('conn_mode') || $('sb_conn_mode');
if (connModeSelect) connModeSelect.value = 'webserial';

// Sidebar toggle handlers
const sidebar = $('sidebar');
const sidebarToggle = $('sidebar_toggle');
const headerSidebarToggle = $('header_sidebar_toggle');
const sidebarClose = $('sidebar_close');
if (sidebarToggle) sidebarToggle.addEventListener('click', () => {
  if (!sidebar) return;
  sidebar.style.transform = 'translateX(0)';
  sidebar.setAttribute('aria-hidden', 'false');
  try { headerSidebarToggle.setAttribute('aria-expanded', 'true'); } catch (e) {}
});
if (sidebarClose) sidebarClose.addEventListener('click', () => { if (!sidebar) return; sidebar.style.transform = 'translateX(100%)'; sidebar.setAttribute('aria-hidden','true'); try { headerSidebarToggle.setAttribute('aria-expanded', 'false'); } catch (e) {} });
if (headerSidebarToggle) headerSidebarToggle.addEventListener('click', () => {
  try {
    if (!sidebar) return;
    const isOpen = sidebar.getAttribute('aria-hidden') === 'false';
    console.log('header toggle clicked, sidebar aria-hidden=', sidebar.getAttribute('aria-hidden'), 'isOpen=', isOpen);
    if (isOpen) {
      sidebar.style.transform = 'translateX(100%)';
      sidebar.setAttribute('aria-hidden','true');
      try { headerSidebarToggle.setAttribute('aria-expanded', 'false'); } catch (e) {}
    } else {
      sidebar.style.transform = 'translateX(0)';
      sidebar.setAttribute('aria-hidden','false');
      try { headerSidebarToggle.setAttribute('aria-expanded', 'true'); } catch (e) {}
    }
  } catch (e) { console.warn('sidebar toggle failed', e); }
});

// Close sidebar with Escape key
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && sidebar && sidebar.getAttribute('aria-hidden') === 'false') {
    sidebar.style.transform = 'translateX(100%)';
    sidebar.setAttribute('aria-hidden','true');
    try { headerSidebarToggle.setAttribute('aria-expanded', 'false'); } catch (e) {}
  }
});

// Sync sidebar controls with main controls
function updateConnectionUI() {
  const mode = getConnMode();
  const listBtn = $('list');
  const portsSel = $('ports');
  if (mode === 'webserial') {
    if (listBtn) listBtn.style.display = 'none';
    if (portsSel) portsSel.style.display = 'none';
  } else {
    if (listBtn) listBtn.style.display = '';
    if (portsSel) portsSel.style.display = '';
  }
}

// Keep sidebar controls in sync
const sb_conn = $('sb_conn_mode');
const sb_mode_el = $('sb_mode');
const sb_protocol = $('sb_protocol');
const sb_key = $('sb_key');
const sb_verbose = $('sb_verbose');
if (sb_conn) {
  // initialize
  sb_conn.value = (connModeSelect && connModeSelect.value) || 'webserial';
  sb_conn.addEventListener('change', (e) => { if (connModeSelect) connModeSelect.value = e.target.value; updateConnectionUI(); });
  if (connModeSelect) connModeSelect.addEventListener('change', () => { sb_conn.value = connModeSelect.value; updateConnectionUI(); });
}
if (sb_mode_el && modeSelect) { sb_mode_el.value = modeSelect.value; sb_mode_el.addEventListener('change', (e)=>{ modeSelect.value = e.target.value; updateMode(); }); modeSelect.addEventListener('change', ()=>{ sb_mode_el.value = modeSelect.value; }); }
if (sb_protocol) { sb_protocol.value = getProtocol(); sb_protocol.addEventListener('change', (e)=>{ const p = $('protocol'); if (p) p.value = e.target.value; }); }
if (sb_key) { sb_key.value = getKey() || ''; sb_key.addEventListener('input',(e)=>{ const p = $('key'); if (p) p.value = e.target.value; }); }
if (sb_verbose) { sb_verbose.checked = isVerbose(); sb_verbose.addEventListener('change',(e)=>{ const p = $('verbose'); if (p) p.checked = e.target.checked; }); }

updateConnectionUI();

// Serial output full-page handlers
const openSerialPage = $('open_serial_page');
const serialPage = $('serial_page');
const serialBack = $('serial_back');
const serialClear = $('serial_clear');
const serialOnlyLog = $('serial_only_log');
if (openSerialPage) openSerialPage.addEventListener('click', () => { if (serialPage) serialPage.style.display = 'block'; serialOnlyLog.value = $('log').value; if (sidebar) { sidebar.style.transform = 'translateX(100%)'; sidebar.setAttribute('aria-hidden','true'); } });
if (serialBack) serialBack.addEventListener('click', () => { if (serialPage) serialPage.style.display = 'none'; });
if (serialClear) serialClear.addEventListener('click', () => { if (serialOnlyLog) serialOnlyLog.value = ''; if ($('log')) $('log').value = ''; });

// mirror runtime logs into serial-only view
const origLog = log;
function logAndMirror(t) { origLog(t); if (serialOnlyLog) { serialOnlyLog.value += t + '\n'; serialOnlyLog.scrollTop = serialOnlyLog.scrollHeight; } }
// replace log with mirror
window.log = logAndMirror;

// Simple mode controls
$('simple_read').addEventListener('click', () => {
  // trigger dump and let the firmware auto-wait for tag
  sendCmd({ cmd: 'dump', uid: null, protocol: getProtocol(), key: getKey() });
});

$('simple_write').addEventListener('click', async () => {
  const start = parseInt($('simple_block').value || '8', 10);
  const text = $('simple_text').value || '';
  const encoder = new TextEncoder();
  const bytes = Array.from(encoder.encode(text));
  if (bytes.length === 0) return alert('Nothing to write');

  // determine number of blocks
  const needed = Math.ceil(bytes.length / 16);

  try {
    // read and verify target blocks are empty (or collect originals for rollback)
    const originals = [];
    for (let i=0;i<needed;i++) {
      const addr = start + i;
      const r = await sendCmdAwait({ cmd: 'read_block', uid: null, addr, protocol: getProtocol(), key: getKey() });
      if (!r || !r.cmd) throw new Error('no response');
      if (!r.ok) {
        // treat missing data as non-empty and abort
        throw new Error('read failed for block ' + addr + ' (' + (r.error||r.message||'') + ')');
      }
      const data = Array.isArray(r.data) ? r.data : [];
      originals.push(data.slice());
      // consider empty if all bytes are 0
      const empty = data.length === 0 || data.every(b => (b & 0xFF) === 0);
      if (!empty) throw new Error('target block ' + addr + ' is not empty');
    }

    // all clear: write sequentially
    for (let i=0;i<needed;i++) {
      const addr = start + i;
      const chunk = bytes.slice(i*16, (i+1)*16);
      const block = new Array(16).fill(0);
      for (let j=0;j<chunk.length && j<16;j++) block[j] = chunk[j] & 0xFF;
      const w = await sendCmdAwait({ cmd: 'write_block', uid: null, addr, data: block, protocol: getProtocol(), key: getKey() });
      if (!w || !w.cmd) throw new Error('no response writing block ' + addr);
      if (!w.ok) {
        // rollback previous writes
        for (let k=0;k<i;k++) {
          const addr2 = start + k;
          const orig = originals[k] || new Array(16).fill(0);
          try { await sendCmdAwait({ cmd: 'write_block', uid: null, addr: addr2, data: orig, protocol: getProtocol(), key: getKey() }); } catch (e) {}
        }
        throw new Error('write failed for block ' + addr + ' (' + (w.error||w.message||'') + ')');
      }
    }
    alert('Write complete');
  } catch (err) {
    alert('Write aborted: ' + (err && err.message ? err.message : String(err)));
  }
});

// Simple read-block button
$('simple_read_block').addEventListener('click', () => {
  const blk = parseInt($('simple_block').value || '8', 10);
  // ask firmware to wait for tag and read block
  sendCmd({ cmd: 'read_block', uid: null, addr: blk, protocol: getProtocol(), key: getKey() });
  $('simple_read_result').textContent = 'waiting...';
});

// Erase block: write 16 zero bytes
$('simple_erase').addEventListener('click', () => {
  const blk = parseInt($('simple_block').value || '8', 10);
  if (!confirm('Erase block ' + blk + '? This will write 16 zero bytes.')) return;
  const zeros = new Array(16).fill(0);
  sendCmd({ cmd: 'write_block', uid: null, addr: blk, data: zeros, protocol: getProtocol(), key: getKey() });
});

if (socket) socket.on('serial_status', (s) => {
  // show status in status area; log only when verbose
  if (isVerbose()) log('STATUS: ' + pretty(s));
  if (s && s.ok) {
    // show connected
    const port = $('ports').value || '';
    setStatus('connected', port);
    setReaderState('ready');
  } else if (s && s.error) {
    setStatus('error', s.error);
    setReaderState('idle');
  } else {
    setStatus('disconnected', '');
    setReaderState('idle');
  }
});
function handleSerialRaw(r) {
  try {
    log('RAW: ' + r);
  } catch (e) {}
  try {
    const t = String(r || '').trim();
    // common firmware messages for missing/removed tag
    const tl = t.toLowerCase();
    if (tl.indexOf('no tag') !== -1 || tl.indexOf('card removed') !== -1 || tl.indexOf('tag removed') !== -1) {
      setStatus('error', 'No tag present');
      setReaderState('timeout');
      return;
    }
    if (t.toLowerCase() === 'ready') {
      setReaderState('ready');
      if (isVerbose()) log('FW: ready');
      return;
    }
  } catch (e) {}
}

function handleSerialData(d) {
  // resolve pending promises for non-status responses
  try {
    if (d && d.txn && pending[d.txn] && d.cmd !== 'status') {
      clearTimeout(pending[d.txn].to);
      pending[d.txn].resolve(d);
      delete pending[d.txn];
    }
  } catch (e) {}
  // If device is sending status updates, show them in status detail
  if (d && d.cmd === 'status') {
    const s = d.status || d.message || JSON.stringify(d);
    // map some known statuses to friendly text
    let friendly = s;
    if (s === 'place_tag') friendly = 'Place tag on reader';
    else if (s === 'reading') friendly = 'Reading...';
    else if (s === 'read_complete') friendly = 'Read complete';
    else if (s === 'dump_complete') friendly = 'Dump complete';
    else if (s === 'writing_block') friendly = 'Writing block...';
    else if (s === 'write_block_complete') friendly = 'Write block complete';
    else if (s === 'formatting_ndef') friendly = 'Formatting NDEF...';
    else if (s === 'writing_ndef') friendly = 'Writing NDEF...';
    setStatus('connected', friendly);
    setReaderState(s);
    if (isVerbose()) log('STATUS: ' + pretty(d));
    return;
  }

  // for non-status messages pretty-print and show compact
  // keep minimal by default, full pretty when verbose
  if (isVerbose()) {
    log(pretty(d));
  } else {
    // show one-line summary for common commands
    try {
      const summaryCmd = d.cmd || 'msg';
      if (d.cmd === 'read_uid') log(`${summaryCmd}: ${d.uid}`);
      else if (d.cmd === 'dump') log(`${summaryCmd}: ${d.uid} (dump ${d.dump ? Object.keys(d.dump).length : 0} blocks)`);
      else if (d.cmd === 'read_block') log(`${summaryCmd}: addr=${d.addr} ${d.ok ? 'ok' : 'err'}`);
      else if (d.cmd === 'write_block') log(`${summaryCmd}: addr=${d.addr} ${d.ok ? 'ok' : 'err'}`);
      else log(`${summaryCmd}: ${JSON.stringify(d)}`);
    } catch (e) {
      log(JSON.stringify(d));
    }
  }

  // Auto-fill UID on read_uid
  if (d && d.cmd === 'read_uid') {
    const uid = (d.uid !== undefined && d.uid !== null) ? d.uid : null;
    if (uid) {
      $('simple_uid').textContent = uid;
    }
  }

  // Render dump in simple UI
  if (d && d.cmd === 'dump') {
    renderDump(d.uid, d.dump);
  }
  // Handle read_block response for simple UI
  if (d && d.cmd === 'read_block') {
    const addr = d.addr;
    const ok = d.ok;
    if (!ok) {
      const err = d.error || d.message || 'unknown';
      $('simple_read_result').textContent = 'ERROR: ' + err;
      return;
    }
    const data = d.data;
    if (!data) {
      $('simple_read_result').textContent = '(no data)';
    } else if (Array.isArray(data)) {
      try {
        const bytes = new Uint8Array(data.map(x => x & 0xFF));
        const dec = new TextDecoder('utf-8');
        let txt = dec.decode(bytes);
        // strip trailing nulls and control chars
        txt = txt.replace(/\x00+$/,'');
        const printable = txt.split('').every(ch => {
          const c = ch.charCodeAt(0);
          return (c >= 9 && c <= 13) || (c >= 32 && c <= 126);
        });
        if (printable && txt.length > 0) {
          $('simple_read_result').textContent = txt + '  (' + data.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ') + ')';
        } else {
          $('simple_read_result').textContent = data.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
        }
      } catch (e) {
        $('simple_read_result').textContent = data.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
      }
    } else {
      $('simple_read_result').textContent = JSON.stringify(data);
    }
  }
}
if (socket) socket.on('serial_data', handleSerialData);
if (socket) socket.on('serial_raw', (r) => { log('RAW: ' + r); });
// interpret plain text 'ready' from firmware
if (socket) socket.on('serial_raw', (r) => {
  try {
    const t = String(r || '').trim();
    if (t.toLowerCase() === 'ready') {
      setReaderState('ready');
      if (isVerbose()) log('FW: ready');
      return;
    }
  } catch (e) {}
});

$('read_uid').addEventListener('click', () => {
  sendCmd({ cmd: 'read_uid', protocol: getProtocol(), key: getKey() });
});

$('dump').addEventListener('click', () => {
  sendCmd({ cmd: 'read_uid', protocol: getProtocol(), key: getKey() });
  // after UID read, user can press dump with the UID from output; simple UI for demo
  const uid = prompt('Enter UID (0x...) from read_uid output (or leave blank to auto)');
  sendCmd({ cmd: 'dump', uid: uid || null, protocol: getProtocol(), key: getKey() });
});

$('read_block').addEventListener('click', () => {
  const addr = $('addr').value || '8';
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  sendCmd({ cmd: 'read_block', uid: uid || null, addr: parseInt(addr,10), protocol: getProtocol(), key: getKey() });
});

$('write_block').addEventListener('click', () => {
  const addr = $('addr').value || '8';
  const raw = $('write_data').value || '';
  const arr = raw.split(',').map(s => parseInt(s.trim(),10)||0);
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  sendCmd({ cmd: 'write_block', uid: uid || null, addr: parseInt(addr,10), data: arr, protocol: getProtocol(), key: getKey() });
});

$('format_ndef').addEventListener('click', () => {
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  sendCmd({ cmd: 'format_ndef', uid: uid || null, protocol: getProtocol(), key: getKey() });
});

$('write_ndef').addEventListener('click', () => {
  const text = $('ndef_text').value || 'Hello';
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  sendCmd({ cmd: 'write_ndef', uid: uid || null, text, protocol: getProtocol(), key: getKey() });
});

// auto-list ports on load (server mode only)
if (getConnMode() !== 'webserial') {
  if (socket) {
    if (!socket.connected) { socket.connect(); socket.once('connect', ()=> socket.emit('list_ports')); }
    else socket.emit('list_ports');
  }
}

if (socket) socket.on('connect', () => setStatus('connected', 'socket'));
if (socket) socket.on('disconnect', () => setStatus('disconnected', 'socket'));

function renderDump(uid, dump) {
  const wrap = $('dump_table_wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!dump) {
    wrap.textContent = 'No dump data';
    return;
  }
  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  const keys = Object.keys(dump).sort((a,b)=>parseInt(a)-parseInt(b));
  // Populate simple block selector with available keys (0..63)
  const sel = $('simple_block');
  if (sel) {
    sel.innerHTML = '';
    for (let i=0;i<64;i++) {
      const opt = document.createElement('option'); opt.value = i; opt.text = i; sel.appendChild(opt);
    }
  }
  keys.forEach(k => {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.style.border = '1px solid #ddd'; td1.style.padding = '4px'; td1.style.width = '60px';
    td1.textContent = k;
    const td2 = document.createElement('td'); td2.style.border = '1px solid #ddd'; td2.style.padding = '4px';
    const val = dump[k];
    if (val && val.error) td2.textContent = 'ERR: ' + val.error;
    else if (Array.isArray(val)) td2.textContent = val.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
    else if (val === null) td2.textContent = '(no access)';
    else td2.textContent = JSON.stringify(val);
    tr.appendChild(td1); tr.appendChild(td2); table.appendChild(tr);
  });
  wrap.appendChild(table);
  if (dump[0] && Array.isArray(dump[0])) {
    $('simple_block0').textContent = dump[0].map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
  }
}
