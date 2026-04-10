import type { ChipProviderConfig, ChipProvider } from '../types/index.js';
import { LocalChipProvider } from './local-provider.js';
import { RemoteChipProvider } from './remote-provider.js';
import { EvmChipProvider } from './evm-provider.js';
import { SolanaChipProvider } from './solana-provider.js';

/**
 * Creates the appropriate ChipProvider adapter based on config type.
 *
 *   type: 'local'  → LocalChipProvider  (in-memory, for testing)
 *   type: 'http'   → RemoteChipProvider (calls any HTTP service implementing the protocol)
 *   type: 'evm'    → EvmChipProvider    (Ethereum/Polygon/BSC/any EVM chain)
 *   type: 'solana'  → SolanaChipProvider (Solana mainnet/devnet)
 */
export function createChipProvider(config: ChipProviderConfig): ChipProvider {
  switch (config.type) {
    case 'local':
      return new LocalChipProvider();

    case 'http':
      return new RemoteChipProvider(config.url, config.authToken);

    case 'evm':
      return new EvmChipProvider(config);

    case 'solana':
      return new SolanaChipProvider(config);

    default:
      throw new Error(`Unknown ChipProvider type: ${(config as { type: string }).type}`);
  }
}
