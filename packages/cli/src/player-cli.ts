/**
 * Player CLI — join a game room with one command.
 *
 * Starts:
 *   1. PlayerNode connected to the dealer's invite URL
 *   2. AgentBridge → connects to AI agent gateway, pushes game events
 *   3. Local action port → accepts actions from `game-claw action` CLI
 *   4. Session file → written so `game-claw action` knows where to send
 *
 * Flow:
 *   game events (your-turn etc.) → pushed to agent via AgentBridge
 *   agent decides → calls `game-claw action --type call`
 *   action CLI → connects to local action port → forwarded to dealer
 */
import { parseArgs } from './parse-args.js';
import { AgentBridge, resolveAgentConfig } from './agent-bridge.js';
import { PlayerNode, generateIdentity } from '@game-claw/core';
import { WebSocketServer, WebSocket } from 'ws';
import { writeFileSync, unlinkSync } from 'node:fs';

const SESSION_FILE = 'game-claw-session.json';

export async function startPlayer(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  const inviteUrl = opts['url'];
  if (!inviteUrl) {
    console.error('Error: --url <invite-url> is required');
    process.exit(1);
  }

  const noAgent = opts['no-agent'] === 'true';

  const identity = generateIdentity();
  const player = new PlayerNode(identity, '0.1.0');

  // Connect to AI agent gateway
  let agent: AgentBridge | null = null;
  if (!noAgent) {
    const agentConfig = resolveAgentConfig(opts);
    if (agentConfig) {
      agent = new AgentBridge(agentConfig);
      try {
        await agent.connect();
        console.log(`[player] Connected to ${agentConfig.type} agent at ${agentConfig.url}`);
      } catch (err) {
        console.warn(`[player] Agent connection failed: ${(err as Error).message}`);
        console.warn('[player] Running without agent. Use --no-agent to suppress.');
        agent = null;
      }
    }
  }

  // Join the room
  console.log(`[player] Connecting to ${inviteUrl}...`);
  const joinResult = await player.join(inviteUrl);
  if (!joinResult.accepted) {
    console.error(`[player] Join failed: ${joinResult.reason}`);
    await agent?.stop();
    process.exit(1);
  }

  const playerId = player.getPlayerId();
  const gameType = player.getGameType();

  // Start local action port (for `game-claw action` CLI command)
  const actionWss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const actionPort = await new Promise<number>((resolve) => {
    actionWss.on('listening', () => {
      resolve((actionWss.address() as { port: number }).port);
    });
  });

  // Accept action commands from CLI
  actionWss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'action') {
          const actionData = msg.data as { type: string; payload?: unknown };
          console.log(`[player] CLI action: ${actionData.type}`);
          await player.sendAction({
            playerId,
            type: actionData.type,
            payload: actionData.payload,
          });
        }
      } catch {}
    });
  });

  // Write session file for `game-claw action`
  writeFileSync(SESSION_FILE, JSON.stringify({
    playerId,
    dealerUrl: inviteUrl,
    role: 'player',
    actionPort,
    gameType,
    startedAt: new Date().toISOString(),
  }, null, 2));

  // Forward game events to agent
  player.onMyTurn((turnInfo) => {
    console.log(`[player] My turn — phase: ${turnInfo.phase}, balance: ${turnInfo.chipBalance}, actions: ${turnInfo.validActions.map(a => a.type).join(', ')}`);
    agent?.send('your-turn', {
      validActions: turnInfo.validActions,
      chipBalance: turnInfo.chipBalance,
      phase: turnInfo.phase,
      gameType: turnInfo.gameType,
      warning: turnInfo.warning,
      playerId,
    });
  });

  player.onActionRejected((reason) => {
    console.log(`[player] Action rejected: ${reason}`);
    agent?.send('action-rejected', { reason, playerId });
  });

  player.onTimeout((action) => {
    console.log(`[player] Timed out, auto-action: ${action.type}`);
    agent?.send('timeout-action', { action, playerId });
  });

  player.waitForGameEnd().then((result) => {
    const r = result as { result?: { winners: string[]; pointChanges: Record<string, number> } };
    console.log(`[player] Game ended. Winners: ${r.result?.winners?.join(', ') ?? 'unknown'}`);
    agent?.send('game-end', {
      ...r,
      playerId,
      history: player.getHistory(),
    });
  });

  // If agent sends back action responses, forward them
  agent?.onMessage((message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type || parsed.action || parsed.gameAction) {
        const actionType = parsed.type ?? parsed.action ?? parsed.gameAction;
        console.log(`[player] Agent action: ${actionType}`);
        player.sendAction({
          playerId,
          type: actionType,
          payload: parsed.payload,
        });
      }
    } catch {
      // Agent might send plain text — ignore
    }
  });

  const agentStatus = agent?.isConnected() ? `connected (${opts['agent'] ?? 'openclaw'})` : 'not connected';

  console.log('');
  console.log('='.repeat(60));
  console.log(`  Game Claw Player`);
  console.log('='.repeat(60));
  console.log(`  Game:       ${gameType}`);
  console.log(`  Player ID:  ${playerId.slice(0, 16)}...`);
  console.log(`  Agent:      ${agentStatus}`);
  console.log(`  Actions:    game-claw action --type <action>`);
  console.log('='.repeat(60));
  console.log('');
  console.log('Game events are pushed to the agent automatically.');
  console.log('To send actions manually: game-claw action --type call');
  console.log('Press Ctrl+C to leave.\n');

  const shutdown = async () => {
    console.log('\n[player] Leaving game...');
    try { unlinkSync(SESSION_FILE); } catch {}
    await player.disconnect();
    await agent?.stop();
    actionWss.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
