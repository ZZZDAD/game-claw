import { WebSocketServer, WebSocket } from 'ws';
import type { Transport, Connection, GameEvent } from '../types/index.js';

// Heartbeat interval and timeout (ms)
const HEARTBEAT_INTERVAL = 10000; // send ping every 10s
const HEARTBEAT_TIMEOUT = 5000;   // if no pong within 5s, consider dead
const MAX_BUFFER_SIZE = 1000;     // P1-5: max buffered messages

class WsConnection implements Connection {
  remoteId?: string;
  isAlive = true;

  private messageHandlers: ((event: GameEvent) => void)[] = [];
  private closeHandlers: (() => void)[] = [];
  private buffer: GameEvent[] = [];
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private pongTimer?: ReturnType<typeof setTimeout>;

  constructor(private ws: WebSocket, private enableHeartbeat = true) {
    // === Message handling ===
    ws.on('message', (raw: Buffer) => {
      const str = raw.toString();

      // Ignore heartbeat pong messages (handled internally)
      if (str === '__pong__') {
        this.handlePong();
        return;
      }
      // Ignore heartbeat ping messages (respond with pong)
      if (str === '__ping__') {
        this.sendRaw('__pong__');
        return;
      }

      const event = JSON.parse(str) as GameEvent;
      if (this.messageHandlers.length === 0) {
        // P1-5: Cap buffer size to prevent OOM
        if (this.buffer.length < MAX_BUFFER_SIZE) {
          this.buffer.push(event);
        }
      } else {
        this.messageHandlers.forEach((h) => h(event));
      }
    });

    // === WebSocket close event — primary disconnect detection ===
    ws.on('close', () => {
      this.markDead();
    });

    // === WebSocket error — also triggers disconnect ===
    ws.on('error', () => {
      this.markDead();
    });

    // === Start heartbeat (server-side only, enabled by default) ===
    if (enableHeartbeat) {
      this.startHeartbeat();
    }
  }

  send(event: GameEvent): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  onMessage(handler: (event: GameEvent) => void): void {
    this.messageHandlers.push(handler);
    for (const event of this.buffer) {
      handler(event);
    }
    this.buffer = [];
  }

  // P1-7: Remove a specific message handler
  removeMessageHandler(handler: (event: GameEvent) => void): void {
    const idx = this.messageHandlers.indexOf(handler);
    if (idx !== -1) this.messageHandlers.splice(idx, 1);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
    // If already dead, fire immediately
    if (!this.isAlive) {
      handler();
    }
  }

  // P1-7: Remove a specific close handler
  removeCloseHandler(handler: () => void): void {
    const idx = this.closeHandlers.indexOf(handler);
    if (idx !== -1) this.closeHandlers.splice(idx, 1);
  }

  close(): void {
    this.stopHeartbeat();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
    this.markDead();
  }

  // === Heartbeat ===

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.isAlive) {
        this.stopHeartbeat();
        return;
      }
      // Send ping
      this.sendRaw('__ping__');
      // Start pong timeout
      this.pongTimer = setTimeout(() => {
        // No pong received within timeout → connection dead
        this.markDead();
      }, HEARTBEAT_TIMEOUT);
    }, HEARTBEAT_INTERVAL);
  }

  private handlePong(): void {
    // Pong received — connection is alive
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
  }

  private sendRaw(data: string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private markDead(): void {
    if (!this.isAlive) return; // already dead, don't fire handlers again
    this.isAlive = false;
    this.stopHeartbeat();
    this.closeHandlers.forEach((h) => h());
  }
}

export class LocalTransport implements Transport {
  private wss?: WebSocketServer;
  private connectionHandlers: ((conn: Connection) => void)[] = [];
  private clientWs?: WebSocket;

  async start(port: number): Promise<string> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port, host: '127.0.0.1' });
      this.wss.on('connection', (ws) => {
        // Server-side connections get heartbeat enabled
        const conn = new WsConnection(ws, true);
        this.connectionHandlers.forEach((h) => h(conn));
      });
      this.wss.on('listening', () => {
        const addr = this.wss!.address() as { port: number };
        resolve(`ws://127.0.0.1:${addr.port}`);
      });
    });
  }

  async connect(url: string): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.clientWs = ws;
      // Client-side: heartbeat enabled (responds to server pings)
      ws.on('open', () => resolve(new WsConnection(ws, true)));
      ws.on('error', reject);
    });
  }

  onConnection(handler: (conn: Connection) => void): void {
    this.connectionHandlers.push(handler);
  }

  async stop(): Promise<void> {
    if (this.clientWs) {
      this.clientWs.close();
    }
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.clients.forEach((c) => c.close());
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
