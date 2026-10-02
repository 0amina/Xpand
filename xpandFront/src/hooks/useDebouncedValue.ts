import { useEffect, useState } from 'react';

/**
 * Delay propagating a rapidly-changing value.
 *
 * Used for the entity picker's search box so typing "packaging" fires one request instead of
 * nine — the backend's rate limiter allows 300/min, and a picker shouldn't spend it.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
