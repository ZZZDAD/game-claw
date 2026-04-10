import { createHash, randomBytes } from 'node:crypto';

export function generateSalt(): string {
  return randomBytes(32).toString('hex');
}

export function createCommitment(cardId: string, salt: string): string {
  return createHash('sha256').update(cardId + '||' + salt).digest('hex');
}

export function verifyCommitment(cardId: string, salt: string, commitment: string): boolean {
  return createCommitment(cardId, salt) === commitment;
}
