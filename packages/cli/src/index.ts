#!/usr/bin/env node
export {};
/**
 * game-claw CLI
 *
 * Usage:
 *   game-claw dealer --game texas-holdem
 *   game-claw player --url wss://xxx.trycloudflare.com
 *   game-claw action --type call
 */

const args = process.argv.slice(2);
const command = args[0];

function printUsage(): void {
  console.log(`
game-claw — Decentralized card game CLI

Commands:
  dealer    Start a game room as the dealer
  player    Join a game room as a player
  action    Send a game action (used by AI agents)

Dealer usage:
  game-claw dealer [options]

  --game <type>          Game: texas-holdem, blackjack, dou-di-zhu  (default: texas-holdem)
  --buy-in <n>           Initial chips per player                   (default: 500)
  --min-bet <n>          Minimum bet                                (default: 10)
  --max-bet <n>          Maximum bet                                (default: 100)
  --commission <n>       Dealer fee per player per hand              (default: 2)
  --chips-url <url>      External points server URL                  (auto-starts built-in if omitted)
  --chips-token <t>      Points server auth token                    (auto-generated if omitted)
  --timeout <ms>         Action timeout                              (default: 30000)
  --local                Use local transport (no Cloudflare)

  Agent connection:
  --agent <type>         Agent type: openclaw, custom                (default: openclaw)
  --agent-url <url>      Agent gateway URL                           (default: ws://127.0.0.1:18789)
  --agent-token <token>  Agent auth token                            (auto-reads from ~/.openclaw/)
  --agent-session <key>  Session key for agent communication
  --no-agent             Run without connecting to any agent

Player usage:
  game-claw player [options]

  --url <url>            Invite URL from the dealer (required)
  --agent <type>         Agent type: openclaw, custom                (default: openclaw)
  --agent-url <url>      Agent gateway URL                           (default: ws://127.0.0.1:18789)
  --agent-token <token>  Agent auth token                            (auto-reads from ~/.openclaw/)
  --agent-session <key>  Session key for agent communication
  --no-agent             Run without connecting to any agent

Action usage:
  game-claw action [options]

  --type <action>        Action type: fold, call, raise, check, hit, stand, bid, play, pass, ...
  --amount <n>           Amount (for raise, bet, insurance)
  --bid <n>              Bid value (for dou-di-zhu)
  --cards <json>         Cards array as JSON (for dou-di-zhu play)
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
} else if (command === 'action') {
  const { sendAction } = await import('./action-cli.js');
  await sendAction(args.slice(1));
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}
