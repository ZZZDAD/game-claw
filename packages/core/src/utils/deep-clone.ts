/**
 * Deep clone that preserves Map and Uint8Array types.
 * Used by game plugins to clone GameState without losing type information.
 *
 * P4-17: Replacement for JSON.parse(JSON.stringify(state)) which
 * converts Map to {} and Uint8Array to plain objects.
 */
export function deepCloneState<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Uint8Array) {
    return new Uint8Array(obj) as unknown as T;
  }

  if (obj instanceof Map) {
    const cloned = new Map();
    for (const [key, value] of obj) {
      cloned.set(deepCloneState(key), deepCloneState(value));
    }
    return cloned as unknown as T;
  }

  if (obj instanceof Set) {
    const cloned = new Set();
    for (const value of obj) {
      cloned.add(deepCloneState(value));
    }
    return cloned as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepCloneState(item)) as unknown as T;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  // Plain object
  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    cloned[key] = deepCloneState((obj as Record<string, unknown>)[key]);
  }
  return cloned as T;
}
