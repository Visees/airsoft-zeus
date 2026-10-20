import { MeUser } from '../../core/api/models';
import { safeNext } from './form-utils';

/**
 * Where to send a user right after they sign in / verify / accept terms.
 * Mirrors the route guards so the user never bounces through a redirect chain.
 */
export function postAuthUrl(user: MeUser, next?: string | null): string {
  const target = safeNext(next);
  if (!user.emailVerified) return '/auth/verify-email';
  if (!user.termsAccepted) {
    return target ? `/onboarding/consent?next=${encodeURIComponent(target)}` : '/onboarding/consent';
  }
  if (!user.onboardingDone) return '/onboarding/permissions';
  return target ?? '/home';
}
