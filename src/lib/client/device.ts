'use client';

/**
 * A stable id for this browser, used as one scope of the daily token budget.
 *
 * Deliberately not a fingerprint: it is a random value this browser generates
 * and keeps, so it identifies nothing about the person and they can clear it.
 * It exists so one user cannot multiply their allowance simply by signing in
 * under a different name.
 */
const KEY = 'kanoon:device';

let cached: string | null = null;

export function deviceId(): string {
  if (cached) return cached;
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9-]/g, '');
      localStorage.setItem(KEY, id);
    }
    cached = id;
    return id;
  } catch {
    // Private mode: fall back to a per-session id rather than failing the call.
    cached = `session-${Math.random().toString(36).slice(2, 12)}`;
    return cached;
  }
}

/** Standard headers for every authenticated call from the browser. */
export function authHeaders(user: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-kanoon-user': user,
    'x-kanoon-device': deviceId(),
  };
}
