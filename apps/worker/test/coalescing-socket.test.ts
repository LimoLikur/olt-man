import { type AddressInfo, createServer, Socket } from 'node:net';
import { expect, it, vi } from 'vitest';
import { connectCoalescing } from '../src/cli/coalescing-socket.js';

// Asserted on the sending side: a receiver may read two segments in one go, which hid the bug
// where connect() dropped the override and every packet left in two writes.
it('hands what was written in one tick to the OS as one write (an SSH packet with its MAC)', async () => {
  const received: Buffer[] = [];
  const server = createServer((c) => c.on('data', (d: Buffer) => received.push(d)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const sock = connectCoalescing({ host: '127.0.0.1', port: (server.address() as AddressInfo).port });
  await new Promise((resolve) => sock.once('connect', resolve));
  expect(sock.write).not.toBe(Socket.prototype.write); // the override survived connect()

  const writev = vi.spyOn(sock as unknown as { _writev: (...a: unknown[]) => void }, '_writev');
  const write1 = vi.spyOn(sock as unknown as { _write: (...a: unknown[]) => void }, '_write');
  sock.write(Buffer.from('packet-body')); // ssh2: encrypted packet...
  sock.write(Buffer.from('mac')); // ...then its MAC, same tick
  expect(sock.writableCorked).toBe(1);
  await new Promise((resolve) => process.nextTick(resolve));
  expect(write1).not.toHaveBeenCalled();
  expect(writev).toHaveBeenCalledTimes(1);
  expect((writev.mock.calls[0]![0] as unknown[]).length).toBe(2);
  await vi.waitFor(() => expect(Buffer.concat(received).toString()).toBe('packet-bodymac'));

  // A later tick is not held back.
  sock.write(Buffer.from('next'));
  await vi.waitFor(() => expect(Buffer.concat(received).toString()).toBe('packet-bodymacnext'));
  sock.destroy();
  await new Promise((resolve) => server.close(resolve));
});
