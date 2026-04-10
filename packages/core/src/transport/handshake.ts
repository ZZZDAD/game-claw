/**
 * Handshake Protocol for game room connections.
 *
 * Sequence:
 *
 *   Player → Dealer:  HELLO  { playerPubKey, npmVersion, timestamp }
 *                             + signature (proves player owns the private key)
 *
 *   Dealer → Player:  CHALLENGE  { challenge: random 32 bytes, dealerPubKey, roomConfig }
 *                                + signature (proves dealer owns the private key)
 *
 *   Player → Dealer:  RESPONSE  { challengeAnswer: sign(challenge, playerPrivKey) }
 *
 *   Dealer → Player:  ACCEPTED / REJECTED  { reason? }
 *
 * What this prevents:
 *   - Impersonation: player must prove they own the private key
 *   - Replay attack: challenge is random per connection
 *   - MITM: both parties verify signatures with known public keys
 *   - Stale connections: timestamp checked within 60s window
 */

import nacl from 'tweetnacl';
import tnaclUtil from 'tweetnacl-util';
const { encodeBase64, decodeBase64 } = tnaclUtil;
import { signData, verifySignature } from '../crypto/sign.js';
import type { Identity, PlayerInfo, Connection, GameEvent, RoomConfig } from '../types/index.js';

const TIMESTAMP_WINDOW_MS = 15_000; // P3-12: reject messages older than 15s (reduced from 60s)

export interface HandshakeResult {
  success: boolean;
  reason?: string;
  playerInfo?: PlayerInfo;
  roomConfig?: RoomConfig;
  dealerPubKey?: Uint8Array;
}

// === Dealer side ===

/**
 * Handle the handshake from the dealer's perspective.
 * Called when a new connection arrives.
 */
export function handleHandshakeAsDealer(
  conn: Connection,
  dealerIdentity: Identity,
  npmVersion: string,
  roomConfig: RoomConfig,
): Promise<HandshakeResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, reason: 'Handshake timeout' });
    }, 10_000);

    conn.onMessage((event: GameEvent) => {
      if (event.type === 'handshake-hello') {
        handleHello(event);
      } else if (event.type === 'handshake-response') {
        handleResponse(event);
      }
    });

    let expectedChallenge: string;
    let pendingPlayerInfo: PlayerInfo;

    function handleHello(event: GameEvent) {
      const payload = event.payload as {
        playerInfo: PlayerInfo;
        npmVersion: string;
        timestamp: number;
        signature: string;
      };

      // Reconstruct Uint8Arrays from JSON transport
      const pi: PlayerInfo = {
        id: payload.playerInfo.id,
        signPubKey: new Uint8Array(Object.values(payload.playerInfo.signPubKey as unknown as Record<string, number>)),
        encryptPubKey: new Uint8Array(Object.values(payload.playerInfo.encryptPubKey as unknown as Record<string, number>)),
      };

      // 1. Check timestamp freshness (prevent replay)
      const now = Date.now();
      if (Math.abs(now - payload.timestamp) > TIMESTAMP_WINDOW_MS) {
        clearTimeout(timeout);
        conn.send({ type: 'handshake-rejected', payload: { reason: 'Stale timestamp' }, from: 'dealer' });
        resolve({ success: false, reason: 'Stale timestamp' });
        return;
      }

      // 2. Verify the HELLO signature (proves player owns private key)
      const helloData = { playerInfo: payload.playerInfo, npmVersion: payload.npmVersion, timestamp: payload.timestamp };
      if (!verifySignature(helloData, payload.signature, pi.signPubKey)) {
        clearTimeout(timeout);
        conn.send({ type: 'handshake-rejected', payload: { reason: 'Invalid signature' }, from: 'dealer' });
        resolve({ success: false, reason: 'Invalid signature' });
        return;
      }

      // 3. Check version
      if (payload.npmVersion !== npmVersion) {
        clearTimeout(timeout);
        conn.send({ type: 'handshake-rejected', payload: { reason: `Version mismatch: need ${npmVersion}` }, from: 'dealer' });
        resolve({ success: false, reason: 'Version mismatch' });
        return;
      }

      pendingPlayerInfo = pi;

      // 4. Send challenge
      const challenge = encodeBase64(nacl.randomBytes(32));
      expectedChallenge = challenge;
      const challengePayload = {
        challenge,
        dealerPubKey: Array.from(dealerIdentity.signKeyPair.publicKey),
        roomConfig,
      };
      const dealerSig = signData(challengePayload, dealerIdentity.signKeyPair.secretKey);

      conn.send({
        type: 'handshake-challenge',
        payload: { ...challengePayload, signature: dealerSig },
        from: 'dealer',
      });
    }

    function handleResponse(event: GameEvent) {
      const payload = event.payload as { challengeAnswer: string };

      // Verify the player signed our challenge
      const answerData = { challenge: expectedChallenge };
      if (!verifySignature(answerData, payload.challengeAnswer, pendingPlayerInfo.signPubKey)) {
        clearTimeout(timeout);
        conn.send({ type: 'handshake-rejected', payload: { reason: 'Challenge verification failed' }, from: 'dealer' });
        resolve({ success: false, reason: 'Challenge verification failed' });
        return;
      }

      // Handshake successful
      clearTimeout(timeout);
      conn.send({ type: 'handshake-accepted', payload: { roomConfig }, from: 'dealer' });
      resolve({ success: true, playerInfo: pendingPlayerInfo, roomConfig });
    }
  });
}

// === Player side ===

/**
 * Perform the handshake from the player's perspective.
 * Called after connecting to the dealer's URL.
 */
export function performHandshakeAsPlayer(
  conn: Connection,
  playerIdentity: Identity,
  npmVersion: string,
): Promise<HandshakeResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, reason: 'Handshake timeout' });
    }, 10_000);

    const playerInfo = {
      id: Buffer.from(playerIdentity.signKeyPair.publicKey).toString('hex'),
      signPubKey: playerIdentity.signKeyPair.publicKey,
      encryptPubKey: playerIdentity.encryptKeyPair.publicKey,
    };

    // Step 1: Send HELLO
    const timestamp = Date.now();
    const helloData = { playerInfo, npmVersion, timestamp };
    const signature = signData(helloData, playerIdentity.signKeyPair.secretKey);

    conn.send({
      type: 'handshake-hello',
      payload: { ...helloData, signature },
      from: playerInfo.id,
    });

    conn.onMessage((event: GameEvent) => {
      if (event.type === 'handshake-challenge') {
        handleChallenge(event);
      } else if (event.type === 'handshake-accepted') {
        clearTimeout(timeout);
        const payload = event.payload as { roomConfig: RoomConfig };
        resolve({ success: true, roomConfig: payload.roomConfig, playerInfo });
      } else if (event.type === 'handshake-rejected') {
        clearTimeout(timeout);
        const payload = event.payload as { reason: string };
        resolve({ success: false, reason: payload.reason });
      }
    });

    function handleChallenge(event: GameEvent) {
      const payload = event.payload as {
        challenge: string;
        dealerPubKey: number[];
        roomConfig: RoomConfig;
        signature: string;
      };

      const dealerPubKey = new Uint8Array(payload.dealerPubKey);

      // Verify dealer's signature on the challenge (proves dealer is who they say)
      const challengeData = {
        challenge: payload.challenge,
        dealerPubKey: payload.dealerPubKey,
        roomConfig: payload.roomConfig,
      };
      if (!verifySignature(challengeData, payload.signature, dealerPubKey)) {
        clearTimeout(timeout);
        resolve({ success: false, reason: 'Dealer signature invalid' });
        return;
      }

      // Sign the challenge to prove we own the private key
      const answerData = { challenge: payload.challenge };
      const challengeAnswer = signData(answerData, playerIdentity.signKeyPair.secretKey);

      conn.send({
        type: 'handshake-response',
        payload: { challengeAnswer },
        from: playerInfo.id,
      });
    }
  });
}
