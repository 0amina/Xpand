import { useEffect, useRef } from 'react';

import { webApp } from '@/lib/telegram';

/**
 * Bind Telegram's native BackButton to a handler while a screen is mounted.
 *
 * Inside Telegram this is the back affordance users reach for — it sits in the client chrome,
 * not the page. Outside Telegram it is a no-op and the in-page header button covers it.
 */
export function useTelegramBackButton(onBack: (() => void) | null): void {
  // Held in a ref so a re-created callback doesn't detach and re-attach the listener on
  // every render, which makes the button flicker on some Android clients.
  const handler = useRef(onBack);
  handler.current = onBack;

  useEffect(() => {
    const button = webApp?.BackButton;
    if (!button || !onBack) return;

    const listener = () => handler.current?.();
    button.onClick(listener);
    button.show();

    return () => {
      button.offClick(listener);
      button.hide();
    };
    // `onBack` is only read for its null-ness — the live function comes from the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(onBack)]);
}

interface MainButtonOptions {
  text: string;
  onClick: () => void;
  visible?: boolean;
  enabled?: boolean;
  loading?: boolean;
  /** Overrides the theme button colour — used to tint save green or red. */
  color?: string;
  textColor?: string;
}

/**
 * Drive Telegram's native MainButton — the full-width bar pinned above the keyboard.
 *
 * It is the fastest possible submit target on a phone (always in the same place, always under
 * the thumb, unaffected by scroll position). The forms still render their own submit button so
 * the app works identically in a browser; the two are kept in sync from the same state.
 */
export function useTelegramMainButton({
  text,
  onClick,
  visible = true,
  enabled = true,
  loading = false,
  color,
  textColor,
}: MainButtonOptions): void {
  const handler = useRef(onClick);
  handler.current = onClick;

  useEffect(() => {
    const button = webApp?.MainButton;
    if (!button) return;

    const listener = () => handler.current();
    button.onClick(listener);

    return () => {
      button.offClick(listener);
      button.hide();
    };
  }, []);

  useEffect(() => {
    const button = webApp?.MainButton;
    if (!button) return;

    button.setParams({
      text,
      is_visible: visible,
      is_active: enabled && !loading,
      ...(color ? { color } : {}),
      ...(textColor ? { text_color: textColor } : {}),
    });

    if (loading) button.showProgress(false);
    else button.hideProgress();
  }, [text, visible, enabled, loading, color, textColor]);
}
