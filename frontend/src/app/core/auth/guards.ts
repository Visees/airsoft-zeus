import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Signed in (any verification state). */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.init();
  if (auth.isLoggedIn()) return true;
  return router.createUrlTree(['/auth/login'], { queryParams: { next: state.url } });
};

/** Signed in, email verified, terms accepted. Use on everything that touches events. */
export const verifiedGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.init();
  const user = auth.user();
  if (!user) return router.createUrlTree(['/auth/login'], { queryParams: { next: state.url } });
  if (!user.emailVerified) return router.createUrlTree(['/auth/verify-email']);
  if (!user.termsAccepted) return router.createUrlTree(['/onboarding/consent'], { queryParams: { next: state.url } });
  return true;
};

/** Platform admin (ADMIN_EMAILS on the server). Goes inside the shell, after verifiedGuard. */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.init();
  return auth.user()?.isAdmin ? true : router.createUrlTree(['/home']);
};

/** Only for signed-out visitors (welcome, login, sign-up). */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.init();
  return auth.isLoggedIn() ? router.createUrlTree(['/home']) : true;
};

/** Root redirect. */
export const rootRedirectGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.init();
  const user = auth.user();
  if (!user) return router.createUrlTree(['/welcome']);
  if (!user.emailVerified) return router.createUrlTree(['/auth/verify-email']);
  if (!user.onboardingDone) return router.createUrlTree(['/onboarding/permissions']);
  return router.createUrlTree(['/home']);
};
