import nacl from 'tweetnacl';
import tnaclUtil from 'tweetnacl-util';
const { encodeBase64, decodeBase64 } = tnaclUtil;

function canonicalize(data: unknown): string {
  if (data === null || data === undefined || typeof data !== 'object') {
    return JSON.stringify(data);
  }
  if (Array.isArray(data)) {
    return '[' + data.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(data as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize((data as Record<string, unknown>)[k])).join(',') + '}';
}

export function signData(data: unknown, secretKey: Uint8Array): string {
  const message = new TextEncoder().encode(canonicalize(data));
  const signature = nacl.sign.detached(message, secretKey);
  return encodeBase64(signature);
}

/**
 * P4-18: Sign data with embedded timestamp for expiration support.
 * Returns { signature, timestamp } so verifier can check freshness.
 */
export function signDataWithTimestamp(data: unknown, secretKey: Uint8Array): { signature: string; timestamp: number } {
  const timestamp = Date.now();
  const dataWithTs = { _payload: data, _ts: timestamp };
  const message = new TextEncoder().encode(canonicalize(dataWithTs));
  const signature = nacl.sign.detached(message, secretKey);
  return { signature: encodeBase64(signature), timestamp };
}

export function verifySignature(data: unknown, signatureBase64: string, publicKey: Uint8Array): boolean {
  const message = new TextEncoder().encode(canonicalize(data));
  const signature = decodeBase64(signatureBase64);
  return nacl.sign.detached.verify(message, signature, publicKey);
}

/**
 * P4-18: Verify a timestamped signature, optionally reject if too old.
 */
export function verifySignatureWithTimestamp(
  data: unknown,
  signatureBase64: string,
  publicKey: Uint8Array,
  timestamp: number,
  maxAgeMs?: number,
): boolean {
  if (maxAgeMs !== undefined && Date.now() - timestamp > maxAgeMs) {
    return false; // signature expired
  }
  const dataWithTs = { _payload: data, _ts: timestamp };
  const message = new TextEncoder().encode(canonicalize(dataWithTs));
  const signature = decodeBase64(signatureBase64);
  return nacl.sign.detached.verify(message, signature, publicKey);
}
