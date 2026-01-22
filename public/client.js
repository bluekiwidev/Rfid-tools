const socket = io();

const $ = (id) => document.getElementById(id);
const log = (t) => { $('log').value += t + '\n'; $('log').scrollTop = $('log').scrollHeight; };

function pretty(obj) {
  try { return JSON.stringify(obj, null, 2); } catch (e) { return String(obj); }
}

function isVerbose() { return !!$('verbose') && $('verbose').checked; }

function getProtocol() { const p = $('protocol'); return p ? p.value : 'auto'; }

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

$('list').addEventListener('click', () => socket.emit('list_ports'));

socket.on('ports', (ports) => {
  const sel = $('ports'); sel.innerHTML = '';
  ports.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.path || p.comName || p.vendorId || p; opt.text = p.path || p.comName || JSON.stringify(p);
    sel.appendChild(opt);
  });
});

$('connect').addEventListener('click', () => {
  const p = $('ports').value;
  if (!p) { alert('select port'); return }
  setStatus('connecting', p);
  socket.emit('connect_serial', { path: p });
});

$('disconnect').addEventListener('click', () => socket.emit('disconnect_serial'));

// Reset Pico (UI clear + request server to toggle DTR)
$('reset_pico').addEventListener('click', () => {
  // clear UI state
  $('log').value = '';
  $('simple_uid').textContent = '-';
  $('simple_block0').textContent = '-';
  $('simple_read_result').textContent = '-';
  $('dump_table_wrap').innerHTML = '';
  modeSelect.value = 'simple'; updateMode();
  setReaderState('idle');
  // ask server to reset the attached Pico
  socket.emit('reset_pico');
});

$('clear_log').addEventListener('click', () => { $('log').value = ''; });

// Mode handling
const modeSelect = $('mode');
function updateMode() {
  const m = modeSelect.value;
  const simple = $('simple_ui');
  const adv = $('advanced_ui');
  if (simple) simple.style.display = m === 'simple' ? 'block' : 'none';
  if (adv) adv.style.display = m === 'advanced' ? 'block' : 'none';
}
modeSelect.addEventListener('change', updateMode);
updateMode();

// Simple mode controls
$('simple_read').addEventListener('click', () => {
  // trigger dump and let the firmware auto-wait for tag
  socket.emit('serial_cmd', { cmd: 'dump', uid: null, protocol: getProtocol() });
});

$('simple_write').addEventListener('click', () => {
  const blk = parseInt($('simple_block').value || '8', 10);
  const text = $('simple_text').value || '';
  // encode text to utf-8 bytes
  const encoder = new TextEncoder();
  const bytes = Array.from(encoder.encode(text)).slice(0,16);
  socket.emit('serial_cmd', { cmd: 'write_block', uid: null, addr: blk, data: bytes, protocol: getProtocol() });
});

// Simple read-block button
$('simple_read_block').addEventListener('click', () => {
  const blk = parseInt($('simple_block').value || '8', 10);
  // ask firmware to wait for tag and read block
  socket.emit('serial_cmd', { cmd: 'read_block', uid: null, addr: blk, protocol: getProtocol() });
  $('simple_read_result').textContent = 'waiting...';
});

socket.on('serial_status', (s) => {
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

socket.on('serial_data', (d) => {
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
      $('simple_read_result').textContent = data.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join(' ');
    } else {
      $('simple_read_result').textContent = JSON.stringify(data);
    }
  }
});
socket.on('serial_raw', (r) => { log('RAW: ' + r); });
// interpret plain text 'ready' from firmware
socket.on('serial_raw', (r) => {
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
  socket.emit('serial_cmd', { cmd: 'read_uid', protocol: getProtocol() });
});

$('dump').addEventListener('click', () => {
  socket.emit('serial_cmd', { cmd: 'read_uid', protocol: getProtocol() });
  // after UID read, user can press dump with the UID from output; simple UI for demo
  const uid = prompt('Enter UID (0x...) from read_uid output (or leave blank to auto)');
  socket.emit('serial_cmd', { cmd: 'dump', uid: uid || null, protocol: getProtocol() });
});

$('read_block').addEventListener('click', () => {
  const addr = $('addr').value || '8';
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  socket.emit('serial_cmd', { cmd: 'read_block', uid: uid || null, addr: parseInt(addr,10), protocol: getProtocol() });
});

$('write_block').addEventListener('click', () => {
  const addr = $('addr').value || '8';
  const raw = $('write_data').value || '';
  const arr = raw.split(',').map(s => parseInt(s.trim(),10)||0);
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  socket.emit('serial_cmd', { cmd: 'write_block', uid: uid || null, addr: parseInt(addr,10), data: arr, protocol: getProtocol() });
});

$('format_ndef').addEventListener('click', () => {
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  socket.emit('serial_cmd', { cmd: 'format_ndef', uid: uid || null, protocol: getProtocol() });
});

$('write_ndef').addEventListener('click', () => {
  const text = $('ndef_text').value || 'Hello';
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  socket.emit('serial_cmd', { cmd: 'write_ndef', uid: uid || null, text, protocol: getProtocol() });
});

// auto-list ports on load
socket.emit('list_ports');

socket.on('connect', () => setStatus('connected', 'socket'));
socket.on('disconnect', () => setStatus('disconnected', 'socket'));

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
