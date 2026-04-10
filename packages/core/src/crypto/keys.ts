import nacl from 'tweetnacl';
import tnaclUtil from 'tweetnacl-util';
const { encodeBase64, decodeBase64 } = tnaclUtil;
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import type { Identity, PlayerInfo } from '../types/index.js';

export function generateIdentity(): Identity {
  const signKeyPair = nacl.sign.keyPair();
  const encryptKeyPair = nacl.box.keyPair();
  return { signKeyPair, encryptKeyPair };
}

export function identityToPlayerInfo(identity: Identity): PlayerInfo {
  const id = Buffer.from(identity.signKeyPair.publicKey).toString('hex');
  return {
    id,
    signPubKey: identity.signKeyPair.publicKey,
    encryptPubKey: identity.encryptKeyPair.publicKey,
  };
}

export function serializeIdentity(identity: Identity): string {
  return JSON.stringify({
    signPublicKey: encodeBase64(identity.signKeyPair.publicKey),
    signSecretKey: encodeBase64(identity.signKeyPair.secretKey),
    encryptPublicKey: encodeBase64(identity.encryptKeyPair.publicKey),
    encryptSecretKey: encodeBase64(identity.encryptKeyPair.secretKey),
  });
}

export function deserializeIdentity(json: string): Identity {
  const data = JSON.parse(json);
  return {
    signKeyPair: {
      publicKey: decodeBase64(data.signPublicKey),
      secretKey: decodeBase64(data.signSecretKey),
    },
    encryptKeyPair: {
      publicKey: decodeBase64(data.encryptPublicKey),
      secretKey: decodeBase64(data.encryptSecretKey),
    },
  };
}

/**
 * P4-19: Serialize identity with password protection.
 * Uses scrypt for key derivation + AES-256-GCM for encryption.
 */
export function serializeIdentityEncrypted(identity: Identity, password: string): string {
  const plaintext = serializeIdentity(identity);
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    encrypted: true,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

/**
 * P4-19: Deserialize a password-protected identity.
 */
export function deserializeIdentityEncrypted(json: string, password: string): Identity {
  const parsed = JSON.parse(json);
  if (!parsed.encrypted) {
    return deserializeIdentity(json);
  }
  const salt = Buffer.from(parsed.salt, 'hex');
  const iv = Buffer.from(parsed.iv, 'hex');
  const authTag = Buffer.from(parsed.authTag, 'hex');
  const data = Buffer.from(parsed.data, 'hex');
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return deserializeIdentity(decrypted.toString('utf8'));
}
