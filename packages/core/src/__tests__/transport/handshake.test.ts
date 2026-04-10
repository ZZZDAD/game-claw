import { describe, it, expect } from 'vitest';
import { handleHandshakeAsDealer, performHandshakeAsPlayer } from '../../transport/handshake.js';
import { generateIdentity, identityToPlayerInfo } from '../../crypto/keys.js';
import { signData } from '../../crypto/sign.js';
import type { GameEvent, Connection, RoomConfig } from '../../types/index.js';

// Create async connection pair — messages delivered via microtask to avoid sync ordering issues
function createConnectionPair(): { dealerConn: Connection; playerConn: Connection } {
  const dealerHandlers: ((event: GameEvent) => void)[] = [];
  const playerHandlers: ((event: GameEvent) => void)[] = [];

  const dealerConn: Connection = {
    send: (event) => { queueMicrotask(() => playerHandlers.forEach((h) => h(event))); },
    onMessage: (handler) => { dealerHandlers.push(handler); },
    onClose: () => {},
    close: () => {},
    isAlive: true,
  };

  const playerConn: Connection = {
    send: (event) => { queueMicrotask(() => dealerHandlers.forEach((h) => h(event))); },
    onMessage: (handler) => { playerHandlers.push(handler); },
    onClose: () => {},
    close: () => {},
    isAlive: true,
  };

  return { dealerConn, playerConn };
}

const roomConfig: RoomConfig = {
  gameType: 'test',
  chipProvider: { type: 'local' },
  chipUnit: 'pts',
  minBet: 10,
  maxBet: 100,
  buyIn: 500,
  commission: 2,
};

describe('Handshake Protocol', () => {
  it('completes full handshake successfully', async () => {
    const dealerIdentity = generateIdentity();
    const playerIdentity = generateIdentity();
    const { dealerConn, playerConn } = createConnectionPair();

    const [dealerResult, playerResult] = await Promise.all([
      handleHandshakeAsDealer(dealerConn, dealerIdentity, '0.1.0', roomConfig),
      performHandshakeAsPlayer(playerConn, playerIdentity, '0.1.0'),
    ]);

    expect(dealerResult.success).toBe(true);
    expect(dealerResult.playerInfo?.id).toBe(identityToPlayerInfo(playerIdentity).id);
    expect(playerResult.success).toBe(true);
    expect(playerResult.roomConfig).toEqual(roomConfig);
  }, 10000);

  it('rejects version mismatch', async () => {
    const dealerIdentity = generateIdentity();
    const playerIdentity = generateIdentity();
    const { dealerConn, playerConn } = createConnectionPair();

    const [dealerResult, playerResult] = await Promise.all([
      handleHandshakeAsDealer(dealerConn, dealerIdentity, '0.2.0', roomConfig),
      performHandshakeAsPlayer(playerConn, playerIdentity, '0.1.0'),
    ]);

    expect(dealerResult.success).toBe(false);
    expect(dealerResult.reason).toContain('Version mismatch');
    expect(playerResult.success).toBe(false);
  }, 10000);

  it('rejects forged HELLO signature', async () => {
    const dealerIdentity = generateIdentity();
    const playerIdentity = generateIdentity();
    const fakeIdentity = generateIdentity();
    const { dealerConn, playerConn } = createConnectionPair();

    // Start dealer-side handshake handler
    const dealerPromise = handleHandshakeAsDealer(dealerConn, dealerIdentity, '0.1.0', roomConfig);

    // Player sends HELLO with wrong signature
    const playerInfo = identityToPlayerInfo(playerIdentity);
    const timestamp = Date.now();
    const helloData = { playerInfo, npmVersion: '0.1.0', timestamp };
    const badSignature = signData(helloData, fakeIdentity.signKeyPair.secretKey);

    const playerPromise = new Promise<{ success: boolean; reason?: string }>((resolve) => {
      playerConn.onMessage((event: GameEvent) => {
        if (event.type === 'handshake-rejected') {
          resolve({ success: false, reason: (event.payload as any).reason });
        }
      });
    });

    // Send the forged hello after handlers are registered
    playerConn.send({
      type: 'handshake-hello',
      payload: { ...helloData, signature: badSignature },
      from: playerInfo.id,
    });

    const [dealerResult, playerResult] = await Promise.all([dealerPromise, playerPromise]);

    expect(dealerResult.success).toBe(false);
    expect(dealerResult.reason).toContain('Invalid signature');
    expect(playerResult.success).toBe(false);
  }, 10000);

  it('rejects stale timestamp (replay attack)', async () => {
    const dealerIdentity = generateIdentity();
    const playerIdentity = generateIdentity();
    const { dealerConn, playerConn } = createConnectionPair();

    const dealerPromise = handleHandshakeAsDealer(dealerConn, dealerIdentity, '0.1.0', roomConfig);

    const playerInfo = identityToPlayerInfo(playerIdentity);
    const oldTimestamp = Date.now() - 120_000; // 2 minutes ago
    const helloData = { playerInfo, npmVersion: '0.1.0', timestamp: oldTimestamp };
    const signature = signData(helloData, playerIdentity.signKeyPair.secretKey);

    const playerPromise = new Promise<{ success: boolean; reason?: string }>((resolve) => {
      playerConn.onMessage((event: GameEvent) => {
        if (event.type === 'handshake-rejected') {
          resolve({ success: false, reason: (event.payload as any).reason });
        }
      });
    });

    playerConn.send({
      type: 'handshake-hello',
      payload: { ...helloData, signature },
      from: playerInfo.id,
    });

    const [dealerResult] = await Promise.all([dealerPromise, playerPromise]);

    expect(dealerResult.success).toBe(false);
    expect(dealerResult.reason).toContain('Stale timestamp');
  }, 10000);
});
