import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { signData, verifySignature } from '../../crypto/sign.js';

describe('sign', () => {
  it('signs and verifies data', () => {
    const kp = nacl.sign.keyPair();
    const data = { type: 'deal', card: 'hearts-A' };
    const sig = signData(data, kp.secretKey);
    expect(verifySignature(data, sig, kp.publicKey)).toBe(true);
  });

  it('rejects tampered data', () => {
    const kp = nacl.sign.keyPair();
    const data = { type: 'deal', card: 'hearts-A' };
    const sig = signData(data, kp.secretKey);
    const tampered = { type: 'deal', card: 'hearts-K' };
    expect(verifySignature(tampered, sig, kp.publicKey)).toBe(false);
  });

  it('produces consistent signature regardless of key order', () => {
    const kp = nacl.sign.keyPair();
    const data1 = { b: 2, a: 1 };
    const data2 = { a: 1, b: 2 };
    const sig = signData(data1, kp.secretKey);
    expect(verifySignature(data2, sig, kp.publicKey)).toBe(true);
  });
});
