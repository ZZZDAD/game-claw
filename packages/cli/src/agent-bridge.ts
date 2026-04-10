/**
 * Agent Bridge — connects game-claw to an AI agent's gateway.
 *
 * Supported agents:
 *   - openclaw: connects to OpenClaw gateway (ws://127.0.0.1:18789)
 *   - custom:   connects to any WebSocket endpoint
 *
 * The bridge:
 *   1. Connects TO the agent's gateway (agent is passive, we push to it)
 *   2. Authenticates using the agent's protocol
 *   3. Sends game events as chat messages
 *   4. Receives action responses from the agent
 *
 * OpenClaw protocol:
 *   - Connect with { type: "req", method: "connect", params: { role: "operator", ... } }
 *   - Send messages with { type: "req", method: "chat.send", params: { message, sessionKey } }
 *   - Receive events as { type: "event", event: "chat:*", payload: {...} }
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AgentConfig {
  type: 'openclaw' | 'custom';
  url: string;
  token: string;
  sessionKey?: string;
}

export class AgentBridge {
  private ws?: WebSocket;
  private connected = false;
  private messageHandler?: (message: string) => void;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private sessionKey: string;

  constructor(private config: AgentConfig) {
    this.sessionKey = config.sessionKey ?? `game-claw:${randomUUID().slice(0, 8)}`;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Connection to agent gateway timed out: ${this.config.url}`));
      }, 10_000);

      ws.on('open', () => {
        clearTimeout(timeout);
        if (this.config.type === 'openclaw') {
          this.doOpenClawHandshake(ws).then(() => {
            this.connected = true;
            resolve();
          }).catch(reject);
        } else {
          this.connected = true;
          resolve();
        }
      });

      ws.on('message', (raw) => {
        this.handleIncoming(raw.toString());
      });

      ws.on('close', () => {
        this.connected = false;
        console.log('[agent-bridge] Disconnected from agent gateway');
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        if (!this.connected) {
          reject(err);
        }
      });
    });
  }

  /**
   * OpenClaw handshake: respond to challenge, then send connect request.
   */
  private async doOpenClawHandshake(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('OpenClaw handshake timeout')), 10_000);
      let challengeReceived = false;

      const handler = (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());

          // Step 1: Receive challenge
          if (msg.type === 'event' && msg.event === 'connect.challenge') {
            challengeReceived = true;
            const connectReq = {
              type: 'req',
              id: randomUUID(),
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: 'game-claw',
                  version: '0.1.0',
                  platform: process.platform,
                  mode: 'operator',
                },
                role: 'operator',
                scopes: ['operator.read', 'operator.write'],
                caps: [],
                commands: [],
                permissions: {},
                auth: { token: this.config.token },
                locale: 'en-US',
                userAgent: 'game-claw/0.1.0',
                device: {
                  id: `game-claw-${randomUUID().slice(0, 8)}`,
                  nonce: msg.payload?.nonce,
                },
              },
            };
            ws.send(JSON.stringify(connectReq));
          }

          // Step 2: Receive connect response
          if (msg.type === 'res' && challengeReceived) {
            clearTimeout(timeout);
            ws.removeListener('message', handler);
            if (msg.ok) {
              resolve();
            } else {
              reject(new Error(`OpenClaw connect failed: ${msg.error?.message ?? 'unknown'}`));
            }
          }
        } catch {}
      };

      ws.on('message', handler);
    });
  }

  /**
   * Send a game event to the agent as a chat message.
   */
  send(eventType: string, data: unknown): void {
    if (!this.ws || !this.connected) return;

    const message = JSON.stringify({ gameEvent: eventType, ...data as object });

    if (this.config.type === 'openclaw') {
      const req = {
        type: 'req',
        id: randomUUID(),
        method: 'chat.send',
        params: {
          sessionKey: this.sessionKey,
          message,
          idempotencyKey: randomUUID(),
        },
      };
      this.ws.send(JSON.stringify(req));
    } else {
      // Custom agent: plain JSON
      this.ws.send(JSON.stringify({ type: eventType, data }));
    }
  }

  /**
   * Register handler for messages FROM the agent (action responses).
   */
  onMessage(handler: (message: string) => void): void {
    this.messageHandler = handler;
  }

  private handleIncoming(raw: string): void {
    try {
      const msg = JSON.parse(raw);

      if (this.config.type === 'openclaw') {
        // OpenClaw sends events for chat responses
        if (msg.type === 'event' && msg.event?.startsWith('chat:')) {
          const text = msg.payload?.text ?? msg.payload?.content ?? '';
          if (text) this.messageHandler?.(text);
        }
        // Also handle direct responses
        if (msg.type === 'res' && msg.ok && msg.payload?.text) {
          this.messageHandler?.(msg.payload.text);
        }
      } else {
        // Custom agent: expect plain JSON with action
        this.messageHandler?.(raw);
      }
    } catch {}
  }

  isConnected(): boolean {
    return this.connected;
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

/**
 * Resolve agent config from CLI args + environment + config files.
 *
 * Priority:
 *   1. Explicit CLI flags (--agent-url, --agent-token)
 *   2. Environment variables (OPENCLAW_GATEWAY_TOKEN, etc.)
 *   3. Config files (~/.openclaw/openclaw.json, gateway.token)
 */
export function resolveAgentConfig(opts: Record<string, string>): AgentConfig | null {
  const agentType = (opts['agent'] ?? 'openclaw') as 'openclaw' | 'custom';
  const explicitUrl = opts['agent-url'];
  const explicitToken = opts['agent-token'];

  if (agentType === 'custom') {
    if (!explicitUrl) {
      console.error('--agent-url is required for custom agents');
      return null;
    }
    return {
      type: 'custom',
      url: explicitUrl,
      token: explicitToken ?? '',
      sessionKey: opts['agent-session'],
    };
  }

  // OpenClaw: resolve URL
  const url = explicitUrl
    ?? process.env.OPENCLAW_GATEWAY_URL
    ?? 'ws://127.0.0.1:18789';

  // OpenClaw: resolve token
  let token = explicitToken ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? '';

  if (!token) {
    // Try reading from OpenClaw config
    const configPath = join(homedir(), '.openclaw', 'openclaw.json');
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        // JSON5-ish: strip comments for basic parsing
        const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const config = JSON.parse(cleaned);
        token = config?.gateway?.auth?.token ?? '';
      } catch {}
    }
  }

  if (!token) {
    // Try reading auto-generated token file
    const tokenPath = join(homedir(), '.openclaw', 'gateway.token');
    if (existsSync(tokenPath)) {
      try {
        token = readFileSync(tokenPath, 'utf-8').trim();
      } catch {}
    }
  }

  if (!token) {
    console.warn('[agent-bridge] No OpenClaw token found. Tried: --agent-token, OPENCLAW_GATEWAY_TOKEN, ~/.openclaw/openclaw.json, ~/.openclaw/gateway.token');
    console.warn('[agent-bridge] Connecting without authentication...');
  }

  return {
    type: 'openclaw',
    url,
    token,
    sessionKey: opts['agent-session'] ?? `game-claw:${randomUUID().slice(0, 8)}`,
  };
}
