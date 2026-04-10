import { describe, it, expect } from 'vitest';
import { createCommitment, verifyCommitment, generateSalt } from '../../crypto/commitment.js';

describe('commitment', () => {
  it('creates and verifies a commitment', () => {
    const salt = generateSalt();
    const cardId = 'hearts-A';
    const commitment = createCommitment(cardId, salt);
    expect(commitment).toHaveLength(64); // SHA-256 hex
    expect(verifyCommitment(cardId, salt, commitment)).toBe(true);
  });

  it('rejects wrong cardId', () => {
    const salt = generateSalt();
    const commitment = createCommitment('hearts-A', salt);
    expect(verifyCommitment('hearts-K', salt, commitment)).toBe(false);
  });

  it('rejects wrong salt', () => {
    const salt = generateSalt();
    const commitment = createCommitment('hearts-A', salt);
    const wrongSalt = generateSalt();
    expect(verifyCommitment('hearts-A', wrongSalt, commitment)).toBe(false);
  });
});
