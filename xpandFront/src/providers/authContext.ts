import { createContext } from 'react';

import type { User } from '@/types/api';

export type AuthStatus =
  /** Booting: reading Telegram initData and performing the login upsert. */
  | 'loading'
  /** Signed in; `user` is populated. */
  | 'ready'
  /** Outside Telegram with no dev id configured — the dev sign-in screen is shown. */
  | 'needs-dev-signin'
  /** The login call failed; `error` explains why. */
  | 'error';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  error: unknown;
  /** True when a real Telegram client is hosting the app (not a browser tab). */
  isTelegram: boolean;
  /** Sign in manually with a Telegram id — the dev-only escape hatch. */
  signInAs: (id: string, firstName: string) => Promise<void>;
  /** Clear the stored dev identity and return to the sign-in screen. */
  signOut: () => void;
  retry: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);
