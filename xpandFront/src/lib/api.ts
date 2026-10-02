import type { ApiEnvelope, ApiErrorBody } from '@/types/api';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/**
 * The credential sent on every authenticated request.
 *
 * Two shapes, matching the backend's two accepted auth paths:
 *
 *  - `initData` — the signed string Telegram hands a Mini App, sent as
 *    `Authorization: tma <initData>`. The backend verifies its HMAC against the bot token, so
 *    this actually proves who the caller is. It is the only path accepted in production.
 *  - `devId` — a bare Telegram id sent as `x-telegram-id`. Unsigned and therefore spoofable;
 *    the backend refuses it when `NODE_ENV=production`. It exists so the app is usable in a
 *    browser tab, where there is no initData at all.
 */
export type Credential =
  { kind: 'initData'; initData: string } | { kind: 'devId'; telegramId: string };

let credential: Credential | null = null;

export function setCredential(next: Credential | null): void {
  credential = next;
}

export function getCredential(): Credential | null {
  return credential;
}

/** Auth headers for the current credential, or `{}` when signed out. */
function authHeaders(): Record<string, string> {
  if (!credential) return {};
  return credential.kind === 'initData'
    ? { Authorization: `tma ${credential.initData}` }
    : { 'x-telegram-id': credential.telegramId };
}

/** A failed request, carrying the backend's `{ error: { message, statusCode, details? } }`. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly details: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }

  /** The caller is unknown to the backend, or sent no id — they need to sign in again. */
  get isUnauthorized(): boolean {
    return this.statusCode === 401;
  }

  /**
   * The request was refused outright. The API itself no longer returns this — every
   * authenticated user may do everything — so in practice it means something in front of the
   * backend (a proxy, a tunnel) rejected the call.
   */
  get isForbidden(): boolean {
    return this.statusCode === 403;
  }

  /** Zod rejected the payload. `details` holds the field-level issues. */
  get isValidation(): boolean {
    return this.statusCode === 400;
  }

  /**
   * A human-readable first line for a toast. Validation errors get the offending field
   * appended, since "Validation failed" alone tells the user nothing actionable.
   */
  get displayMessage(): string {
    if (this.isValidation && Array.isArray(this.details)) {
      const issue = this.details[0] as { path?: unknown[]; message?: string } | undefined;
      if (issue?.message) {
        const field = Array.isArray(issue.path) ? issue.path.filter(Boolean).join('.') : '';
        return field ? `${field}: ${issue.message}` : issue.message;
      }
    }
    return this.message;
  }
}

/** Thrown when the request never reached the server (offline, CORS, backend down). */
export class NetworkError extends Error {
  constructor(message = 'Cannot reach the server. Check your connection.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Drop `undefined` values from a payload.
 *
 * The backend's Zod schemas mark optional fields `.optional()`, not `.nullable()` — sending
 * an explicit `null` is a 400. Empty optional inputs must therefore be *absent*, not null,
 * so every write goes through this first.
 */
export function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

/** Build a query string from a filter object, skipping empty values. Returns '' or '?a=b'. */
export function toQueryString(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, unknown>;
  /** `POST /api/users/login` is the one route that must NOT send an id — it creates it. */
  skipAuth?: boolean;
  signal?: AbortSignal;
}

/**
 * The single entry point for talking to the backend.
 *
 * Unwraps the `{ data }` envelope, normalizes `{ error }` into an `ApiError`, and turns a
 * dead connection into a `NetworkError` rather than a confusing `TypeError: Failed to fetch`.
 *
 * @returns the unwrapped `data`, or `undefined` for a 204.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, skipAuth = false, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!skipAuth) Object.assign(headers, authHeaders());

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}${toQueryString(query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // An aborted request is control flow (a superseded query), not a failure — rethrow as-is
    // so React Query can recognize and ignore it.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new NetworkError();
  }

  // 204 No Content — DELETE returns this. There is no body to parse.
  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body means something upstream (proxy, tunnel, rate limiter) answered
    // instead of the API. Surface the status rather than a parse error.
    if (!response.ok) {
      throw new ApiError(`Request failed with status ${response.status}`, response.status);
    }
    throw new ApiError('The server returned a malformed response.', response.status);
  }

  if (!response.ok) {
    const { error } = (payload ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      error?.message ?? `Request failed with status ${response.status}`,
      error?.statusCode ?? response.status,
      error?.details,
    );
  }

  return (payload as ApiEnvelope<T>).data;
}

/**
 * POST a file as `multipart/form-data`.
 *
 * Separate from `request` for one reason that bites everybody: the `Content-Type` header must
 * **not** be set. `fetch` generates it from the `FormData`, including the `boundary=` parameter;
 * setting `multipart/form-data` by hand produces a header with no boundary and the server cannot
 * parse the body. So this builds its own headers rather than reusing `request`'s.
 *
 * `onProgress` needs XHR — `fetch` has no upload-progress event — which is why this is XHR-based.
 * On a phone connection an invoice photo takes long enough that a progress bar is the difference
 * between "working" and "broken".
 */
export function upload<T>(
  path: string,
  file: File | Blob,
  options: { fieldName?: string; filename?: string; onProgress?: (percent: number) => void } = {},
): Promise<T> {
  const { fieldName = 'file', filename, onProgress } = options;

  const form = new FormData();
  form.append(fieldName, file, filename ?? (file instanceof File ? file.name : 'upload'));

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    for (const [key, value] of Object.entries(authHeaders())) {
      xhr.setRequestHeader(key, value);
    }

    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      });
    }

    xhr.addEventListener('load', () => {
      let payload: unknown;
      try {
        payload = JSON.parse(xhr.responseText) as unknown;
      } catch {
        reject(new ApiError(`Upload failed with status ${xhr.status}`, xhr.status));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((payload as ApiEnvelope<T>).data);
        return;
      }

      const { error } = (payload ?? {}) as Partial<ApiErrorBody>;
      reject(
        new ApiError(
          error?.message ?? `Upload failed with status ${xhr.status}`,
          error?.statusCode ?? xhr.status,
          error?.details,
        ),
      );
    });

    // A dead connection surfaces as `error`; the server being unreachable is not a 4xx.
    xhr.addEventListener('error', () => reject(new NetworkError()));
    xhr.addEventListener('abort', () => reject(new NetworkError('The upload was cancelled.')));

    xhr.send(form);
  });
}

/**
 * Fetch an authenticated binary resource as an object URL, for use as an `<img src>`.
 *
 * Invoice files sit behind `requireAuth`, so a plain `<img src="/api/invoices/1/file">` sends no
 * credentials and 401s. The caller must `URL.revokeObjectURL` the result on unmount.
 */
export async function fetchObjectUrl(path: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  } catch {
    throw new NetworkError();
  }

  if (!response.ok) {
    throw new ApiError(`Could not load the file (status ${response.status})`, response.status);
  }

  return URL.createObjectURL(await response.blob());
}

/**
 * GET an endpoint that carries a `meta` sidecar, returning the whole envelope.
 *
 * `request` deliberately unwraps to `data`, which is right for almost every call — but it then
 * discards `meta`, and a couple of endpoints put counts there specifically so the client does not
 * have to fetch a list twice to badge it.
 */
export async function getWithMeta<T, M>(
  path: string,
  query?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ApiEnvelope<T, M>> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}${toQueryString(query)}`, {
      headers: { Accept: 'application/json', ...authHeaders() },
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new NetworkError();
  }

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const { error } = (payload ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      error?.message ?? `Request failed with status ${response.status}`,
      error?.statusCode ?? response.status,
      error?.details,
    );
  }

  return payload as ApiEnvelope<T, M>;
}

export const api = {
  get: <T>(path: string, query?: Record<string, unknown>, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', query, signal }),

  post: <T>(path: string, body?: unknown, opts?: { skipAuth?: boolean }) =>
    request<T>(path, { method: 'POST', body, skipAuth: opts?.skipAuth ?? false }),

  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),

  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),

  delete: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),

  upload,
};

/** Liveness probe — used by the connection banner. Deliberately unauthenticated. */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

export { BASE_URL };
