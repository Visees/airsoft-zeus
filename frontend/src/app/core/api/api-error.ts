import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';

/** Error shape returned by the backend: { error: { code, message, fields? } } */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the request never reached the server (offline, DNS, timeout). */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  static from(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (err instanceof TimeoutError) return new ApiError(0, 'network', 'The server did not answer in time. Check your signal.');
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return new ApiError(0, 'network', 'No connection to the server. Check your signal and try again.');
      }
      const body = err.error as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null;
      const e = body && typeof body === 'object' ? body.error : undefined;
      return new ApiError(err.status, e?.code ?? `http_${err.status}`, e?.message ?? defaultMessage(err.status), e?.fields ?? {});
    }
    if (err instanceof Error) return new ApiError(-1, 'client', err.message);
    return new ApiError(-1, 'client', 'Something went wrong.');
  }
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'Not found. It may have been deleted.';
  if (status === 409) return 'This was changed by someone else. Reload and try again.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (status >= 500) return 'The server had a problem. Try again in a moment.';
  return 'The request failed.';
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  return ApiError.from(err).message;
}
