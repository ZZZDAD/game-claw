import { describe, it, expect, afterEach } from 'vitest';
import { DealerNode, PlayerNode, generateIdentity } from '@game-claw/core';
import type { RoomConfig, Card } from '@game-claw/core';
import { BlackjackPlugin, handValue, isNatural21 } from '../plugin.js';

const c = (id: string): Card => {
  const [suit, rank] = id.split('-');
  return { id, suit, rank };
};

describe('Blackjack full simulation', () => {
  let dealer: DealerNode;
  let players: PlayerNode[];

  afterEach(async () => {
    for (const p of players || []) await p.disconnect();
    if (dealer) await dealer.stop();
  });

  it('runs 5 full games: banker(real player) + 2 players', async () => {
    const plugin = new BlackjackPlugin();
    const roomConfig: RoomConfig = {
      gameType: 'blackjack',
      chipProvider: { type: 'local' },
      chipUnit: 'pts',
      minBet: 10,
      maxBet: 100,
      buyIn: 500,
      commission: 2,
      settings: { bankerIndex: 0 }, // first player is banker
    };

    for (let game = 0; game < 5; game++) {
      const dealerIdentity = generateIdentity();
      dealer = new DealerNode(plugin, dealerIdentity, '0.1.0', roomConfig);
      const url = await dealer.createRoom(0);

      // 3 players: [0]=banker, [1]=player, [2]=player
      const botIdentities = Array.from({ length: 3 }, () => generateIdentity());
      players = botIdentities.map((id) => new PlayerNode(id, '0.1.0'));

      for (const p of players) {
        const result = await p.join(url);
        expect(result.accepted).toBe(true);
      }

      await dealer.startGame();
      await new Promise((r) => setTimeout(r, 300));

      const engine = dealer.getEngine();
      let state = engine.getState();
      const bankerId = state.roundData.bankerId as string;

      // Verify: banker is player[0]
      expect(bankerId).toBe(players[0].getPlayerId());

      // === Betting phase ===
      // Normal players place bets
      while (state.phase === 'betting') {
        const actions = engine.getValidActions();
        if (actions.length === 0) break;
        const action = actions[0]; // min bet
        const pNode = players.find((p) => p.getPlayerId() === action.playerId);
        if (pNode) {
          await pNode.sendAction(action);
          await new Promise((r) => setTimeout(r, 50));
        }
        state = engine.getState();
      }

      // After betting + deal + postDeal, should be in 'playing' or 'insurance' phase
      expect(['playing', 'insurance', 'end']).toContain(state.phase);

      // If in insurance phase, decline for all and continue
      if (state.phase === 'insurance') {
        for (const pid of state.roundData.normalPlayerIds as string[]) {
          const pNode = players.find((p) => p.getPlayerId() === pid);
          if (pNode) {
            await pNode.sendAction({ playerId: pid, type: 'decline-insurance' });
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        state = engine.getState();
      }

      if (state.phase === 'end') {
        // Peek settled — game over early
        expect(engine.isOver()).toBe(true);
        for (const p of players) await p.disconnect();
        await dealer.stop();
        continue;
      }

      // All players should have 2 cards
      for (const p of players) {
        expect(p.getHand()).toHaveLength(2);
      }

      // === Player phase ===
      let rounds = 0;
      while (state.phase === 'playing' && rounds < 20) {
        const actions = engine.getValidActions();
        if (actions.length === 0) break;

        const playerId = actions[0].playerId;
        const hand = state.hands[playerId] ?? [];
        const val = handValue(hand);

        let action;
        if (val < 17) {
          action = actions.find((a) => a.type === 'hit');
          if (action) engine.dealCardToPlayer(playerId);
        }
        if (!action) {
          action = actions.find((a) => a.type === 'stand')!;
        }

        const pNode = players.find((p) => p.getPlayerId() === action.playerId);
        if (pNode) {
          await pNode.sendAction(action);
          await new Promise((r) => setTimeout(r, 50));
        }
        state = engine.getState();
        rounds++;
      }

      // === Banker phase ===
      expect(state.phase).toBe('banker-turn');

      rounds = 0;
      while (state.phase === 'banker-turn' && rounds < 10) {
        const actions = engine.getValidActions();
        if (actions.length === 0) break;

        const action = actions[0]; // forced action (hit if <17, stand if >=17)
        if (action.type === 'hit') {
          engine.dealCardToPlayer(bankerId);
        }

        const bankerNode = players.find((p) => p.getPlayerId() === bankerId);
        if (bankerNode) {
          await bankerNode.sendAction(action);
          await new Promise((r) => setTimeout(r, 50));
        }
        state = engine.getState();
        rounds++;
      }

      expect(state.phase).toBe('end');

      // === Verify crypto ===
      const reveals = engine.getAllReveals();
      const commitments = engine.getCommitments();
      for (const reveal of reveals) {
        const matching = commitments.find((c) => c.cardIndex === reveal.cardIndex);
        expect(matching).toBeDefined();
        expect(engine.verifyReveal(reveal, matching!.commitment)).toBe(true);
      }

      // Banker's cards should also have commitments
      const bankerCommitments = commitments.filter((c) => c.targetPlayerId === bankerId);
      expect(bankerCommitments.length).toBeGreaterThanOrEqual(2);

      // Result: money flows between banker and players
      const result = engine.getResult();
      expect(typeof result.commission).toBe('number');
      const bankerChange = result.pointChanges[bankerId];
      const playerChanges = (state.roundData.normalPlayerIds as string[])
        .map((pid) => result.pointChanges[pid])
        .reduce((a, b) => a + b, 0);
      // Zero-sum between banker and players (commission is tracked separately)
      expect(bankerChange + playerChanges).toBe(0);

      for (const p of players) await p.disconnect();
      await dealer.stop();
    }
  }, 60000);

  it('simulates double-down scenario with correct payout', () => {
    const plugin = new BlackjackPlugin();
    const identities = Array.from({ length: 2 }, () => generateIdentity());
    const playerInfos = identities.map((id) => ({
      id: Buffer.from(id.signKeyPair.publicKey).toString('hex'),
      signPubKey: id.signKeyPair.publicKey,
      encryptPubKey: id.encryptKeyPair.publicKey,
    }));

    let state = plugin.createGame(playerInfos);
    const bankerId = playerInfos[0].id;
    const p1 = playerInfos[1].id;

    // Betting
    state = plugin.applyAction(state, { playerId: p1, type: 'bet', payload: { amount: 50 } }).state;
    expect(state.phase).toBe('dealing');

    // Deal cards
    state.phase = 'playing';
    state.hands[p1] = [c('hearts-5'), c('spades-6')]; // 11
    state.hands[bankerId] = [c('diamonds-10'), c('clubs-7')]; // 17
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Double down - engine deals one card
    state.hands[p1].push(c('clubs-10')); // 21
    state = plugin.applyAction(state, { playerId: p1, type: 'double-down' }).state;
    expect(state.phase).toBe('banker-turn');

    // Banker stands at 17
    state = plugin.applyAction(state, { playerId: bankerId, type: 'stand' }).state;
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    // Doubled bet = 100, player 21 > banker 17
    expect(result.pointChanges[p1]).toBe(100);
    expect(result.pointChanges[bankerId]).toBe(-100);
    expect(result.winners).toContain(p1);
  });

  it('simulates surrender scenario', () => {
    const plugin = new BlackjackPlugin();
    const identities = Array.from({ length: 2 }, () => generateIdentity());
    const playerInfos = identities.map((id) => ({
      id: Buffer.from(id.signKeyPair.publicKey).toString('hex'),
      signPubKey: id.signKeyPair.publicKey,
      encryptPubKey: id.encryptKeyPair.publicKey,
    }));

    let state = plugin.createGame(playerInfos);
    const bankerId = playerInfos[0].id;
    const p1 = playerInfos[1].id;

    // Betting
    state = plugin.applyAction(state, { playerId: p1, type: 'bet', payload: { amount: 100 } }).state;
    state.phase = 'playing';
    state.hands[p1] = [c('hearts-10'), c('spades-6')]; // 16
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-9')]; // 19
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Surrender
    state = plugin.applyAction(state, { playerId: p1, type: 'surrender' }).state;
    expect(state.phase).toBe('banker-turn');

    state = plugin.applyAction(state, { playerId: bankerId, type: 'stand' }).state;
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    expect(result.pointChanges[p1]).toBe(-50); // half of 100
    expect(result.pointChanges[bankerId]).toBe(50);
  });

  it('simulates insurance scenario with banker natural', () => {
    const plugin = new BlackjackPlugin();
    const identities = Array.from({ length: 2 }, () => generateIdentity());
    const playerInfos = identities.map((id) => ({
      id: Buffer.from(id.signKeyPair.publicKey).toString('hex'),
      signPubKey: id.signKeyPair.publicKey,
      encryptPubKey: id.encryptKeyPair.publicKey,
    }));

    let state = plugin.createGame(playerInfos);
    const bankerId = playerInfos[0].id;
    const p1 = playerInfos[1].id;

    // Betting
    state = plugin.applyAction(state, { playerId: p1, type: 'bet', payload: { amount: 100 } }).state;
    state.phase = 'insurance';
    state.hands[p1] = [c('hearts-10'), c('spades-9')]; // 19
    state.hands[bankerId] = [c('diamonds-A'), c('clubs-K')]; // natural 21

    // Buy insurance at max (50)
    state = plugin.applyAction(state, { playerId: p1, type: 'insurance', payload: { amount: 50 } }).state;

    // Banker natural -> game ends
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    // Insurance pays 2:1: +100
    // Main bet lost (banker natural): -100
    // Net: 0
    expect(result.pointChanges[p1]).toBe(0);
    expect(result.pointChanges[bankerId]).toBe(0);
  });

  it('simulates split scenario with independent hand outcomes', () => {
    const plugin = new BlackjackPlugin();
    const identities = Array.from({ length: 2 }, () => generateIdentity());
    const playerInfos = identities.map((id) => ({
      id: Buffer.from(id.signKeyPair.publicKey).toString('hex'),
      signPubKey: id.signKeyPair.publicKey,
      encryptPubKey: id.encryptKeyPair.publicKey,
    }));

    let state = plugin.createGame(playerInfos);
    const bankerId = playerInfos[0].id;
    const p1 = playerInfos[1].id;

    // Betting
    state = plugin.applyAction(state, { playerId: p1, type: 'bet', payload: { amount: 50 } }).state;
    state.phase = 'playing';
    state.hands[p1] = [c('hearts-7'), c('spades-7')]; // pair of 7s
    state.hands[bankerId] = [c('diamonds-10'), c('clubs-7')]; // 17
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Split
    state = plugin.applyAction(state, {
      playerId: p1, type: 'split',
      payload: { splitCards: [c('clubs-10'), c('diamonds-10')] }
    }).state;

    // Hand 1: 7+10 = 17, stand
    state = plugin.applyAction(state, { playerId: p1, type: 'stand' }).state;

    // Hand 2: 7+10 = 17, stand
    state = plugin.applyAction(state, { playerId: p1, type: 'stand' }).state;

    expect(state.phase).toBe('banker-turn');

    // Banker at 17, stands
    state = plugin.applyAction(state, { playerId: bankerId, type: 'stand' }).state;
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    // Both hands push (17 vs 17): net 0
    expect(result.pointChanges[p1]).toBe(0);
    expect(result.pointChanges[bankerId]).toBe(0);
  });

  it('natural 21 simulation: pays 3:2', () => {
    const plugin = new BlackjackPlugin();
    const identities = Array.from({ length: 2 }, () => generateIdentity());
    const playerInfos = identities.map((id) => ({
      id: Buffer.from(id.signKeyPair.publicKey).toString('hex'),
      signPubKey: id.signKeyPair.publicKey,
      encryptPubKey: id.encryptKeyPair.publicKey,
    }));

    let state = plugin.createGame(playerInfos);
    const bankerId = playerInfos[0].id;
    const p1 = playerInfos[1].id;

    state = plugin.applyAction(state, { playerId: p1, type: 'bet', payload: { amount: 100 } }).state;
    state.phase = 'playing';
    state.hands[p1] = [c('hearts-A'), c('spades-K')]; // natural 21
    state.hands[bankerId] = [c('diamonds-10'), c('clubs-8')]; // 18
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Player stands with natural 21
    state = plugin.applyAction(state, { playerId: p1, type: 'stand' }).state;
    expect(state.phase).toBe('banker-turn');

    state = plugin.applyAction(state, { playerId: bankerId, type: 'stand' }).state;
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    // Natural 21 pays 3:2: 100 * 1.5 = 150
    expect(result.pointChanges[p1]).toBe(150);
    expect(result.pointChanges[bankerId]).toBe(-150);
    expect(result.winners).toContain(p1);

    // Verify zero-sum
    expect(result.pointChanges[p1] + result.pointChanges[bankerId]).toBe(0);
  });
});
