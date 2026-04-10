import { randomBytes } from 'node:crypto';
import type {
  ChipProvider, BalanceResponse,
  DebitRequest, DebitResponse,
  CreditRequest, CreditResponse,
  BatchSettleRequest, BatchSettleResponse,
} from '../types/index.js';

/**
 * In-memory chip provider — Method B (real-time debit/credit).
 * Chips are deducted when you bet, credited when you win.
 */
export class LocalChipProvider implements ChipProvider {
  private balances = new Map<string, number>();

  fund(playerId: string, amount: number): void {
    this.balances.set(playerId, (this.balances.get(playerId) ?? 0) + amount);
  }

  async getBalance(playerId: string): Promise<BalanceResponse> {
    return { playerId, balance: this.balances.get(playerId) ?? 0 };
  }

  async debit(request: DebitRequest): Promise<DebitResponse> {
    const current = this.balances.get(request.playerId) ?? 0;
    if (current < request.amount) {
      return { success: false, reason: 'insufficient_balance', balance: current, txId: '' };
    }
    const newBalance = current - request.amount;
    this.balances.set(request.playerId, newBalance);
    return { success: true, balance: newBalance, txId: randomBytes(8).toString('hex') };
  }

  async credit(request: CreditRequest): Promise<CreditResponse> {
    const current = this.balances.get(request.playerId) ?? 0;
    const newBalance = current + request.amount;
    this.balances.set(request.playerId, newBalance);
    return { success: true, balance: newBalance, txId: randomBytes(8).toString('hex') };
  }

  async batchSettle(request: BatchSettleRequest): Promise<BatchSettleResponse> {
    for (const s of request.settlements) {
      const current = this.balances.get(s.playerId) ?? 0;
      this.balances.set(s.playerId, current + s.amount);
    }
    const balances: Record<string, number> = {};
    for (const s of request.settlements) {
      balances[s.playerId] = this.balances.get(s.playerId) ?? 0;
    }
    return { success: true, txId: randomBytes(8).toString('hex'), balances };
  }

  getAllBalances(): Record<string, number> {
    return Object.fromEntries(this.balances);
  }
}
