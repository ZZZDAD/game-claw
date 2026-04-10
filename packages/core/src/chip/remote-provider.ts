import type {
  ChipProvider, BalanceResponse,
  DebitRequest, DebitResponse,
  CreditRequest, CreditResponse,
  BatchSettleRequest, BatchSettleResponse,
} from '../types/index.js';

/**
 * HTTP-based chip provider — Method B (real-time debit/credit).
 *
 * Endpoints:
 *   GET  {baseUrl}/balance/{playerId}
 *   POST {baseUrl}/debit
 *   POST {baseUrl}/credit
 *   POST {baseUrl}/settle
 */
export class RemoteChipProvider implements ChipProvider {
  private authToken?: string;

  constructor(private baseUrl: string, authToken?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authToken = authToken;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  async getBalance(playerId: string): Promise<BalanceResponse> {
    const res = await fetch(`${this.baseUrl}/balance/${playerId}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(`ChipProvider: getBalance failed (${res.status})`);
    return res.json() as Promise<BalanceResponse>;
  }

  async debit(request: DebitRequest): Promise<DebitResponse> {
    const res = await fetch(`${this.baseUrl}/debit`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`ChipProvider: debit failed (${res.status})`);
    return res.json() as Promise<DebitResponse>;
  }

  async credit(request: CreditRequest): Promise<CreditResponse> {
    const res = await fetch(`${this.baseUrl}/credit`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`ChipProvider: credit failed (${res.status})`);
    return res.json() as Promise<CreditResponse>;
  }

  async batchSettle(request: BatchSettleRequest): Promise<BatchSettleResponse> {
    const res = await fetch(`${this.baseUrl}/settle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`ChipProvider: settle failed (${res.status})`);
    return res.json() as Promise<BatchSettleResponse>;
  }
}
