/**
 * Dealer CLI — start a game room with one command.
 *
 * Starts:
 *   1. DealerNode with Cloudflare Tunnel (or local transport)
 *   2. Built-in points server (if no --chips-url)
 *   3. AgentBridge → connects to AI agent gateway, pushes room events
 */
import { parseArgs } from './parse-args.js';
import { AgentBridge, resolveAgentConfig } from './agent-bridge.js';
import {
  DealerNode, generateIdentity,
  LocalTransport, CloudflareTransport,
  identityToPlayerInfo,
} from '@game-claw/core';
import type { RoomConfig, GamePlugin, DealerLogger, ChipProviderConfig } from '@game-claw/core';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function tryImport(pkg: string, relative: string): Promise<any> {
  try { return await import(pkg); } catch {}
  return await import(pathToFileURL(join(__dirname, relative)).href);
}

async function loadPlugin(gameType: string): Promise<GamePlugin> {
  switch (gameType) {
    case 'texas-holdem': {
      const m = await tryImport('@game-claw/texas-holdem', '../../texas-holdem/src/plugin.js');
      return new m.TexasHoldemPlugin();
    }
    case 'blackjack': {
      const m = await tryImport('@game-claw/blackjack', '../../blackjack/src/plugin.js');
      return new m.BlackjackPlugin();
    }
    case 'dou-di-zhu': {
      const m = await tryImport('@game-claw/dou-di-zhu', '../../dou-di-zhu/src/plugin.js');
      return new m.DouDiZhuPlugin();
    }
    default:
      throw new Error(`Unknown game type: ${gameType}. Use: texas-holdem, blackjack, dou-di-zhu`);
  }
}

export async function startDealer(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  const gameType = opts['game'] ?? 'texas-holdem';
  const buyIn = parseInt(opts['buy-in'] ?? '500');
  const minBet = parseInt(opts['min-bet'] ?? '10');
  const maxBet = parseInt(opts['max-bet'] ?? '100');
  const commission = parseInt(opts['commission'] ?? '2');
  const timeout = parseInt(opts['timeout'] ?? '30000');
  const useLocal = opts['local'] === 'true';
  const noAgent = opts['no-agent'] === 'true';
  let chipsUrl = opts['chips-url'] ?? '';
  let chipsToken = opts['chips-token'] ?? '';

  // Built-in points server
  let builtInServer: any = null;
  if (!chipsUrl) {
    const { startBuiltInPointsServer } = await import('./built-in-points.js');
    const srv = await startBuiltInPointsServer(buyIn);
    chipsUrl = srv.url;
    chipsToken = srv.token;
    builtInServer = srv;
    console.log(`[dealer] Built-in points server started at ${chipsUrl}`);
  }

  const chipProvider: ChipProviderConfig = {
    type: 'http', url: chipsUrl, authToken: chipsToken || undefined,
  };

  // Load game plugin
  let plugin: GamePlugin;
  try {
    plugin = await loadPlugin(gameType);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const identity = generateIdentity();
  const dealerId = identityToPlayerInfo(identity).id;

  const roomConfig: RoomConfig = {
    gameType, chipProvider, chipUnit: 'pts',
    minBet, maxBet, buyIn, commission,
  };

  // Connect to AI agent gateway
  let agent: AgentBridge | null = null;
  if (!noAgent) {
    const agentConfig = resolveAgentConfig(opts);
    if (agentConfig) {
      agent = new AgentBridge(agentConfig);
      try {
        await agent.connect();
        console.log(`[dealer] Connected to ${agentConfig.type} agent at ${agentConfig.url}`);
      } catch (err) {
        console.warn(`[dealer] Agent connection failed: ${(err as Error).message}`);
        console.warn('[dealer] Running without agent. Use --no-agent to suppress this warning.');
        agent = null;
      }
    }
  }

  // Logger → agent + console
  const logger: DealerLogger = {
    info: (msg, ...a) => {
      console.log(`[dealer] ${msg}`, ...a);
      agent?.send('log', { level: 'info', message: msg });
    },
    warn: (msg, ...a) => {
      console.warn(`[dealer] ${msg}`, ...a);
      agent?.send('log', { level: 'warn', message: msg });
    },
    error: (msg, ...a) => {
      console.error(`[dealer] ${msg}`, ...a);
      agent?.send('log', { level: 'error', message: msg });
    },
  };

  const transport = useLocal ? new LocalTransport() : new CloudflareTransport();

  const dealer = new DealerNode(plugin, identity, '0.1.0', roomConfig, transport, {
    actionTimeout: timeout,
    betweenHandsDelay: 5000,
    autoStart: true,
    logger,
  });

  // Push room events to agent
  dealer.onPhaseChange((phase) => {
    agent?.send('phase-change', { phase });
  });
  dealer.onHandComplete_cb((result) => {
    agent?.send('hand-complete', {
      winners: result.winners,
      pointChanges: result.pointChanges,
      commission: result.commission,
    });
  });
  dealer.onPlayerDisconnect((playerId) => {
    agent?.send('player-disconnect', { playerId });
  });

  // Start room
  let inviteUrl: string;
  try {
    inviteUrl = await dealer.createRoom();
  } catch (err) {
    console.error('Failed to create room:', (err as Error).message);
    process.exit(1);
  }

  const agentStatus = agent?.isConnected() ? `connected (${opts['agent'] ?? 'openclaw'})` : 'not connected';

  console.log('');
  console.log('='.repeat(60));
  console.log(`  Game Claw Dealer`);
  console.log('='.repeat(60));
  console.log(`  Game:       ${gameType}`);
  console.log(`  Buy-in:     ${buyIn}`);
  console.log(`  Bet range:  ${minBet} - ${maxBet}`);
  console.log(`  Commission: ${commission}/player/hand`);
  console.log(`  Chips:      ${chipsUrl}`);
  console.log(`  Agent:      ${agentStatus}`);
  console.log('');
  console.log(`  Invite URL: ${inviteUrl}`);
  console.log(`  Dealer ID:  ${dealerId.slice(0, 16)}...`);
  console.log('='.repeat(60));
  console.log('');
  console.log('Share the invite URL with players. Press Ctrl+C to stop.\n');

  const shutdown = async () => {
    console.log('\nShutting down...');
    await dealer.stop();
    await agent?.stop();
    if (builtInServer) await builtInServer.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
