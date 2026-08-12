import type { Duplex } from "node:stream";

const claimedSockets = new WeakSet<Duplex>();
const scheduledRejections = new WeakSet<Duplex>();

export function claimWebSocketUpgrade(socket: Duplex): void {
  claimedSockets.add(socket);
}

export function rejectUnclaimedWebSocketUpgrade(socket: Duplex): void {
  if (scheduledRejections.has(socket)) return;
  scheduledRejections.add(socket);
  queueMicrotask(() => {
    if (claimedSockets.has(socket) || socket.destroyed) return;
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  });
}

