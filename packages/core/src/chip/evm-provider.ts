import {
  createPublicClient, createWalletClient, http, parseAbi,
  type PublicClient, type WalletClient, type Address, type Hash,
  formatUnits, parseUnits, getContract,
} from 'viem';
import type {
  ChipProvider, BalanceResponse,
  DebitRequest, DebitResponse,
  CreditRequest, CreditResponse,
  BatchSettleRequest, BatchSettleResponse,
  EvmChipProviderConfig,
} from '../types/index.js';

/**
 * EVM escrow contract ABI.
 * Any EVM chain can deploy this contract to work with the game engine.
 *
 * Expected Solidity interface:
 *
 *   function debit(bytes32 gameId, address player, uint256 amount) external;
 *   function credit(bytes32 gameId, address player, uint256 amount) external;
 *   function batchSettle(bytes32 gameId, address[] players, int256[] amounts) external;
 *   function balanceOf(address player) view returns (uint256);
 */
const ESCROW_ABI = parseAbi([
  'function debit(bytes32 gameId, address player, uint256 amount) external',
  'function credit(bytes32 gameId, address player, uint256 amount) external',
  'function batchSettle(bytes32 gameId, address[] players, int256[] amounts) external',
  'function getBalance(address player) view returns (uint256)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]);

export class EvmChipProvider implements ChipProvider {
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  private contractAddress: Address;
  private tokenAddress?: Address;
  private decimals = 18;

  constructor(private config: EvmChipProviderConfig) {
    this.contractAddress = config.contractAddress as Address;
    this.tokenAddress = config.tokenAddress as Address | undefined;

    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });
  }

  /**
   * Set the wallet client for signing transactions.
   * Must be called before debit/credit/batchSettle.
   * The wallet should be the game dealer's wallet that has permission
   * to call the escrow contract.
   */
  setWalletClient(walletClient: WalletClient): void {
    this.walletClient = walletClient;
  }

  async getBalance(playerId: string): Promise<BalanceResponse> {
    const playerAddress = playerId as Address;

    let balance: bigint;
    if (this.tokenAddress) {
      // ERC-20 token balance
      balance = await this.publicClient.readContract({
        address: this.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [playerAddress],
      }) as bigint;

      // Get decimals on first call
      if (this.decimals === 18) {
        this.decimals = await this.publicClient.readContract({
          address: this.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }) as number;
      }
    } else {
      // Native ETH balance
      balance = await this.publicClient.getBalance({ address: playerAddress });
    }

    const balanceNum = Number(formatUnits(balance, this.decimals));

    return {
      playerId,
      balance: balanceNum,
    };
  }

  async debit(request: DebitRequest): Promise<DebitResponse> {
    if (!this.walletClient) {
      return { success: false, reason: 'wallet_not_configured', balance: 0, txId: '' };
    }

    const playerAddress = request.playerId as Address;
    const amount = parseUnits(request.amount.toString(), this.decimals);
    const gameIdBytes = stringToBytes32(request.gameId);

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: ESCROW_ABI,
        functionName: 'debit',
        args: [gameIdBytes, playerAddress, amount],
        chain: null,
        account: this.walletClient.account!,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: hash as Hash });

      const bal = await this.getBalance(request.playerId);
      return { success: true, balance: bal.balance, txId: receipt.transactionHash };
    } catch (err) {
      const bal = await this.getBalance(request.playerId).catch(() => ({ balance: 0 }));
      return { success: false, reason: (err as Error).message, balance: bal.balance, txId: '' };
    }
  }

  async credit(request: CreditRequest): Promise<CreditResponse> {
    if (!this.walletClient) {
      return { success: false, balance: 0, txId: '' };
    }

    const playerAddress = request.playerId as Address;
    const amount = parseUnits(request.amount.toString(), this.decimals);
    const gameIdBytes = stringToBytes32(request.gameId);

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: ESCROW_ABI,
        functionName: 'credit',
        args: [gameIdBytes, playerAddress, amount],
        chain: null,
        account: this.walletClient.account!,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: hash as Hash });

      const bal = await this.getBalance(request.playerId);
      return { success: true, balance: bal.balance, txId: receipt.transactionHash };
    } catch {
      return { success: false, balance: 0, txId: '' };
    }
  }

  async batchSettle(request: BatchSettleRequest): Promise<BatchSettleResponse> {
    if (!this.walletClient) {
      return { success: false, txId: '', balances: {} };
    }

    const gameIdBytes = stringToBytes32(request.gameId);
    const players = request.settlements.map((s) => s.playerId as Address);
    const amounts = request.settlements.map((s) =>
      parseUnits(s.amount.toString(), this.decimals)
    );

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: ESCROW_ABI,
        functionName: 'batchSettle',
        args: [gameIdBytes, players, amounts],
        chain: null,
        account: this.walletClient.account!,
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: hash as Hash });

      // Fetch updated balances
      const balances: Record<string, number> = {};
      for (const s of request.settlements) {
        const bal = await this.getBalance(s.playerId);
        balances[s.playerId] = bal.balance;
      }

      return {
        success: true,
        txId: receipt.transactionHash,
        balances,
      };
    } catch {
      return { success: false, txId: '', balances: {} };
    }
  }
}

// Convert a string to bytes32 (left-padded)
function stringToBytes32(str: string): `0x${string}` {
  const hex = Buffer.from(str).toString('hex').padEnd(64, '0').slice(0, 64);
  return `0x${hex}` as `0x${string}`;
}
