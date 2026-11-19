/**
 * ZeroCast Native Input Bridge (Windows)
 * Relays touch/mouse clicks received over WebRTC DataChannel to the Windows OS.
 * Uses PowerShell / User32 mouse_event for zero external native dependencies.
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');

const SERVER_URL = process.env.SERVER_URL || 'ws://127.0.0.1:8080';
const ROOM = process.env.ROOM || 'default-room';

// Persistent PowerShell process with user32.dll mouse_event loaded
const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinInput {
    [DllImport("user32.dll")]
    public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);
}
"@
`;

console.log('⚡ Initializing Windows Native Input Controller...');
const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
  stdio: ['pipe', 'inherit', 'inherit']
});

ps.stdin.write(psScript + "\n");

function sendClick(normX, normY) {
  // Convert normalized 0.0 - 1.0 coordinates to screen pixels
  const cmd = `
    $w = [WinInput]::GetSystemMetrics(0)
    $h = [WinInput]::GetSystemMetrics(1)
    $x = [int](${normX} * $w)
    $y = [int](${normY} * $h)
    [WinInput]::SetCursorPos($x, $y)
    [WinInput]::mouse_event(0x0002, 0, 0, 0, 0) # MOUSEEVENTF_LEFTDOWN
    [WinInput]::mouse_event(0x0004, 0, 0, 0, 0) # MOUSEEVENTF_LEFTUP
  \n`;
  ps.stdin.write(cmd);
}

// Connect to ZeroCast signaling server as input receiver
function connect() {
  const ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('⚡ Connected to ZeroCast Signaling for Input Relaying');
    ws.send(JSON.stringify({
      type: 'join',
      room: ROOM,
      role: 'input-bridge'
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'input-event' || (msg.payload && msg.payload.type === 'input-pointer')) {
        const payload = msg.payload || msg;
        if (payload.action === 'down' && payload.x !== undefined && payload.y !== undefined) {
          sendClick(payload.x, payload.y);
        }
      }
    } catch (e) {
      // ignore
    }
  });

  ws.on('close', () => {
    console.log('Disconnected from signaling, reconnecting in 2s...');
    setTimeout(connect, 2000);
  });

  ws.on('error', (err) => {
    // console.log('Signaling wait...');
  });
}

connect();

process.on('SIGINT', () => {
  ps.kill();
  process.exit(0);
});
