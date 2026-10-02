/**
 * A thin, defensive wrapper around Telegram's Mini App SDK (`window.Telegram.WebApp`).
 *
 * Everything here must work in three environments:
 *   1. Inside Telegram — the real SDK is present.
 *   2. In a plain browser tab (`npm run dev`) — the global is undefined.
 *   3. Inside an old Telegram client — the global exists but newer methods do not.
 *
 * So every call is guarded and every getter has a fallback. Nothing in the app should touch
 * `window.Telegram` directly; go through this module.
 */

// --- Minimal typings for the slice of the SDK we actually use ---

interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_separator_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramUser; auth_date?: number; hash?: string };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: TelegramThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  close: () => void;
  isVersionAtLeast: (version: string) => boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  enableClosingConfirmation?: () => void;
  disableVerticalSwipes?: () => void;
  onEvent: (event: string, handler: () => void) => void;
  offEvent: (event: string, handler: () => void) => void;
  showAlert?: (message: string, callback?: () => void) => void;
  showConfirm?: (message: string, callback?: (ok: boolean) => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  BackButton?: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  MainButton?: {
    text: string;
    isVisible: boolean;
    isActive: boolean;
    isProgressVisible: boolean;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    setText: (text: string) => void;
    setParams: (params: {
      text?: string;
      color?: string;
      text_color?: string;
      is_active?: boolean;
      is_visible?: boolean;
    }) => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** The raw SDK object, or `undefined` when running outside Telegram. */
export const webApp: TelegramWebApp | undefined = window.Telegram?.WebApp;

/**
 * True only when a real Telegram client is hosting us. `initData` is empty when the SDK
 * script is loaded in a normal browser tab, which is how we tell the two apart — the global
 * itself exists in both cases.
 */
export const isTelegram = Boolean(webApp && webApp.initData !== '');

/** The Telegram profile of the current user, if we are inside Telegram. */
export function getTelegramUser(): TelegramUser | undefined {
  return webApp?.initDataUnsafe?.user;
}

/**
 * The raw, signed `initData` string — the app's actual credential.
 *
 * Must be passed to the backend **byte for byte**: the HMAC covers the values exactly as
 * Telegram encoded them, so decoding, re-encoding or reordering it invalidates the signature.
 * Prefer this over `initDataUnsafe`, which is the same payload with the signature stripped and
 * is, as the name says, unverified — fine for painting a name on screen, never for identity.
 */
export function getInitData(): string | undefined {
  const raw = webApp?.initData;
  return raw && raw.length > 0 ? raw : undefined;
}

/**
 * Copy Telegram's theme palette onto `:root` as `--tg-*` custom properties.
 *
 * Telegram normally injects these itself, but only in recent clients — and never outside
 * Telegram. Setting them from `themeParams` makes the app's CSS work identically everywhere,
 * with `styles/tokens.css` supplying light/dark defaults for anything still missing.
 */
function applyThemeParams(): void {
  if (!webApp) return;
  const root = document.documentElement;

  for (const [key, value] of Object.entries(webApp.themeParams ?? {})) {
    if (typeof value === 'string' && value) {
      root.style.setProperty(`--tg-theme-${key.replace(/_/g, '-')}`, value);
    }
  }

  // Drives the light/dark token set in styles/tokens.css.
  root.dataset.scheme = webApp.colorScheme ?? 'light';
}

/**
 * Boot the SDK: signal readiness, take the full viewport, and sync the theme. Safe to call
 * outside Telegram (it becomes a no-op) and safe to call more than once.
 *
 * Returns a cleanup function that detaches the theme listener.
 */
export function initTelegram(): () => void {
  if (!webApp) return () => {};

  webApp.ready();
  webApp.expand();

  // Stops a downward swipe on a scrolled list from dismissing the Mini App mid-entry.
  // Only exists in Bot API 7.7+, hence the guard.
  webApp.disableVerticalSwipes?.();

  applyThemeParams();
  webApp.onEvent('themeChanged', applyThemeParams);

  return () => webApp.offEvent('themeChanged', applyThemeParams);
}

// --- Haptics -------------------------------------------------------------------------------
// Tactile confirmation matters here: employees log dozens of transactions a day, often
// without looking closely. All calls are no-ops outside Telegram.

export const haptics = {
  /** A keypad press, a chip selection. */
  tap(): void {
    webApp?.HapticFeedback?.selectionChanged();
  },
  /** A meaningful button press. */
  impact(style: 'light' | 'medium' | 'heavy' = 'light'): void {
    webApp?.HapticFeedback?.impactOccurred(style);
  },
  /** Transaction saved. */
  success(): void {
    webApp?.HapticFeedback?.notificationOccurred('success');
  },
  /** Validation failed / request errored. */
  error(): void {
    webApp?.HapticFeedback?.notificationOccurred('error');
  },
  warning(): void {
    webApp?.HapticFeedback?.notificationOccurred('warning');
  },
};

// --- Dialogs -------------------------------------------------------------------------------

/**
 * Native Telegram confirm, falling back to the browser's. Promisified so callers can `await`
 * instead of nesting a callback.
 */
export function confirmDialog(message: string): Promise<boolean> {
  if (webApp?.showConfirm) {
    return new Promise((resolve) => webApp.showConfirm!(message, (ok) => resolve(ok)));
  }
  return Promise.resolve(window.confirm(message));
}
