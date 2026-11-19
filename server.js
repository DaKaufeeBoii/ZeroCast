const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');
const qrcode = require('qrcode-terminal');

const PORT = process.env.PORT || 8080;

// Find local IPv4 network addresses (Wi-Fi / Ethernet)
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // IPv4 and not internal loopback
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ name, address: net.address });
      }
    }
  }
  return addresses;
}

// Simple static file server
function serveStatic(req, res) {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(__dirname, 'public', safePath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(process.cwd(), 'public', safePath);
  }
  if (!fs.existsSync(filePath) && safePath.toLowerCase().includes('zerocast.apk')) {
    filePath = path.join(process.cwd(), 'ZeroCast.apk');
  }

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.apk': 'application/vnd.android.package-archive'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(data);
  });
}

// Start HTTP server
async function main() {
  const server = http.createServer(serveStatic);
  setupWebSocket(server);

  server.listen(PORT, '0.0.0.0', () => {
    printBanner();
  });
}

// Room state & signaling: roomId -> { clients: Set, broadcasterOffer: null, broadcasterCandidates: [] }
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Set(),
      broadcasterWs: null,
      broadcasterOffer: null,
      broadcasterCandidates: []
    });
  }
  return rooms.get(roomId);
}

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let currentRoomId = null;
    let clientRole = 'peer';
    let clientId = Math.random().toString(36).substring(2, 9);
    ws.clientId = clientId;

    ws.on('message', (data, isBinary) => {
      // Check if binary buffer (e.g. native H.264 mobile screen packet from Android APK)
      if (isBinary) {
        if (currentRoomId && rooms.has(currentRoomId)) {
          if (!ws.frameCount) ws.frameCount = 0;
          if (ws.frameCount++ % 120 === 0) {
            console.log(`[WS] Relaying phone screen frames (${ws.frameCount} frames sent, length: ${data.length}) to room: ${currentRoomId}`);
          }
          broadcastBinary(currentRoomId, ws, data);
        }
        return;
      }

      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        return;
      }

      const { type, room, payload } = msg;

      if (type === 'join') {
        currentRoomId = room || 'default-room';
        clientRole = msg.role || 'receiver';
        ws.clientRole = clientRole;

        const roomObj = getOrCreateRoom(currentRoomId);
        roomObj.clients.add(ws);

        if (clientRole === 'sender') {
          roomObj.broadcasterWs = ws;
          roomObj.broadcasterOffer = null;
          roomObj.broadcasterCandidates = [];
        }

        console.log(`[WS] ${clientId} (${clientRole}) joined room: ${currentRoomId}. Total peers: ${roomObj.clients.size}`);

        // Notify joining client
        ws.send(JSON.stringify({
          type: 'joined',
          clientId,
          room: currentRoomId,
          role: clientRole,
          peerCount: roomObj.clients.size,
          hasBroadcaster: !!roomObj.broadcasterWs && !!roomObj.broadcasterOffer
        }));

        // If joining as receiver and a broadcaster is already streaming with an offer:
        if (clientRole === 'receiver' && roomObj.broadcasterOffer) {
          console.log(`[WS] Sending cached broadcaster offer & ${roomObj.broadcasterCandidates.length} candidates to new receiver ${clientId}`);
          ws.send(JSON.stringify({
            type: 'offer',
            from: roomObj.broadcasterWs?.clientId,
            payload: roomObj.broadcasterOffer
          }));
          for (const cand of roomObj.broadcasterCandidates) {
            ws.send(JSON.stringify({
              type: 'candidate',
              payload: cand
            }));
          }
        }

        // Notify other peers in room
        broadcast(currentRoomId, ws, {
          type: 'peer-joined',
          clientId,
          role: clientRole,
          peerCount: roomObj.clients.size
        });
        return;
      }

      const roomObj = currentRoomId ? rooms.get(currentRoomId) : null;
      if (!roomObj) return;

      if (type === 'offer') {
        roomObj.broadcasterWs = ws;
        roomObj.broadcasterOffer = payload;
        roomObj.broadcasterCandidates = [];
        console.log(`[WS] Cached new broadcaster offer in room: ${currentRoomId}`);
        broadcast(currentRoomId, ws, {
          type: 'offer',
          from: clientId,
          payload
        });
        return;
      }

      if (type === 'candidate') {
        if (ws.clientRole === 'sender' || ws === roomObj.broadcasterWs) {
          roomObj.broadcasterCandidates.push(payload);
        }
        broadcast(currentRoomId, ws, {
          type: 'candidate',
          from: clientId,
          payload
        });
        return;
      }

      if (type === 'request-offer') {
        if (roomObj.broadcasterOffer) {
          ws.send(JSON.stringify({
            type: 'offer',
            from: roomObj.broadcasterWs?.clientId,
            payload: roomObj.broadcasterOffer
          }));
          for (const cand of roomObj.broadcasterCandidates) {
            ws.send(JSON.stringify({
              type: 'candidate',
              payload: cand
            }));
          }
        }
        // Also forward request-offer to the broadcaster so it can re-negotiate if desired
        if (roomObj.broadcasterWs && roomObj.broadcasterWs !== ws) {
          roomObj.broadcasterWs.send(JSON.stringify({
            type: 'request-offer',
            from: clientId
          }));
        }
        return;
      }

      if (type === 'ping-sync') {
        ws.send(JSON.stringify({
          type: 'pong-sync',
          clientTime: msg.clientTime,
          serverTime: Date.now()
        }));
        return;
      }

      // Forward any other message (e.g. answer, control)
      broadcast(currentRoomId, ws, {
        type,
        from: clientId,
        role: clientRole,
        payload
      });
    });

    ws.on('close', () => {
      if (currentRoomId && rooms.has(currentRoomId)) {
        const roomObj = rooms.get(currentRoomId);
        roomObj.clients.delete(ws);

        if (ws === roomObj.broadcasterWs) {
          console.log(`[WS] Broadcaster left room: ${currentRoomId}`);
          roomObj.broadcasterWs = null;
          roomObj.broadcasterOffer = null;
          roomObj.broadcasterCandidates = [];
        }

        if (roomObj.clients.size === 0) {
          rooms.delete(currentRoomId);
        } else {
          broadcast(currentRoomId, ws, {
            type: 'peer-left',
            clientId,
            role: clientRole,
            peerCount: roomObj.clients.size
          });
        }
      }
    });
  });

  return wss;
}

function broadcast(roomId, senderWs, message) {
  const roomObj = rooms.get(roomId);
  if (!roomObj) return;
  const raw = JSON.stringify(message);
  for (const client of roomObj.clients) {
    if (client !== senderWs && client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

function broadcastBinary(roomId, senderWs, data) {
  const roomObj = rooms.get(roomId);
  if (!roomObj) return;
  for (const client of roomObj.clients) {
    if (client !== senderWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

main().catch(console.error);

function printBanner() {
  const ips = getLocalIpAddresses();
  const primaryIp = ips[0] ? ips[0].address : '127.0.0.1';
  const localUrl = `http://localhost:${PORT}`;
  const lanUrl = `http://${primaryIp}:${PORT}`;
  const apkDownloadUrl = `http://${primaryIp}:${PORT}/ZeroCast.apk`;

  console.log('\n======================================================');
  console.log('   ⚡ ZeroCast - Ultra-Low-Latency Wireless Casting ⚡   ');
  console.log('======================================================\n');
  console.log(`🖥️  Local Host (PC):        ${localUrl}`);
  console.log(`📱  Phone / Receiver URL:    ${lanUrl}`);
  console.log(`📲  Android APK Download:    ${apkDownloadUrl}`);
  console.log('\nScan this QR code from your mobile device/tablet/TV:');

  qrcode.generate(lanUrl, { small: true }, (qr) => {
    console.log(qr);
    console.log('------------------------------------------------------');
    console.log('📱 Phone Instructions:');
    console.log(`• Watch PC screen in phone browser: ${lanUrl}`);
    console.log(`• Or install native app to cast phone to PC: ${apkDownloadUrl}`);
    console.log('======================================================\n');
  });

  // Auto-launch local host interface on Windows
  if (!process.argv.includes('--no-open') && process.platform === 'win32') {
    require('child_process').exec(`start ${localUrl}`, (err) => {
      if (err) console.log('Open ' + localUrl + ' in your browser.');
    });
  }
}
