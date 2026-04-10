import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import type { Transport, Connection, GameEvent } from '../types/index.js';

// Heartbeat constants (same as local transport)
const HEARTBEAT_INTERVAL = 10000;
const HEARTBEAT_TIMEOUT = 5000;
const MAX_BUFFER_SIZE = 1000;

class WsConnection implements Connection {
  remoteId?: string;
  isAlive = true;

  private messageHandlers: ((event: GameEvent) => void)[] = [];
  private closeHandlers: (() => void)[] = [];
  private buffer: GameEvent[] = [];
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private pongTimer?: ReturnType<typeof setTimeout>;

  constructor(private ws: WebSocket, enableHeartbeat = true) {
    ws.on('message', (raw: Buffer) => {
      const str = raw.toString();
      if (str === '__pong__') { this.handlePong(); return; }
      if (str === '__ping__') { this.sendRaw('__pong__'); return; }

      const event = JSON.parse(str) as GameEvent;
      if (this.messageHandlers.length === 0) {
        if (this.buffer.length < MAX_BUFFER_SIZE) {
          this.buffer.push(event);
        }
      } else {
        this.messageHandlers.forEach((h) => h(event));
      }
    });

    ws.on('close', () => this.markDead());
    ws.on('error', () => this.markDead());

    if (enableHeartbeat) this.startHeartbeat();
  }

  send(event: GameEvent): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  onMessage(handler: (event: GameEvent) => void): void {
    this.messageHandlers.push(handler);
    for (const event of this.buffer) handler(event);
    this.buffer = [];
  }

  removeMessageHandler(handler: (event: GameEvent) => void): void {
    const idx = this.messageHandlers.indexOf(handler);
    if (idx !== -1) this.messageHandlers.splice(idx, 1);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
    if (!this.isAlive) handler();
  }

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

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.isAlive) { this.stopHeartbeat(); return; }
      this.sendRaw('__ping__');
      this.pongTimer = setTimeout(() => this.markDead(), HEARTBEAT_TIMEOUT);
    }, HEARTBEAT_INTERVAL);
  }

  private handlePong(): void {
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = undefined; }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = undefined; }
  }

  private sendRaw(data: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  private markDead(): void {
    if (!this.isAlive) return;
    this.isAlive = false;
    this.stopHeartbeat();
    this.closeHandlers.forEach((h) => h());
  }
}

/**
 * CloudflareTransport — exposes a local WebSocket server to the internet
 * via Cloudflare's free Quick Tunnel (no account needed).
 *
 * Requirements:
 *   - `cloudflared` must be installed and available in PATH
 *   - Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
 *
 * How it works:
 *   1. Start a local WebSocket server on a random port
 *   2. Launch `cloudflared tunnel --url http://localhost:{port}`
 *   3. Parse the public URL from cloudflared output (e.g., https://xxx.trycloudflare.com)
 *   4. Players connect to wss://xxx.trycloudflare.com
 *   5. Cloudflare proxies WebSocket traffic to the local server
 */
export class CloudflareTransport implements Transport {
  private wss?: WebSocketServer;
  private cloudflaredProcess?: ChildProcess;
  private connectionHandlers: ((conn: Connection) => void)[] = [];
  private publicUrl?: string;
  private clientWs?: WebSocket;

  /**
   * Start a local WebSocket server and expose it via Cloudflare Tunnel.
   *
   * @param port - Local port for WebSocket server (0 = random)
   * @returns Public URL (wss://xxx.trycloudflare.com) that players can connect to
   */
  async start(port: number): Promise<string> {
    // Step 1: Start local WebSocket server
    const localPort = await this.startLocalServer(port);

    // Step 2: Launch cloudflared tunnel
    this.publicUrl = await this.startTunnel(localPort);

    // Convert https:// to wss:// for WebSocket connections
    const wsUrl = this.publicUrl.replace('https://', 'wss://');
    return wsUrl;
  }

  private startLocalServer(port: number): Promise<number> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port, host: '0.0.0.0' });
      this.wss.on('connection', (ws) => {
        const conn = new WsConnection(ws, true);
        this.connectionHandlers.forEach((h) => h(conn));
      });
      this.wss.on('listening', () => {
        const addr = this.wss!.address() as { port: number };
        resolve(addr.port);
      });
    });
  }

  private startTunnel(localPort: number): Promise<string> {
    return new Promise((resolve, reject) => {
      // Launch cloudflared with Quick Tunnel mode (no account needed)
      const proc = spawn('cloudflared', [
        'tunnel', '--url', `http://localhost:${localPort}`,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.cloudflaredProcess = proc;

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('cloudflared tunnel failed to start within 30s'));
        }
      }, 30000);

      // cloudflared prints the public URL to stderr
      // Look for: "https://xxx.trycloudflare.com"
      const parseOutput = (data: Buffer) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(match[0]);
        }
      };

      proc.stdout?.on('data', parseOutput);
      proc.stderr?.on('data', parseOutput);

      proc.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new Error(
              'cloudflared not found. Install it from:\n' +
              'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n\n' +
              'macOS:   brew install cloudflared\n' +
              'Linux:   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared\n' +
              'Windows: Download from the Cloudflare website'
            ));
          } else {
            reject(err);
          }
        }
      });

      proc.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Connect to a remote Cloudflare tunnel URL as a player.
   * The URL should be wss://xxx.trycloudflare.com
   */
  async connect(url: string): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.clientWs = ws;
      ws.on('open', () => resolve(new WsConnection(ws, true)));
      ws.on('error', reject);
    });
  }

  onConnection(handler: (conn: Connection) => void): void {
    this.connectionHandlers.push(handler);
  }

  async stop(): Promise<void> {
    // Close client connection if any
    if (this.clientWs) {
      this.clientWs.close();
    }

    // Kill cloudflared process (P1-6: ensure cleanup with SIGKILL fallback)
    if (this.cloudflaredProcess) {
      const proc = this.cloudflaredProcess;
      this.cloudflaredProcess = undefined;

      proc.kill('SIGTERM');
      const exited = await new Promise<boolean>((resolve) => {
        const forceKillTimer = setTimeout(() => resolve(false), 5000);
        proc.on('exit', () => {
          clearTimeout(forceKillTimer);
          resolve(true);
        });
      });

      if (!exited) {
        // SIGTERM didn't work, force kill
        proc.kill('SIGKILL');
      }
    }

    // Close WebSocket server
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.clients.forEach((c) => c.close());
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /** Get the public URL (available after start()) */
  getPublicUrl(): string | undefined {
    return this.publicUrl;
  }
}
