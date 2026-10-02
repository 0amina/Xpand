import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Pinned action area below the scrolling body — an "Apply filters" button, say. */
  footer?: ReactNode;
  /** Drops body padding so a flush list can run edge to edge. */
  flush?: boolean;
}

/**
 * A bottom sheet — the right modal shape on a phone, since it opens next to the thumb rather
 * than in the middle of the screen.
 *
 * Rendered through a portal so it escapes the scroll container's stacking context, and it
 * locks background scroll while open (without which iOS scrolls the page behind the sheet).
 */
export function Sheet({ open, onClose, title, children, footer, flush = false }: SheetProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="sheet__scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
      >
        <div className="sheet__grip" aria-hidden="true" />
        <div className="sheet__header">
          <span className="sheet__title">{title}</span>
          <button type="button" className="sheet__close" onClick={onClose}>
            Done
          </button>
        </div>
        <div className={`sheet__body ${flush ? 'sheet__body--flush' : ''}`}>{children}</div>
        {footer && <div className="sheet__footer">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}
