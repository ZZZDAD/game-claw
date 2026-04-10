import { describe, it, expect } from 'vitest';
import { generateIdentity, identityToPlayerInfo, serializeIdentity, deserializeIdentity } from '../../crypto/keys.js';

describe('keys', () => {
  it('generates valid identity with sign and encrypt keypairs', () => {
    const identity = generateIdentity();
    expect(identity.signKeyPair.publicKey).toHaveLength(32);
    expect(identity.signKeyPair.secretKey).toHaveLength(64);
    expect(identity.encryptKeyPair.publicKey).toHaveLength(32);
    expect(identity.encryptKeyPair.secretKey).toHaveLength(32);
  });

  it('derives consistent playerInfo from identity', () => {
    const identity = generateIdentity();
    const info = identityToPlayerInfo(identity);
    expect(info.id).toHaveLength(64); // 32 bytes hex
    expect(info.signPubKey).toEqual(identity.signKeyPair.publicKey);
    expect(info.encryptPubKey).toEqual(identity.encryptKeyPair.publicKey);
  });

  it('round-trips identity through serialize/deserialize', () => {
    const identity = generateIdentity();
    const json = serializeIdentity(identity);
    const restored = deserializeIdentity(json);
    expect(restored.signKeyPair.publicKey).toEqual(identity.signKeyPair.publicKey);
    expect(restored.signKeyPair.secretKey).toEqual(identity.signKeyPair.secretKey);
    expect(restored.encryptKeyPair.publicKey).toEqual(identity.encryptKeyPair.publicKey);
    expect(restored.encryptKeyPair.secretKey).toEqual(identity.encryptKeyPair.secretKey);
  });
});
