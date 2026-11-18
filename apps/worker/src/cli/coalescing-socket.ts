import { Socket } from 'node:net';

/**
 * Connects a TCP socket that sends everything written within one tick as a single write, so an
 * SSH packet leaves together with its MAC, as OpenSSH sends it. ssh2 writes each encrypted packet
 * in two calls (body, then MAC). A C320 (ZTE_SSH.1.0) resets the connection when a packet arrives
 * split over two TCP segments (seen through a logging proxy, Nov 2026).
 *
 * The override is installed after connect(): net.Socket#connect() resets an own `write` property
 * to Socket.prototype.write, which silently undid an override installed before it.
 */
export function connectCoalescing(options: { host: string; port: number }): Socket {
  const sock = new Socket();
  sock.connect(options);
  const write = sock.write.bind(sock) as (...args: unknown[]) => boolean;
  let corked = false;
  sock.write = ((...args: unknown[]) => {
    if (!corked) {
      corked = true;
      sock.cork();
      // Runs after ssh2 has written the rest of this packet (same tick), before any I/O.
      process.nextTick(() => {
        corked = false;
        sock.uncork();
      });
    }
    return write(...args);
  }) as unknown as Socket['write'];
  return sock;
}
