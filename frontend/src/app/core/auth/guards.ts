import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ApiService } from '../api/api.service';
import { ApiError } from '../api/api-error';
import { ToastService } from '../ui/toast.service';
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

/** `userId:eventId` pairs already confirmed as GM, so hopping between GM screens skips the request. */
const confirmedGm = new Set<string>();

/**
 * Game Master of the `:eventId` route param. Goes after verifiedGuard.
 * Others land on the event page; offline it lets through and the screen's own error state takes over
 * (the server enforces GM rights on every call anyway).
 */
export const gmGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const api = inject(ApiService);
  const router = inject(Router);
  const toast = inject(ToastService);
  await auth.init();
  const eventId = route.paramMap.get('eventId');
  const userId = auth.user()?.id;
  if (!eventId || !userId) return router.createUrlTree(['/home']);
  const key = `${userId}:${eventId}`;
  if (confirmedGm.has(key)) return true;
  try {
    const event = await api.event(eventId);
    if (event.isGm) {
      confirmedGm.add(key);
      return true;
    }
  } catch (err) {
    const e = ApiError.from(err);
    if (e.status === 404) return router.createUrlTree(['/events/mine']);
    if (e.status !== 403) return true;
  }
  toast.warning($localize`This page is for the event's Game Masters`);
  return router.createUrlTree(['/events', eventId]);
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
