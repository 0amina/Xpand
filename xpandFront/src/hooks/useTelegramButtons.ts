import { useEffect, useRef } from 'react';

import { isTelegram, webApp } from '@/lib/telegram';

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
 * the thumb, unaffected by scroll position).
 *
 * **Returns whether the native button is the one on screen**, which callers must use to decide
 * whether to render their own. A form that renders both unconditionally shows the user two Save
 * buttons inside Telegram — the native bar at the bottom of the client and the in-page bar sitting
 * above the tab bar — and the pair is worse than either alone: it is not obvious they do the same
 * thing, and the in-page one is the one that looks half-hidden behind the menu.
 */
export function useTelegramMainButton({
  text,
  onClick,
  visible = true,
  enabled = true,
  loading = false,
  color,
  textColor,
}: MainButtonOptions): boolean {
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

  // `isTelegram` as well as the object's presence: the SDK script is loaded in a plain browser
  // tab too, where `MainButton` exists but paints nothing, so testing for the object alone would
  // leave a browser user with no submit button at all.
  return isTelegram && Boolean(webApp?.MainButton) && visible;
}
