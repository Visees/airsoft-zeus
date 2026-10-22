import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { AppConfig } from './models';

const FALLBACK: AppConfig = {
  esriApiKey: '',
  vapidPublicKey: null,
  termsVersion: '2026-10',
  privacyVersion: '2026-10',
  maxUploadBytes: 5 * 1024 * 1024,
  maxAttachmentBytes: 25 * 1024 * 1024,
};

/** Runtime configuration served by the API (keys are not baked into the bundle). */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly api = inject(ApiService);
  private readonly _config = signal<AppConfig>(FALLBACK);
  private loading: Promise<AppConfig> | null = null;

  readonly config = this._config.asReadonly();

  load(): Promise<AppConfig> {
    this.loading ??= this.api
      .config()
      .then((c) => {
        this._config.set(c);
        return c;
      })
      .catch(() => {
        this.loading = null;
        return this._config();
      });
    return this.loading;
  }
}
