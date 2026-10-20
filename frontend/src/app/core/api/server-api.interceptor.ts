import { HttpInterceptorFn } from '@angular/common/http';

/**
 * During server rendering, relative /api URLs go straight to the api container
 * (API_INTERNAL_URL, e.g. http://api:3000) instead of looping through the public origin.
 */
export const serverApiInterceptor: HttpInterceptorFn = (req, next) => {
  const base = (typeof process !== 'undefined' && process.env['API_INTERNAL_URL']) || 'http://localhost:3000';
  if (req.url.startsWith('/api')) return next(req.clone({ url: base.replace(/\/$/, '') + req.url }));
  return next(req);
};
