import { describe, it, expect } from 'vitest';
import { validateRoomUrl } from '../../transport/url-validator.js';

describe('URL Validator', () => {
  // === Valid URLs ===
  it('accepts local WebSocket URL', () => {
    const result = validateRoomUrl('ws://127.0.0.1:8080');
    expect(result.valid).toBe(true);
    expect(result.type).toBe('local');
  });

  it('accepts localhost URL', () => {
    const result = validateRoomUrl('ws://localhost:3000');
    expect(result.valid).toBe(true);
    expect(result.type).toBe('local');
  });

  it('accepts Cloudflare Quick Tunnel URL', () => {
    const result = validateRoomUrl('wss://my-game-abc123.trycloudflare.com');
    expect(result.valid).toBe(true);
    expect(result.type).toBe('cloudflare');
  });

  it('accepts custom wss:// domain', () => {
    const result = validateRoomUrl('wss://game.example.com');
    expect(result.valid).toBe(true);
    expect(result.type).toBe('custom');
  });

  // === Rejected URLs ===
  it('rejects empty URL', () => {
    expect(validateRoomUrl('').valid).toBe(false);
  });

  it('rejects http:// URL', () => {
    expect(validateRoomUrl('http://example.com').valid).toBe(false);
  });

  it('rejects https:// URL', () => {
    expect(validateRoomUrl('https://example.com').valid).toBe(false);
  });

  it('rejects javascript: injection', () => {
    expect(validateRoomUrl('ws://javascript:alert(1)').valid).toBe(false);
  });

  it('rejects URL with credentials', () => {
    expect(validateRoomUrl('ws://admin:pass@127.0.0.1:8080').valid).toBe(false);
  });

  it('rejects internal network 10.x', () => {
    expect(validateRoomUrl('ws://10.0.0.1:8080').valid).toBe(false);
  });

  it('rejects internal network 192.168.x', () => {
    expect(validateRoomUrl('ws://192.168.1.1:8080').valid).toBe(false);
  });

  it('rejects cloud metadata endpoint', () => {
    expect(validateRoomUrl('ws://169.254.169.254:8080').valid).toBe(false);
  });

  it('rejects unencrypted ws:// to remote host', () => {
    const result = validateRoomUrl('ws://game.example.com:8080');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('wss://');
  });
});
