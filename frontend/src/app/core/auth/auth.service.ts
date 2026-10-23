import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, take } from 'rxjs';
import { ApiService } from '../api/api.service';
import { AuthResponse, Feature, MeUser, RegisterRequest } from '../api/models';
import { activeLanguage, isUiLanguage, rememberLanguage } from '../i18n/language';

/**
 * Session state. The access token lives only in memory; the refresh token is an
 * httpOnly SameSite=Strict cookie scoped to /api/auth, so a page reload calls
 * refresh() to get a new access token.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _user = signal<MeUser | null>(null);
  private readonly _token = signal<string | null>(null);
  private readonly _ready = signal(false);
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing: Promise<boolean> | null = null;
  private initPromise: Promise<void> | null = null;

  readonly user = this._user.asReadonly();
  readonly token = this._token.asReadonly();
  /** true once the initial session restore finished (success or not) */
  readonly ready = this._ready.asReadonly();
  readonly isLoggedIn = computed(() => this._user() !== null);
  readonly isVerified = computed(() => this._user()?.emailVerified === true);

  /**
   * The signed-in user may use this part of the app (set per user in Admin → Users). Reads a
   * signal, so it is reactive in templates and computed(). The server checks it on every call too.
   */
  can(feature: Feature): boolean {
    return this._user()?.features?.[feature] === true;
  }

  /** Restore the session from the refresh cookie. Safe to call many times. */
  init(): Promise<void> {
    if (!this.isBrowser) {
      this._ready.set(true);
      return Promise.resolve();
    }
    // No session hint cookie → nothing to restore (avoids a guaranteed 401).
    const hasSession = typeof document !== 'undefined' && /(?:^|;\s*)airsofthub_session=1/.test(document.cookie);
    this.initPromise ??= (hasSession ? this.refresh() : Promise.resolve(false)).then(() => {
      const user = this._user();
      // Opening the app: switch to the profile language straight away.
      if (user && this.useProfileLanguage(user)) location.reload();
      else this._ready.set(true);
    });
    return this.initPromise;
  }

  async login(email: string, password: string): Promise<MeUser> {
    return this.afterSignIn(this.apply(await this.api.login(email, password)));
  }

  async register(body: RegisterRequest): Promise<MeUser> {
    return this.afterSignIn(this.apply(await this.api.register(body)));
  }

  /**
   * The profile language wins over the device. Translations are fixed per page load, so a
   * different language means a reload: callers navigate right after signing in, so wait for that.
   */
  private afterSignIn(user: MeUser): MeUser {
    if (this.isBrowser && this.useProfileLanguage(user)) {
      this.router.events
        .pipe(
          filter((e) => e instanceof NavigationEnd),
          take(1),
        )
        .subscribe(() => location.reload());
    }
    return user;
  }

  /** Remembers the profile language for this device; true when it differs from the current UI. */
  private useProfileLanguage(user: MeUser): boolean {
    if (!isUiLanguage(user.language) || user.language === activeLanguage()) return false;
    rememberLanguage(user.language);
    return true;
  }

  /** Change the password; the server signs out other sessions and returns a new one for this device. */
  async changePassword(currentPassword: string, newPassword: string): Promise<MeUser> {
    return this.apply(await this.api.changePassword(currentPassword, newPassword));
  }

  /** Get a fresh access token. Concurrent callers share one request. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.api
      .refresh()
      .then((res) => {
        this.apply(res);
        return true;
      })
      .catch(() => {
        this.clear();
        return false;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async reloadUser(): Promise<MeUser | null> {
    try {
      const user = await this.api.me();
      this._user.set(user);
      return user;
    } catch {
      return this._user();
    }
  }

  setUser(user: MeUser): void {
    this._user.set(user);
  }

  async logout(redirect = true): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      /* the cookie is cleared server side when reachable; local state is cleared anyway */
    }
    this.clear();
    if (redirect) await this.router.navigateByUrl('/welcome');
  }

  /** Clear local session without calling the server (e.g. after account deletion). */
  clear(): void {
    this._user.set(null);
    this._token.set(null);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private apply(res: AuthResponse): MeUser {
    this._token.set(res.accessToken);
    this._user.set(res.user);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    // refresh one minute before expiry
    const ms = Math.max(15_000, (res.expiresIn - 60) * 1000);
    if (this.isBrowser) this.refreshTimer = setTimeout(() => void this.refresh(), ms);
    return res.user;
  }
}
