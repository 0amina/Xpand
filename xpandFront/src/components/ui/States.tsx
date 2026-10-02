import type { ReactNode } from 'react';

import { describeError } from '@/lib/errors';

import { Button } from './Button';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="centered-state">
      <span className="spinner spinner--lg" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="centered-state">
      <span style={{ fontSize: 40, lineHeight: 1 }} aria-hidden="true">
        {icon}
      </span>
      <strong style={{ color: 'var(--x-text)', fontSize: 'var(--x-text-md)' }}>{title}</strong>
      {description && <span>{description}</span>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, description } = describeError(error);

  return (
    <div className="centered-state">
      <span style={{ fontSize: 40, lineHeight: 1 }} aria-hidden="true">
        ⚠️
      </span>
      <strong style={{ color: 'var(--x-text)', fontSize: 'var(--x-text-md)' }}>{title}</strong>
      <span style={{ maxWidth: 320 }}>{description}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
