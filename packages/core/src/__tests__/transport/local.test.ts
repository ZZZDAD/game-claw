import { describe, it, expect, afterEach } from 'vitest';
import { LocalTransport } from '../../transport/local.js';
import type { GameEvent } from '../../types/index.js';

describe('LocalTransport', () => {
  const transports: LocalTransport[] = [];

  afterEach(async () => {
    for (const t of transports) await t.stop();
    transports.length = 0;
  });

  it('server accepts connection and exchanges messages', async () => {
    const server = new LocalTransport();
    transports.push(server);
    const url = await server.start(0);

    const receivedByServer: GameEvent[] = [];
    server.onConnection((conn) => {
      conn.onMessage((e) => receivedByServer.push(e));
      conn.send({ type: 'welcome', payload: {}, from: 'server' });
    });

    const client = new LocalTransport();
    transports.push(client);
    const conn = await client.connect(url);

    const receivedByClient: GameEvent[] = [];
    conn.onMessage((e) => receivedByClient.push(e));
    conn.send({ type: 'hello', payload: {}, from: 'client' });

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedByServer).toHaveLength(1);
    expect(receivedByServer[0].type).toBe('hello');
    expect(receivedByClient).toHaveLength(1);
    expect(receivedByClient[0].type).toBe('welcome');
  });

  it('handles multiple clients', async () => {
    const server = new LocalTransport();
    transports.push(server);
    const url = await server.start(0);

    let connectionCount = 0;
    server.onConnection(() => { connectionCount++; });

    const c1 = new LocalTransport();
    const c2 = new LocalTransport();
    transports.push(c1, c2);

    await c1.connect(url);
    await c2.connect(url);
    await new Promise((r) => setTimeout(r, 50));

    expect(connectionCount).toBe(2);
  });

  it('detects client disconnect via onClose', async () => {
    const server = new LocalTransport();
    transports.push(server);
    const url = await server.start(0);

    let serverSideClosed = false;
    server.onConnection((conn) => {
      conn.onClose(() => { serverSideClosed = true; });
    });

    const client = new LocalTransport();
    transports.push(client);
    const conn = await client.connect(url);
    expect(conn.isAlive).toBe(true);

    await new Promise((r) => setTimeout(r, 50));

    // Client disconnects
    conn.close();
    await new Promise((r) => setTimeout(r, 100));

    // Server should detect the close
    expect(serverSideClosed).toBe(true);
    expect(conn.isAlive).toBe(false);
  });

  it('detects server-side close on client', async () => {
    const server = new LocalTransport();
    transports.push(server);
    const url = await server.start(0);

    let serverConn: any;
    server.onConnection((conn) => { serverConn = conn; });

    const client = new LocalTransport();
    transports.push(client);
    const clientConn = await client.connect(url);

    let clientSideClosed = false;
    clientConn.onClose(() => { clientSideClosed = true; });

    await new Promise((r) => setTimeout(r, 50));

    // Server closes the connection
    serverConn.close();
    await new Promise((r) => setTimeout(r, 100));

    expect(clientSideClosed).toBe(true);
    expect(clientConn.isAlive).toBe(false);
  });
});
