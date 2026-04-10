/**
 * Generate a random API secret for the points server.
 * Run: pnpm run generate-secret
 *
 * This creates a .env file with a DEALER_SECRET that must be kept private.
 * Only the dealer  who starts this server should know this secret.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');

if (existsSync(envPath)) {
  console.log('⚠ .env already exists. Delete it first if you want to regenerate.');
  process.exit(1);
}

const secret = randomBytes(32).toString('hex');
const content = [
  '# Points Server Configuration',
  '# ⚠ KEEP THIS SECRET — only the dealer  should have it',
  `DEALER_SECRET=${secret}`,
  '',
  '# Server port (default: 3100)',
  'PORT=3100',
  '',
  '# Initial points for new players (default: 1000)',
  'INITIAL_POINTS=1000',
  '',
  '# Rate limit: max requests per minute per IP (default: 60)',
  'RATE_LIMIT=60',
  '',
].join('\n');

writeFileSync(envPath, content);
console.log('✔ .env created with DEALER_SECRET');
console.log(`  Secret: ${secret.slice(0, 8)}...${secret.slice(-8)}`);
console.log('');
console.log('Pass this secret to your DealerNode roomConfig:');
console.log(`  chipProvider: { type: 'http', url: 'http://localhost:3100', authToken: '${secret}' }`);
