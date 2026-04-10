import {
  Connection, PublicKey, Keypair, Transaction, SystemProgram,
  LAMPORTS_PER_SOL, TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress, getAccount, createTransferInstruction,
  createApproveInstruction, TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type {
  ChipProvider, BalanceResponse,
  DebitRequest, DebitResponse,
  CreditRequest, CreditResponse,
  BatchSettleRequest, BatchSettleResponse,
  SolanaChipProviderConfig,
} from '../types/index.js';

/**
 * Solana chip provider — Method B (real-time debit/credit).
 *
 * Expected on-chain program interface (Anchor-style):
 *
 *   #[program]
 *   mod game_chips {
 *     fn debit(ctx, game_id: [u8; 32], amount: u64) -> Result<()>;
 *     fn credit(ctx, game_id: [u8; 32], amount: u64) -> Result<()>;
 *     fn batch_settle(ctx, game_id: [u8; 32], players: Vec<Pubkey>, amounts: Vec<i64>) -> Result<()>;
 *   }
 *
 * PDA seeds: [b"chips", game_id, player_pubkey]
 */
// P3-16: Default discriminators (Anchor-style), overridable via config
const DEFAULT_DISCRIMINATORS = {
  debit: [0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8],
  credit: [0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x18],
  batchSettle: [0xbf, 0x2e, 0x1e, 0x3d, 0x4c, 0x7a, 0x8b, 0x1f],
};

export class SolanaChipProvider implements ChipProvider {
  private connection: Connection;
  private programId: PublicKey;
  private tokenMint?: PublicKey;
  private decimals = 9; // SOL default
  private dealerKeypair?: Keypair;
  private discriminators: { debit: number[]; credit: number[]; batchSettle: number[] };

  constructor(private config: SolanaChipProviderConfig) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.programId = new PublicKey(config.programId);
    if (config.tokenMint) {
      this.tokenMint = new PublicKey(config.tokenMint);
    }
    this.discriminators = config.discriminators ?? DEFAULT_DISCRIMINATORS;
  }

  /**
   * Set the dealer's keypair for signing transactions.
   * The dealer needs signing authority to call the program.
   */
  setDealerKeypair(keypair: Keypair): void {
    this.dealerKeypair = keypair;
  }

  async getBalance(playerId: string): Promise<BalanceResponse> {
    const playerPubkey = new PublicKey(playerId);

    let balance: number;
    if (this.tokenMint) {
      // SPL token balance
      try {
        const ata = await getAssociatedTokenAddress(this.tokenMint, playerPubkey);
        const account = await getAccount(this.connection, ata);
        balance = Number(account.amount) / (10 ** this.decimals);
      } catch {
        balance = 0; // Account doesn't exist
      }
    } else {
      // Native SOL balance
      const lamports = await this.connection.getBalance(playerPubkey);
      balance = lamports / LAMPORTS_PER_SOL;
    }

    return {
      playerId,
      balance,
    };
  }

  async debit(request: DebitRequest): Promise<DebitResponse> {
    if (!this.dealerKeypair) {
      return { success: false, reason: 'dealer_keypair_not_configured', balance: 0, txId: '' };
    }

    const playerPubkey = new PublicKey(request.playerId);
    const gameIdBytes = Buffer.alloc(32);
    Buffer.from(request.gameId).copy(gameIdBytes);

    try {
      const [chipsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('chips'), gameIdBytes, playerPubkey.toBuffer()],
        this.programId,
      );

      const debitIx = this.buildDebitInstruction(
        playerPubkey,
        chipsPda,
        gameIdBytes,
        request.amount,
      );

      const tx = new Transaction().add(debitIx);
      tx.feePayer = this.dealerKeypair.publicKey;
      tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      tx.sign(this.dealerKeypair);

      const sig = await this.connection.sendRawTransaction(tx.serialize());
      await this.connection.confirmTransaction(sig, 'confirmed');

      const bal = await this.getBalance(request.playerId);
      return { success: true, balance: bal.balance, txId: sig };
    } catch (err) {
      const bal = await this.getBalance(request.playerId).catch(() => ({ balance: 0 }));
      return { success: false, reason: (err as Error).message, balance: bal.balance, txId: '' };
    }
  }

  async credit(request: CreditRequest): Promise<CreditResponse> {
    if (!this.dealerKeypair) {
      return { success: false, balance: 0, txId: '' };
    }

    const playerPubkey = new PublicKey(request.playerId);
    const gameIdBytes = Buffer.alloc(32);
    Buffer.from(request.gameId).copy(gameIdBytes);

    try {
      const [chipsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('chips'), gameIdBytes, playerPubkey.toBuffer()],
        this.programId,
      );

      const creditIx = this.buildCreditInstruction(
        playerPubkey,
        chipsPda,
        gameIdBytes,
        request.amount,
      );

      const tx = new Transaction().add(creditIx);
      tx.feePayer = this.dealerKeypair.publicKey;
      tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      tx.sign(this.dealerKeypair);

      const sig = await this.connection.sendRawTransaction(tx.serialize());
      await this.connection.confirmTransaction(sig, 'confirmed');

      const bal = await this.getBalance(request.playerId);
      return { success: true, balance: bal.balance, txId: sig };
    } catch {
      return { success: false, balance: 0, txId: '' };
    }
  }

  async batchSettle(request: BatchSettleRequest): Promise<BatchSettleResponse> {
    if (!this.dealerKeypair) {
      return { success: false, txId: '', balances: {} };
    }

    const gameIdBytes = Buffer.alloc(32);
    Buffer.from(request.gameId).copy(gameIdBytes);

    try {
      const players = request.settlements.map((s) => new PublicKey(s.playerId));
      const amounts = request.settlements.map((s) => s.amount);

      const settleIx = this.buildBatchSettleInstruction(
        gameIdBytes,
        players,
        amounts,
      );

      const tx = new Transaction().add(settleIx);
      tx.feePayer = this.dealerKeypair.publicKey;
      tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      tx.sign(this.dealerKeypair);

      const sig = await this.connection.sendRawTransaction(tx.serialize());
      await this.connection.confirmTransaction(sig, 'confirmed');

      // Fetch updated balances
      const balances: Record<string, number> = {};
      for (const s of request.settlements) {
        const bal = await this.getBalance(s.playerId);
        balances[s.playerId] = bal.balance;
      }

      return { success: true, txId: sig, balances };
    } catch {
      return { success: false, txId: '', balances: {} };
    }
  }

  // === Instruction Builders ===
  // These construct the program instructions matching the expected Anchor IDL.
  // Instruction data layout:
  //   [8 bytes discriminator][32 bytes game_id][8 bytes amount]

  private buildDebitInstruction(
    player: PublicKey,
    chipsPda: PublicKey,
    gameId: Buffer,
    amount: number,
  ): TransactionInstruction {
    const discriminator = Buffer.from(this.discriminators.debit);
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(Math.floor(amount * (10 ** this.decimals))));

    const data = Buffer.concat([discriminator, gameId, amountBuf]);

    const keys = [
      { pubkey: player, isSigner: true, isWritable: true },
      { pubkey: chipsPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    if (this.tokenMint) {
      keys.push(
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: this.tokenMint, isSigner: false, isWritable: false },
      );
    }

    return new TransactionInstruction({
      programId: this.programId,
      keys,
      data,
    });
  }

  private buildCreditInstruction(
    player: PublicKey,
    chipsPda: PublicKey,
    gameId: Buffer,
    amount: number,
  ): TransactionInstruction {
    const discriminator = Buffer.from(this.discriminators.credit);
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(Math.floor(amount * (10 ** this.decimals))));

    const data = Buffer.concat([discriminator, gameId, amountBuf]);

    const keys = [
      { pubkey: this.dealerKeypair!.publicKey, isSigner: true, isWritable: true },
      { pubkey: chipsPda, isSigner: false, isWritable: true },
      { pubkey: player, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    if (this.tokenMint) {
      keys.push(
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: this.tokenMint, isSigner: false, isWritable: false },
      );
    }

    return new TransactionInstruction({
      programId: this.programId,
      keys,
      data,
    });
  }

  private buildBatchSettleInstruction(
    gameId: Buffer,
    players: PublicKey[],
    amounts: number[],
  ): TransactionInstruction {
    const discriminator = Buffer.from(this.discriminators.batchSettle);

    const playerCountBuf = Buffer.alloc(4);
    playerCountBuf.writeUInt32LE(players.length);

    const amountsBuf = Buffer.alloc(8 * amounts.length);
    amounts.forEach((a, i) => {
      amountsBuf.writeBigInt64LE(BigInt(Math.floor(a * (10 ** this.decimals))), i * 8);
    });

    const data = Buffer.concat([discriminator, gameId, playerCountBuf, amountsBuf]);

    const keys = [
      { pubkey: this.dealerKeypair!.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    // Add PDAs and player accounts
    for (const player of players) {
      const [chipsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('chips'), gameId, player.toBuffer()],
        this.programId,
      );
      keys.push(
        { pubkey: chipsPda, isSigner: false, isWritable: true },
        { pubkey: player, isSigner: false, isWritable: true },
      );
    }

    if (this.tokenMint) {
      keys.push(
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: this.tokenMint, isSigner: false, isWritable: false },
      );
    }

    return new TransactionInstruction({
      programId: this.programId,
      keys,
      data,
    });
  }
}
