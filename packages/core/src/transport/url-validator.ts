/**
 * URL validation for game room connections.
 * Prevents players from connecting to malicious URLs.
 */

// Allowed URL patterns
const ALLOWED_PATTERNS = [
  // Local development
  /^ws:\/\/127\.0\.0\.1:\d+$/,
  /^ws:\/\/localhost:\d+$/,

  // Cloudflare Quick Tunnel
  /^wss:\/\/[a-z0-9-]+\.trycloudflare\.com$/,

  // Cloudflare Named Tunnel (custom domains)
  /^wss:\/\/[a-z0-9-]+\.[a-z0-9-]+\.[a-z]+$/,
];

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  type: 'local' | 'cloudflare' | 'custom' | 'unknown';
}

/**
 * Validate a room URL before connecting.
 * Rejects dangerous URLs that could be phishing or SSRF attacks.
 */
export function validateRoomUrl(url: string): UrlValidationResult {
  // Basic format check
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'URL is empty', type: 'unknown' };
  }

  // Must start with ws:// or wss://
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    return { valid: false, reason: 'URL must use ws:// or wss:// protocol', type: 'unknown' };
  }

  // Block dangerous schemes disguised as websocket URLs
  const lower = url.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('data:') || lower.includes('<script')) {
    return { valid: false, reason: 'URL contains dangerous content', type: 'unknown' };
  }

  // Block URLs with authentication credentials (ws://user:pass@host)
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      return { valid: false, reason: 'URL must not contain credentials', type: 'unknown' };
    }
    // Block URLs targeting internal networks
    const hostname = parsed.hostname;
    if (isInternalHost(hostname) && hostname !== '127.0.0.1' && hostname !== 'localhost') {
      return { valid: false, reason: 'URL targets a private/internal network', type: 'unknown' };
    }
  } catch {
    return { valid: false, reason: 'URL is malformed', type: 'unknown' };
  }

  // Check local
  if (/^ws:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
    return { valid: true, type: 'local' };
  }

  // Check Cloudflare Quick Tunnel
  if (/^wss:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url)) {
    return { valid: true, type: 'cloudflare' };
  }

  // For custom URLs (e.g., named tunnels, custom domains), require wss://
  if (url.startsWith('wss://')) {
    return { valid: true, type: 'custom' };
  }

  // ws:// to non-local targets — insecure, reject
  return { valid: false, reason: 'Non-local connections must use wss:// (TLS)', type: 'unknown' };
}

/**
 * Check if a hostname belongs to a private/internal network.
 */
function isInternalHost(hostname: string): boolean {
  // IPv4 private ranges (RFC 1918)
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  // Link-local (RFC 3927)
  if (/^169\.254\./.test(hostname)) return true;
  // P4-20: Full loopback range 127.0.0.0/8 (except 127.0.0.1 which is allowed for local dev)
  if (/^127\./.test(hostname) && hostname !== '127.0.0.1') return true;
  // IPv6 private — loopback, link-local, unique local (fc00::/7 = fc00:: and fd00::)
  if (hostname === '::1') return true;
  if (/^fe[89ab][0-9a-f]:/i.test(hostname)) return true;  // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(hostname)) return true;  // fc00::/7 unique local
  // Metadata endpoints (cloud SSRF targets)
  if (hostname === '169.254.169.254') return true;
  if (hostname === 'metadata.google.internal') return true;
  // AWS IMDSv2
  if (hostname === '169.254.169.123') return true;
  // Azure metadata
  if (hostname === '169.254.169.254') return true;

  return false;
}
