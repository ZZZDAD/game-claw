/**
 * Dealer CLI — start a game room with one command.
 *
 * Starts:
 *   1. DealerNode with Cloudflare Tunnel (or local transport)
 *   2. Local WS gateway on --port for OpenClaw to connect and monitor
 *
 * OpenClaw receives: room-state, hand-start, hand-end, player-join, player-leave
 * OpenClaw does NOT need to make game decisions — the dealer is automated.
 */
import { parseArgs } from './parse-args.js';
import { Gateway } from './gateway.js';
import {
  DealerNode, generateIdentity, serializeIdentity,
  LocalTransport, CloudflareTransport,
  identityToPlayerInfo,
} from '@game-claw/core';
import type { RoomConfig, GamePlugin, DealerLogger, ChipProviderConfig } from '@game-claw/core';

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function tryImport(pkg: string, relative: string): Promise<any> {
  try { return await import(pkg); } catch {}
  // Fallback: resolve relative to this file's location in the monorepo
  const abs = join(__dirname, relative);
  return await import(pathToFileURL(abs).href);
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
  const gwPort = parseInt(opts['port'] ?? '9001');
  const timeout = parseInt(opts['timeout'] ?? '30000');
  const useLocal = opts['local'] === 'true';
  let chipsUrl = opts['chips-url'] ?? '';
  let chipsToken = opts['chips-token'] ?? '';

  // If no external points server specified, start a built-in one
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

  // Generate identity
  const identity = generateIdentity();
  const dealerId = identityToPlayerInfo(identity).id;

  // Room config
  const roomConfig: RoomConfig = {
    gameType,
    chipProvider,
    chipUnit: 'pts',
    minBet,
    maxBet,
    buyIn,
    commission,
  };

  // Start gateway for OpenClaw
  const gateway = new Gateway(gwPort);

  // Logger that forwards to gateway
  const logger: DealerLogger = {
    info: (msg, ...a) => {
      console.log(`[dealer] ${msg}`, ...a);
      gateway.send('log', { level: 'info', message: msg });
    },
    warn: (msg, ...a) => {
      console.warn(`[dealer] ${msg}`, ...a);
      gateway.send('log', { level: 'warn', message: msg });
    },
    error: (msg, ...a) => {
      console.error(`[dealer] ${msg}`, ...a);
      gateway.send('log', { level: 'error', message: msg });
    },
  };

  // Transport
  const transport = useLocal ? new LocalTransport() : new CloudflareTransport();

  // Create dealer
  const dealer = new DealerNode(plugin, identity, '0.1.0', roomConfig, transport, {
    actionTimeout: timeout,
    betweenHandsDelay: 5000,
    autoStart: true,
    logger,
  });

  // Events → gateway
  dealer.onPhaseChange((phase) => {
    gateway.send('phase-change', { phase });
  });

  dealer.onHandComplete_cb((result) => {
    gateway.send('hand-complete', {
      winners: result.winners,
      pointChanges: result.pointChanges,
      commission: result.commission,
    });
  });

  dealer.onPlayerDisconnect((playerId) => {
    gateway.send('player-disconnect', { playerId });
  });

  // Handle queries from OpenClaw
  gateway.onMessage((msg) => {
    if (msg.type === 'get-room-state') {
      const state = dealer.getRoomState();
      gateway.send('room-state', {
        phase: state.phase,
        handCount: state.handCount,
        seats: [...state.seats.values()].map(s => ({
          playerId: s.playerId,
          status: s.status,
          chipBalance: s.chipBalance,
        })),
      });
    } else if (msg.type === 'get-config') {
      gateway.send('room-config', roomConfig);
    }
  });

  // Start room
  let inviteUrl: string;
  try {
    inviteUrl = await dealer.createRoom();
  } catch (err) {
    console.error('Failed to create room:', (err as Error).message);
    process.exit(1);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`  Game Claw Dealer`);
  console.log('='.repeat(60));
  console.log(`  Game:       ${gameType}`);
  console.log(`  Buy-in:     ${buyIn}`);
  console.log(`  Bet range:  ${minBet} - ${maxBet}`);
  console.log(`  Commission: ${commission}/player/hand`);
  console.log(`  Chips:      ${chipsUrl}`);
  console.log(`  Timeout:    ${timeout}ms`);
  console.log('');
  console.log(`  Invite URL: ${inviteUrl}`);
  console.log(`  Gateway:    ws://127.0.0.1:${gwPort}`);
  console.log(`  Dealer ID:  ${dealerId.slice(0, 16)}...`);
  console.log('='.repeat(60));
  console.log('');
  console.log('Share the invite URL with players.');
  console.log('OpenClaw can connect to the gateway for room monitoring.');
  console.log('Press Ctrl+C to stop.\n');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    await dealer.stop();
    await gateway.stop();
    if (builtInServer) await builtInServer.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
