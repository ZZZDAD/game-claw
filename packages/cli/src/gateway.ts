/**
 * Local WebSocket gateway for OpenClaw.
 *
 * Starts a WS server on localhost. OpenClaw connects to it.
 * - Dealer gateway: pushes room events, accepts queries
 * - Player gateway: pushes game events (your-turn, action-result, etc.),
 *   accepts action commands from OpenClaw
 */
import { WebSocketServer, WebSocket } from 'ws';

export interface GatewayMessage {
  type: string;
  data: unknown;
}

export class Gateway {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private messageHandler?: (msg: GatewayMessage) => void;

  constructor(private port: number) {
    this.wss = new WebSocketServer({ port, host: '127.0.0.1' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[gateway] OpenClaw connected (port ${this.port})`);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as GatewayMessage;
          this.messageHandler?.(msg);
        } catch {
          // ignore malformed messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[gateway] OpenClaw disconnected`);
      });
    });

    this.wss.on('listening', () => {
      console.log(`[gateway] Listening on ws://127.0.0.1:${this.port}`);
    });
  }

  /** Send a message to all connected OpenClaw clients */
  send(type: string, data: unknown): void {
    const msg = JSON.stringify({ type, data });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  /** Register handler for messages FROM OpenClaw */
  onMessage(handler: (msg: GatewayMessage) => void): void {
    this.messageHandler = handler;
  }

  /** Check if any OpenClaw client is connected */
  hasClients(): boolean {
    return this.clients.size > 0;
  }

  async stop(): Promise<void> {
    for (const ws of this.clients) ws.close();
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }
}
