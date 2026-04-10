import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { encryptForPlayer, decryptFromDealer } from '../../crypto/encrypt.js';

describe('encrypt', () => {
  it('encrypts and decrypts card data for a player', () => {
    const dealerEncryptKP = nacl.box.keyPair();
    const playerEncryptKP = nacl.box.keyPair();

    const cardData = { cardId: 'hearts-A', salt: 'abcdef1234567890' };
    const { encrypted, nonce } = encryptForPlayer(
      cardData,
      playerEncryptKP.publicKey,
      dealerEncryptKP.secretKey
    );

    const decrypted = decryptFromDealer(
      encrypted,
      nonce,
      dealerEncryptKP.publicKey,
      playerEncryptKP.secretKey
    );

    expect(decrypted).toEqual(cardData);
  });

  it('fails to decrypt with wrong key', () => {
    const dealerEncryptKP = nacl.box.keyPair();
    const playerEncryptKP = nacl.box.keyPair();
    const wrongKP = nacl.box.keyPair();

    const cardData = { cardId: 'spades-K', salt: '1234' };
    const { encrypted, nonce } = encryptForPlayer(
      cardData,
      playerEncryptKP.publicKey,
      dealerEncryptKP.secretKey
    );

    expect(() =>
      decryptFromDealer(encrypted, nonce, dealerEncryptKP.publicKey, wrongKP.secretKey)
    ).toThrow('Decryption failed');
  });
});
