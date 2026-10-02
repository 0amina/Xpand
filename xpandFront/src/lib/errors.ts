import { ApiError, NetworkError } from './api';

/**
 * Turn any thrown value into something a user can act on.
 *
 * The distinction that matters is *whose problem it is*: a 401 means sign in again, a 403 means
 * something between the app and the backend refused the call, a NetworkError means the backend
 * isn't running. Each needs a different next step, and "Something went wrong" supplies none.
 */
export function describeError(error: unknown): { title: string; description: string } {
  if (error instanceof NetworkError) {
    return {
      title: 'No connection',
      description:
        'The Xpand backend could not be reached. Check that it is running and that this origin is listed in CORS_ORIGINS.',
    };
  }

  if (error instanceof ApiError) {
    if (error.isUnauthorized) {
      return {
        title: 'Session not recognised',
        description: 'Your Telegram account is not signed in to Xpand. Try reopening the app.',
      };
    }
    if (error.isForbidden) {
      return {
        title: 'Blocked',
        description:
          'The request was refused before it reached Xpand. Check the tunnel or proxy in front of the backend.',
      };
    }
    if (error.statusCode === 429) {
      return {
        title: 'Slow down',
        description: 'Too many requests were sent. Wait a moment and try again.',
      };
    }
    if (error.statusCode >= 500) {
      return {
        title: 'Server error',
        description: 'The backend failed to handle the request. Try again shortly.',
      };
    }
    return { title: 'Request rejected', description: error.displayMessage };
  }

  return {
    title: 'Something went wrong',
    description: error instanceof Error ? error.message : 'An unexpected error occurred.',
  };
}
