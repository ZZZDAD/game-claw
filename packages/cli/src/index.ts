#!/usr/bin/env npx tsx
/**
 * game-claw CLI
 *
 * Usage:
 *   npx game-claw dealer --game texas-holdem --buy-in 500
 *   npx game-claw player --url wss://xxx.trycloudflare.com
 *
 * Both commands start a local WebSocket server that OpenClaw connects to.
 * Game events are forwarded automatically — no code needed.
 */

const args = process.argv.slice(2);
const command = args[0];

function printUsage(): void {
  console.log(`
game-claw — Decentralized card game CLI

Commands:
  dealer    Start a game room as the dealer
  player    Join a game room as a player

Dealer usage:
  game-claw dealer [options]

  --game <type>       Game type: texas-holdem, blackjack, dou-di-zhu (default: texas-holdem)
  --buy-in <n>        Initial chips per player (default: 500)
  --min-bet <n>       Minimum bet (default: 10)
  --max-bet <n>       Maximum bet (default: 100)
  --commission <n>    Dealer fee per player per hand (default: 2)
  --port <n>          Local WebSocket port for OpenClaw (default: 9001)
  --chips-url <url>   Points server URL (auto-starts built-in server if omitted)
  --chips-token <t>   Points server auth token (auto-generated if omitted)
  --timeout <ms>      Action timeout in ms (default: 30000)
  --local             Use local transport instead of Cloudflare Tunnel

Player usage:
  game-claw player [options]

  --url <url>         Invite URL from the dealer (required)
  --port <n>          Local WebSocket port for OpenClaw (default: 9002)
`);
}

if (!command || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

if (command === 'dealer') {
  const { startDealer } = await import('./dealer-cli.js');
  await startDealer(args.slice(1));
} else if (command === 'player') {
  const { startPlayer } = await import('./player-cli.js');
  await startPlayer(args.slice(1));
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}
