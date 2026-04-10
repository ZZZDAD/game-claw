/**
 * Player CLI — join a game room with one command.
 *
 * Starts:
 *   1. PlayerNode connected to the dealer's invite URL
 *   2. Local WS gateway on --port for OpenClaw to connect
 *
 * Events forwarded to OpenClaw:
 *   your-turn     → OpenClaw decides what to do, sends back an action
 *   action-result → all players' actions broadcast
 *   game-start    → new hand started, cards dealt
 *   game-end      → hand result with winners and point changes
 *   hand-cards    → player's own decrypted cards
 *   timeout       → player timed out, auto-action taken
 *   rejected      → player's action was invalid
 *
 * OpenClaw sends back:
 *   action        → { type: 'fold'|'call'|'raise'|..., payload?: {...} }
 *   query         → { queryType: 'my-balance'|'room-state'|... }
 */
import { parseArgs } from './parse-args.js';
import { Gateway } from './gateway.js';
import { PlayerNode, generateIdentity, serializeIdentity } from '@game-claw/core';

export async function startPlayer(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  const inviteUrl = opts['url'];
  if (!inviteUrl) {
    console.error('Error: --url <invite-url> is required');
    process.exit(1);
  }

  const gwPort = parseInt(opts['port'] ?? '9002');

  // Generate identity
  const identity = generateIdentity();
  const player = new PlayerNode(identity, '0.1.0');

  // Start gateway for OpenClaw
  const gateway = new Gateway(gwPort);

  // Join the room
  console.log(`[player] Connecting to ${inviteUrl}...`);
  const joinResult = await player.join(inviteUrl);
  if (!joinResult.accepted) {
    console.error(`[player] Join failed: ${joinResult.reason}`);
    await gateway.stop();
    process.exit(1);
  }

  const playerId = player.getPlayerId();
  const gameType = player.getGameType();

  console.log('');
  console.log('='.repeat(60));
  console.log(`  Game Claw Player`);
  console.log('='.repeat(60));
  console.log(`  Game:      ${gameType}`);
  console.log(`  Player ID: ${playerId.slice(0, 16)}...`);
  console.log(`  Gateway:   ws://127.0.0.1:${gwPort}`);
  console.log('='.repeat(60));
  console.log('');
  console.log('Connected to dealer. OpenClaw can connect to the gateway.');
  console.log('Game events will be forwarded automatically.');
  console.log('Press Ctrl+C to leave.\n');

  // Forward: your-turn → OpenClaw
  player.onMyTurn((turnInfo) => {
    console.log(`[player] My turn — phase: ${turnInfo.phase}, balance: ${turnInfo.chipBalance}, actions: ${turnInfo.validActions.map(a => a.type).join(', ')}`);
    gateway.send('your-turn', {
      validActions: turnInfo.validActions,
      chipBalance: turnInfo.chipBalance,
      phase: turnInfo.phase,
      gameType: turnInfo.gameType,
      warning: turnInfo.warning,
      playerId,
    });
  });

  // Forward: action rejected → OpenClaw
  player.onActionRejected((reason) => {
    console.log(`[player] Action rejected: ${reason}`);
    gateway.send('action-rejected', { reason, playerId });
  });

  // Forward: timeout auto-action → OpenClaw
  player.onTimeout((action) => {
    console.log(`[player] Timed out, auto-action: ${action.type}`);
    gateway.send('timeout-action', { action, playerId });
  });

  // Forward: game end → OpenClaw
  player.waitForGameEnd().then((result) => {
    const r = result as { result?: { winners: string[]; pointChanges: Record<string, number> } };
    console.log(`[player] Game ended. Winners: ${r.result?.winners?.join(', ') ?? 'unknown'}`);
    gateway.send('game-end', {
      ...r,
      playerId,
      history: player.getHistory(),
    });
  });

  // Receive actions FROM OpenClaw → forward to dealer
  gateway.onMessage(async (msg) => {
    if (msg.type === 'action') {
      const actionData = msg.data as { type: string; payload?: unknown };
      console.log(`[player] OpenClaw action: ${actionData.type}`);
      await player.sendAction({
        playerId,
        type: actionData.type,
        payload: actionData.payload,
      });
    } else if (msg.type === 'query') {
      const queryData = msg.data as { queryType: string };
      try {
        let result: unknown;
        switch (queryData.queryType) {
          case 'my-balance':
            result = await player.queryBalance();
            gateway.send('query-result', { queryType: 'my-balance', balance: result });
            break;
          case 'room-state':
            result = await player.queryRoomState();
            gateway.send('query-result', { queryType: 'room-state', ...result as object });
            break;
          case 'table-state':
            result = await player.queryTableState();
            gateway.send('query-result', { queryType: 'table-state', ...result as object });
            break;
          case 'room-config':
            result = await player.queryRoomConfig();
            gateway.send('query-result', { queryType: 'room-config', config: result });
            break;
          case 'my-status':
            result = await player.queryMyStatus();
            gateway.send('query-result', { queryType: 'my-status', ...result as object });
            break;
          case 'history':
            gateway.send('query-result', { queryType: 'history', history: player.getHistory() });
            break;
          default:
            gateway.send('query-error', { error: `Unknown query: ${queryData.queryType}` });
        }
      } catch (err) {
        gateway.send('query-error', { error: (err as Error).message });
      }
    } else if (msg.type === 'get-hand') {
      gateway.send('hand-cards', {
        cards: player.getHand(),
        playerId,
      });
    } else if (msg.type === 'get-state') {
      gateway.send('player-state', {
        playerId,
        gameType: player.getGameType(),
        phase: player.getPhase(),
        chipBalance: player.getChipBalance(),
        hand: player.getHand(),
        communityCards: player.getCommunityCards(),
      });
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[player] Leaving game...');
    await player.disconnect();
    await gateway.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
