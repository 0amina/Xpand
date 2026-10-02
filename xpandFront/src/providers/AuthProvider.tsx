import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { api, setCredential } from '@/lib/api';
import { readString, remove, writeString } from '@/lib/storage';
import { getInitData, initTelegram, isTelegram } from '@/lib/telegram';
import type { LoginInput, User } from '@/types/api';

import { AuthContext, type AuthState, type AuthStatus } from './authContext';

const DEV_ID_KEY = 'dev-telegram-id';
const DEV_NAME_KEY = 'dev-first-name';

/**
 * Establishes who the user is, then hands the rest of the app a settled identity.
 *
 * Two paths, matching the backend's two accepted credentials:
 *
 * **Inside Telegram** — take the signed `initData` string, register it with the API client,
 * and fetch `/api/users/me`. That single call both proves the identity (the backend verifies
 * the HMAC against the bot token) and creates the user row on first contact, so there is no
 * separate login step. `initDataUnsafe` is never used for identity — only Telegram's signature
 * makes the claim trustworthy.
 *
 * **In a browser tab** — there is no initData, so fall back to `VITE_DEV_TELEGRAM_ID`, then a
 * previously entered id, then the dev sign-in screen. That path posts to `/api/users/login`
 * first, because the backend deliberately refuses to auto-create a user from an unsigned
 * `x-telegram-id` header. The header is rejected outright when the backend runs in production.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // React StrictMode mounts effects twice in development. Both paths are idempotent, so a
  // double run is harmless, but this keeps the console and network tab honest.
  const inFlight = useRef(false);

  useEffect(() => initTelegram(), []);

  /** Dev path: upsert via /login, then authenticate with the bare id header. */
  const loginWithDevId = useCallback(async (input: LoginInput) => {
    const signedIn = await api.post<User>('/api/users/login', input, { skipAuth: true });
    setCredential({ kind: 'devId', telegramId: signedIn.id });
    setUser(signedIn);
    setStatus('ready');
  }, []);

  useEffect(() => {
    if (inFlight.current) return;
    inFlight.current = true;

    const run = async () => {
      setStatus('loading');
      setError(null);

      try {
        const initData = getInitData();

        if (initData) {
          // Register before the first request so `me` carries the credential.
          setCredential({ kind: 'initData', initData });
          const me = await api.get<User>('/api/users/me');
          setUser(me);
          setStatus('ready');
          return;
        }

        if (isTelegram) {
          // Inside Telegram but initData is empty. Happens when the Mini App is opened in a
          // context Telegram does not sign (some channel/inline entry points), and there is
          // nothing to fall back to — the dev header would be rejected in production anyway.
          throw new Error(
            'Telegram did not provide sign-in data. Open Xpand from the bot chat or the menu button.',
          );
        }

        // --- Outside Telegram: development fallbacks ---
        const envId = import.meta.env.VITE_DEV_TELEGRAM_ID?.trim();
        const envName = import.meta.env.VITE_DEV_FIRST_NAME?.trim() || 'Dev';
        const storedId = readString(DEV_ID_KEY);
        const storedName = readString(DEV_NAME_KEY);

        const devId = envId || storedId;
        if (devId) {
          await loginWithDevId({ id: devId, firstName: storedName || envName });
          return;
        }

        setStatus('needs-dev-signin');
      } catch (err) {
        setError(err);
        setStatus('error');
      } finally {
        inFlight.current = false;
      }
    };

    void run();
  }, [loginWithDevId, attempt]);

  const signInAs = useCallback(
    async (id: string, firstName: string) => {
      // Persist so a reload doesn't send the developer back to this screen.
      writeString(DEV_ID_KEY, id);
      writeString(DEV_NAME_KEY, firstName);
      try {
        await loginWithDevId({ id, firstName });
      } catch (err) {
        setError(err);
        setStatus('error');
        throw err;
      }
    },
    [loginWithDevId],
  );

  const signOut = useCallback(() => {
    remove(DEV_ID_KEY);
    remove(DEV_NAME_KEY);
    setCredential(null);
    setUser(null);
    setStatus('needs-dev-signin');
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      error,
      isTelegram,
      signInAs,
      signOut,
      retry,
    }),
    [status, user, error, signInAs, signOut, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
