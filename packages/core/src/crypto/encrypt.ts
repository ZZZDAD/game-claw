import nacl from 'tweetnacl';
import tnaclUtil from 'tweetnacl-util';
const { encodeBase64, decodeBase64 } = tnaclUtil;

export interface EncryptedPayload {
  encrypted: string; // base64
  nonce: string;     // base64
}

export function encryptForPlayer(
  data: { cardId: string; salt: string },
  playerEncryptPubKey: Uint8Array,
  dealerEncryptSecretKey: Uint8Array
): EncryptedPayload {
  const message = new TextEncoder().encode(JSON.stringify(data));
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(message, nonce, playerEncryptPubKey, dealerEncryptSecretKey);
  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

export function decryptFromDealer(
  encryptedBase64: string,
  nonceBase64: string,
  dealerEncryptPubKey: Uint8Array,
  playerEncryptSecretKey: Uint8Array
): { cardId: string; salt: string } {
  const encrypted = decodeBase64(encryptedBase64);
  const nonce = decodeBase64(nonceBase64);
  const decrypted = nacl.box.open(encrypted, nonce, dealerEncryptPubKey, playerEncryptSecretKey);
  if (!decrypted) {
    throw new Error('Decryption failed');
  }
  return JSON.parse(new TextDecoder().decode(decrypted));
}
