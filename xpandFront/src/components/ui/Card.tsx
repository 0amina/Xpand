import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes padding and clips children — for cards that hold a flush list. */
  flush?: boolean;
  children: ReactNode;
}

export function Card({ flush = false, className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={['card', flush && 'card--flush', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  /** Right-aligned slot: a "See all" link, a count, a filter button. */
  action?: ReactNode;
}

export function CardHeader({ title, action }: CardHeaderProps) {
  return (
    <div className="card__header">
      <span className="card__title">{title}</span>
      {action}
    </div>
  );
}
