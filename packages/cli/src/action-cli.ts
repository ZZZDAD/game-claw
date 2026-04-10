/**
 * Action CLI — send a game action without WebSocket.
 *
 * Usage:
 *   game-claw action --type call
 *   game-claw action --type raise --amount 50
 *   game-claw action --type bid --bid 3
 *   game-claw action --type play --cards '["hearts-5","hearts-6"]'
 *
 * Reads the game session file to find the dealer connection,
 * sends the action, and exits.
 */
import { parseArgs } from './parse-args.js';
import { readFileSync, existsSync } from 'node:fs';
import { WebSocket } from 'ws';

const SESSION_FILE = 'game-claw-session.json';

interface Session {
  playerId: string;
  dealerUrl: string;
  role: 'dealer' | 'player';
}

export async function sendAction(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  const actionType = opts['type'];
  if (!actionType) {
    console.error('Error: --type <action-type> is required');
    console.error('Examples: --type call, --type raise --amount 50, --type fold');
    process.exit(1);
  }

  // Build payload from flags
  const payload: Record<string, unknown> = {};
  if (opts['amount']) payload.amount = parseInt(opts['amount']);
  if (opts['bid']) payload.bid = parseInt(opts['bid']);
  if (opts['cards']) {
    try { payload.cards = JSON.parse(opts['cards']); } catch {
      console.error('Error: --cards must be valid JSON array');
      process.exit(1);
    }
  }

  // Read session file
  if (!existsSync(SESSION_FILE)) {
    console.error(`Error: No active game session. Run 'game-claw player' first.`);
    console.error(`Expected session file: ${SESSION_FILE}`);
    process.exit(1);
  }

  let session: Session;
  try {
    session = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    console.error('Error: Invalid session file');
    process.exit(1);
  }

  // Connect to the game's internal action endpoint
  // The player CLI writes a local action port to the session file
  const actionPort = (session as any).actionPort;
  if (!actionPort) {
    console.error('Error: Session file missing actionPort');
    process.exit(1);
  }

  const actionUrl = `ws://127.0.0.1:${actionPort}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(actionUrl);
    const timeout = setTimeout(() => {
      ws.close();
      console.error('Error: Action delivery timed out');
      process.exit(1);
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'action',
        data: {
          type: actionType,
          payload: Object.keys(payload).length > 0 ? payload : undefined,
        },
      }));
      clearTimeout(timeout);
      // Wait briefly for confirmation
      setTimeout(() => {
        ws.close();
        console.log(`Action sent: ${actionType}${Object.keys(payload).length > 0 ? ' ' + JSON.stringify(payload) : ''}`);
        resolve();
      }, 200);
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`Error: Cannot connect to game session (${actionUrl})`);
      console.error('Is the player CLI still running?');
      process.exit(1);
    });
  });
}
