import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmToaster } from '@spartan-ng/helm/sonner';
import { ConfigService } from './core/api/config.service';
import { AuthService } from './core/auth/auth.service';
import { NotificationCenter } from './core/notifications/notification-center.service';
import { PushService } from './core/push/push.service';
import { ThemeService } from './core/theme/theme.service';
import { ConfirmHost } from './shared/confirm-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HlmToaster, ConfirmHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    @if (!auth.ready()) {
      <!-- Splash: shown while the session is restored -->
      <div class="fixed inset-0 z-50 grid place-items-center bg-background" role="status" aria-label="Starting Airsoft Zeus">
        <div class="flex flex-col items-center gap-4">
          <span class="grid size-14 place-items-center rounded-md bg-primary font-mono text-2xl font-bold text-primary-foreground" aria-hidden="true">Z</span>
          <span class="label-caps">Airsoft Zeus · connecting</span>
          <span class="h-0.5 w-32 overflow-hidden bg-muted"><span class="block h-full w-1/3 animate-pulse bg-primary"></span></span>
        </div>
      </div>
    }
    <hlm-toaster position="top-center" [theme]="theme.isDark() ? 'dark' : 'light'" [closeButton]="true" />
    <zeus-confirm-host />
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  private readonly push = inject(PushService);

  constructor() {
    inject(NotificationCenter);
    void inject(ConfigService).load();
    void this.auth.init().then(() => {
      if (this.auth.isLoggedIn()) void this.push.ensureSubscribed();
    });
  }
}
