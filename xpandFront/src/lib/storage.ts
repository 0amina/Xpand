/**
 * Namespaced, failure-tolerant `localStorage`.
 *
 * Storage throws rather than returning null in several real situations — Safari private mode,
 * a full quota, an embedded webview with site data disabled. A Mini App must never white-screen
 * because a preference could not be cached, so every access is wrapped and degrades to a no-op.
 */

const PREFIX = 'xpand:';

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — the value is a convenience, so drop it silently.
  }
}

export function remove(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* no-op */
  }
}

export function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* no-op */
  }
}
