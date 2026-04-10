import { describe, it, expect } from 'vitest';
import { LocalChipProvider } from '../../chip/local-provider.js';
import { EvmChipProvider } from '../../chip/evm-provider.js';
import { SolanaChipProvider } from '../../chip/solana-provider.js';
import { createChipProvider } from '../../chip/factory.js';

describe('LocalChipProvider', () => {
  it('fund and query balance', async () => {
    const provider = new LocalChipProvider();
    provider.fund('alice', 1000);

    const bal = await provider.getBalance('alice');
    expect(bal.balance).toBe(1000);
  });

  it('debit reduces balance', async () => {
    const provider = new LocalChipProvider();
    provider.fund('alice', 1000);

    const res = await provider.debit({ gameId: 'g1', playerId: 'alice', amount: 300, reason: 'bet' });
    expect(res.success).toBe(true);
    expect(res.balance).toBe(700);

    const bal = await provider.getBalance('alice');
    expect(bal.balance).toBe(700);
  });

  it('credit increases balance', async () => {
    const provider = new LocalChipProvider();
    provider.fund('alice', 500);

    const res = await provider.credit({ gameId: 'g1', playerId: 'alice', amount: 200, reason: 'pot:main' });
    expect(res.success).toBe(true);
    expect(res.balance).toBe(700);

    const bal = await provider.getBalance('alice');
    expect(bal.balance).toBe(700);
  });

  it('debit fails on insufficient balance', async () => {
    const provider = new LocalChipProvider();
    provider.fund('alice', 100);

    const res = await provider.debit({ gameId: 'g1', playerId: 'alice', amount: 200, reason: 'bet' });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('insufficient_balance');
    expect(res.balance).toBe(100);
  });

  it('batchSettle applies multiple settlements', async () => {
    const provider = new LocalChipProvider();
    provider.fund('alice', 1000);
    provider.fund('bob', 1000);

    // alice loses 200, bob wins 200
    const result = await provider.batchSettle({
      gameId: 'g1',
      settlements: [
        { playerId: 'alice', amount: -200, reason: 'bet' },
        { playerId: 'bob', amount: +200, reason: 'pot:main' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.balances['alice']).toBe(800);
    expect(result.balances['bob']).toBe(1200);
  });
});

describe('createChipProvider factory', () => {
  it('creates LocalChipProvider for type=local', () => {
    const provider = createChipProvider({ type: 'local' });
    expect(provider).toBeInstanceOf(LocalChipProvider);
  });

  it('creates RemoteChipProvider for type=http', () => {
    const provider = createChipProvider({ type: 'http', url: 'https://example.com' });
    expect(provider).toBeDefined();
  });

  it('creates EvmChipProvider for type=evm', () => {
    const provider = createChipProvider({
      type: 'evm', rpcUrl: 'https://rpc.example.com', chainId: 1, contractAddress: '0x0000000000000000000000000000000000000001',
    });
    expect(provider).toBeInstanceOf(EvmChipProvider);
  });

  it('creates SolanaChipProvider for type=solana', () => {
    const provider = createChipProvider({
      type: 'solana', rpcUrl: 'https://api.devnet.solana.com', programId: '11111111111111111111111111111111',
    });
    expect(provider).toBeInstanceOf(SolanaChipProvider);
  });
});
