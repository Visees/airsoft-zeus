import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { ApiError } from '../api/api-error';
import { AuthService } from './auth.service';

const NO_RETRY = ['/api/auth/login', '/api/auth/refresh', '/api/auth/register', '/api/auth/logout'];

/**
 * Adds the bearer token to /api calls, retries once after refreshing an expired token,
 * and converts every HTTP failure into an ApiError.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  if (!req.url.startsWith('/api')) return next(req);

  const withToken = (r: HttpRequest<unknown>) => {
    const token = auth.token();
    return token ? r.clone({ setHeaders: { Authorization: `Bearer ${token}` }, withCredentials: true }) : r.clone({ withCredentials: true });
  };

  return next(withToken(req)).pipe(
    catchError((err: unknown) => {
      const canRetry =
        err instanceof HttpErrorResponse && err.status === 401 && !NO_RETRY.some((p) => req.url.startsWith(p)) && auth.token() !== null;
      if (!canRetry) {
        // Blob downloads (exports) receive their JSON error body as a Blob: parse it for the message.
        if (err instanceof HttpErrorResponse && err.error instanceof Blob) {
          return from(blobError(err)).pipe(switchMap((e) => throwError(() => e)));
        }
        return throwError(() => ApiError.from(err));
      }
      return from(auth.refresh()).pipe(
        switchMap((ok) => (ok ? next(withToken(req)) : throwError(() => ApiError.from(err)))),
        catchError((e: unknown) => throwError(() => ApiError.from(e))),
      );
    }),
  );
};

async function blobError(err: HttpErrorResponse): Promise<ApiError> {
  try {
    const body = JSON.parse(await (err.error as Blob).text());
    return ApiError.from(new HttpErrorResponse({ error: body, status: err.status, statusText: err.statusText, url: err.url ?? undefined }));
  } catch {
    return ApiError.from(err);
  }
}
