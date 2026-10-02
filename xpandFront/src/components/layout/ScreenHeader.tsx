import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useTelegramBackButton } from '@/hooks/useTelegramButtons';
import { haptics } from '@/lib/telegram';

import './layout.css';

interface ScreenHeaderProps {
  title: ReactNode;
  /** Shows a back affordance. Defaults to `navigate(-1)` when no handler is given. */
  onBack?: (() => void) | null;
  showBack?: boolean;
  action?: ReactNode;
}

/**
 * Sticky screen title bar. When running inside Telegram it also binds the client's native
 * BackButton, so both affordances work and stay in sync.
 */
export function ScreenHeader({ title, onBack, showBack = true, action }: ScreenHeaderProps) {
  const navigate = useNavigate();
  const handleBack = showBack ? (onBack ?? (() => navigate(-1))) : null;

  useTelegramBackButton(handleBack);

  return (
    <header className="screen-header">
      {handleBack && (
        <button
          type="button"
          className="screen-header__back"
          aria-label="Go back"
          onClick={() => {
            haptics.impact('light');
            handleBack();
          }}
        >
          ‹
        </button>
      )}
      <h1 className="screen-header__title">{title}</h1>
      {action && <div className="screen-header__action">{action}</div>}
    </header>
  );
}
