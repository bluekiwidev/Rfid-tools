const socket = io();

const $ = (id) => document.getElementById(id);
const log = (t) => { $('log').value += t + '\n'; $('log').scrollTop = $('log').scrollHeight; };

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

$('clear_log').addEventListener('click', () => { $('log').value = ''; });

socket.on('serial_status', (s) => {
  log('STATUS: ' + JSON.stringify(s));
  if (s && s.ok) {
    // show connected
    const port = $('ports').value || '';
    setStatus('connected', port);
  } else if (s && s.error) {
    setStatus('error', s.error);
  } else {
    setStatus('disconnected', '');
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
    log('STATUS: ' + JSON.stringify(d));
    return;
  }
  log('JSON: ' + JSON.stringify(d));
});
socket.on('serial_raw', (r) => { log('RAW: ' + r); });

$('read_uid').addEventListener('click', () => {
  socket.emit('serial_cmd', { cmd: 'read_uid' });
});

$('dump').addEventListener('click', () => {
  socket.emit('serial_cmd', { cmd: 'read_uid' });
  // after UID read, user can press dump with the UID from output; simple UI for demo
  const uid = prompt('Enter UID (0x...) from read_uid output (or leave blank to auto)');
  socket.emit('serial_cmd', { cmd: 'dump', uid: uid || null });
});

$('read_block').addEventListener('click', () => {
  const addr = $('addr').value || '8';
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  socket.emit('serial_cmd', { cmd: 'read_block', uid: uid || null, addr: parseInt(addr,10) });
});

$('write_block').addEventListener('click', () => {
  const addr = $('addr').value || '8';
  const raw = $('write_data').value || '';
  const arr = raw.split(',').map(s => parseInt(s.trim(),10)||0);
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  socket.emit('serial_cmd', { cmd: 'write_block', uid: uid || null, addr: parseInt(addr,10), data: arr });
});

$('format_ndef').addEventListener('click', () => {
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  socket.emit('serial_cmd', { cmd: 'format_ndef', uid: uid || null });
});

$('write_ndef').addEventListener('click', () => {
  const text = $('ndef_text').value || 'Hello';
  const uid = prompt('Enter UID (0x...) or leave blank to auto');
  socket.emit('serial_cmd', { cmd: 'write_ndef', uid: uid || null, text });
});

// auto-list ports on load
socket.emit('list_ports');

socket.on('connect', () => setStatus('connected', 'socket'));
socket.on('disconnect', () => setStatus('disconnected', 'socket'));
