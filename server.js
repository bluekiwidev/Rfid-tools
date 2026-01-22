const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('client connected');
  let port = null;
  let parser = null;

  socket.on('list_ports', async () => {
    try {
      const ports = await SerialPort.list();
      socket.emit('ports', ports);
    } catch (e) {
      socket.emit('ports', []);
    }
  });

  socket.on('connect_serial', ({ path, baud = 115200 }) => {
    if (port) {
      try { port.close(); } catch (e) {}
      port = null;
    }
    port = new SerialPort({ path, baudRate: parseInt(baud, 10), autoOpen: false });
    port.open((err) => {
      if (err) {
        socket.emit('serial_status', { ok: false, error: String(err) });
        return;
      }
      parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', (line) => {
        try {
          const j = JSON.parse(line);
          socket.emit('serial_data', j);
        } catch (e) {
          socket.emit('serial_raw', line);
        }
      });
      socket.emit('serial_status', { ok: true });
    });

    port.on('error', (err) => {
      socket.emit('serial_status', { ok: false, error: String(err) });
    });
  });

  socket.on('disconnect_serial', () => {
    if (port) {
      try { port.close(); } catch (e) {}
      port = null;
    }
    socket.emit('serial_status', { ok: false });
  });

  socket.on('serial_cmd', (cmd) => {
    if (!port || !port.isOpen) {
      socket.emit('serial_status', { ok: false, error: 'port_not_open' });
      return;
    }
    try {
      const s = JSON.stringify(cmd);
      port.write(s + '\n');
    } catch (e) {
      socket.emit('serial_status', { ok: false, error: String(e) });
    }
  });

  socket.on('reset_pico', () => {
    if (!port || !port.isOpen) {
      socket.emit('serial_status', { ok: false, error: 'port_not_open' });
      return;
    }
    // Toggle DTR low then high to reset CircuitPython on Pico
    try {
      port.set({ dtr: false }, (err) => {
        setTimeout(() => {
          port.set({ dtr: true }, (err2) => {
            // report success
            socket.emit('serial_status', { ok: true, reset: true });
          });
        }, 150);
      });
    } catch (e) {
      socket.emit('serial_status', { ok: false, error: String(e) });
    }
  });

  socket.on('disconnect', () => {
    if (port) {
      try { port.close(); } catch (e) {}
      port = null;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server listening on', PORT);
});
