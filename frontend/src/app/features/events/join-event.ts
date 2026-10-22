import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import type { IScannerControls } from '@zxing/browser';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { PageHeader } from '../../shared/states';
import { JOIN_CODE_PATTERN, codeFromQr, normalizeCode } from './share-utils';

type ScanState = 'off' | 'starting' | 'scanning' | 'denied' | 'no-camera' | 'unsupported' | 'error';

/** Enter or scan a private event's join code, then open the event. */
@Component({
  selector: 'zeus-join-event-screen',
  imports: [ReactiveFormsModule, RouterLink, NgIcon, HlmButton, HlmInput, HlmLabel, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <zeus-page-header title="Join an event" subtitle="Private events are joined with the code from the Game Master." back="/events/discover" backLabel="Discover" i18n-title i18n-subtitle i18n-backLabel />

      <form class="panel flex flex-col gap-4 p-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="join-code" i18n>Join code</label>
          <input
            hlmInput
            id="join-code"
            formControlName="code"
            class="num h-14 text-center text-2xl font-bold tracking-[0.3em] uppercase"
            inputmode="text"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            maxlength="12"
            placeholder="ABC123"
            aria-describedby="join-code-hint join-code-error"
            [attr.aria-invalid]="codeError() ? 'true' : null"
            (input)="onCodeInput($event)"
          />
          <p id="join-code-hint" class="text-sm text-muted-foreground" i18n>6–10 letters and numbers. Spaces and dashes are ignored.</p>
          @if (codeError()) {
            <p id="join-code-error" class="field-error" role="alert">{{ codeError() }}</p>
          }
        </div>
        <button hlmBtn type="submit" class="h-12" [disabled]="searching()">
          @if (searching()) {
            <ng-icon name="lucideLoader2" size="18" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Finding event…</ng-container>
          } @else {
            <ng-icon name="lucideArrowRight" size="18" aria-hidden="true" /> <ng-container i18n>Find event</ng-container>
          }
        </button>
      </form>

      <div class="my-4 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span class="h-px flex-1 bg-border"></span> <ng-container i18n>OR</ng-container> <span class="h-px flex-1 bg-border"></span>
      </div>

      <section class="panel flex flex-col gap-3 p-4" aria-labelledby="scan-title">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 id="scan-title" class="text-lg uppercase" i18n>Scan invitation QR</h2>
            <p class="text-sm text-muted-foreground" i18n>Point the camera at the QR code on the invitation or the Game Master's screen.</p>
          </div>
          <ng-icon name="lucideScanQrCode" size="28" class="shrink-0 text-primary" aria-hidden="true" />
        </div>

        <div class="relative overflow-hidden rounded-md bg-black" [hidden]="!cameraVisible()">
          <video #video class="aspect-square w-full object-cover" playsinline muted aria-label="Camera preview" i18n-aria-label></video>
          <div class="pointer-events-none absolute inset-[15%] rounded-md border-2 border-primary/80" aria-hidden="true"></div>
          @if (scanState() === 'starting') {
            <div class="absolute inset-0 grid place-items-center bg-black/60 text-sm text-white" role="status" i18n>Starting camera…</div>
          }
        </div>

        @switch (scanState()) {
          @case ('scanning') {
            <p class="text-sm" role="status" i18n>Scanning… hold the code steady inside the frame.</p>
          }
          @case ('denied') {
            <p class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" i18n>
              Camera access is blocked. Allow the camera for this site in your browser settings, or type the code above.
            </p>
          }
          @case ('no-camera') {
            <p class="rounded-md border border-border bg-muted p-3 text-sm" role="alert" i18n>No camera found on this device. Type the code above.</p>
          }
          @case ('unsupported') {
            <p class="rounded-md border border-border bg-muted p-3 text-sm" role="alert" i18n>This browser cannot use the camera here. Type the code above.</p>
          }
          @case ('error') {
            <p class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">{{ scanError() || txt.theCameraCouldNot }}</p>
          }
        }
        @if (scanHint()) {
          <p class="text-sm text-warning" role="status">▲ {{ scanHint() }}</p>
        }

        @if (cameraVisible()) {
          <button hlmBtn variant="outline" type="button" class="h-12" (click)="stopScan()">
            <ng-icon name="lucideX" size="18" aria-hidden="true" /> <ng-container i18n>Close camera</ng-container>
          </button>
        } @else {
          <button hlmBtn variant="secondary" type="button" class="h-12" (click)="startScan()">
            <ng-icon name="lucideCamera" size="18" aria-hidden="true" /> {{ scanState() === 'off' ? txt.scanInvitationQr : txt.tryTheCameraAgain }}
          </button>
        }
      </section>

      <p class="mt-6 text-center text-sm text-muted-foreground" i18n>
        Looking for a public game? <a routerLink="/events/discover" class="font-semibold text-primary underline-offset-4 hover:underline">Discover events</a>
      </p>
    </div>
  `,
})
export class JoinEventScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    theCameraCouldNot: $localize`The camera could not start.`,
    scanInvitationQr: $localize`Scan invitation QR`,
    tryTheCameraAgain: $localize`Try the camera again`,
  };

  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** ?code= prefill (deep link from an invitation QR). */
  readonly code = input<string>();

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');

  protected readonly form = this.fb.group({
    code: this.fb.control('', [Validators.required, Validators.pattern(JOIN_CODE_PATTERN)]),
  });

  protected readonly searching = signal(false);
  protected readonly codeError = signal<string | null>(null);
  protected readonly scanState = signal<ScanState>('off');
  protected readonly scanError = signal<string | null>(null);
  protected readonly scanHint = signal<string | null>(null);
  protected readonly cameraVisible = signal(false);

  private controls: IScannerControls | null = null;
  /** Bumped on every start/stop so a late camera start is shut down immediately. */
  private scanSession = 0;
  private prefilled = false;

  constructor() {
    effect(() => {
      const raw = this.code();
      if (!raw || this.prefilled) return;
      this.prefilled = true;
      untracked(() => {
        const c = normalizeCode(raw);
        this.form.controls.code.setValue(c);
        // A valid code from a deep link is looked up straight away.
        if (JOIN_CODE_PATTERN.test(c)) void this.lookup(c);
      });
    });
    inject(DestroyRef).onDestroy(() => this.stopScan());
  }

  protected onCodeInput(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const clean = normalizeCode(el.value);
    if (clean !== el.value) this.form.controls.code.setValue(clean);
    this.codeError.set(null);
  }

  protected submit(): void {
    const ctrl = this.form.controls.code;
    const c = normalizeCode(ctrl.value);
    if (!c) {
      this.codeError.set($localize`Enter the join code.`);
      return;
    }
    if (!JOIN_CODE_PATTERN.test(c)) {
      this.codeError.set($localize`Codes are 6–10 letters and numbers.`);
      return;
    }
    void this.lookup(c);
  }

  private async lookup(code: string): Promise<void> {
    if (this.searching()) return;
    this.searching.set(true);
    this.codeError.set(null);
    try {
      const { eventId } = await this.api.findEventByCode(code);
      this.stopScan();
      await this.router.navigate(['/events', eventId], { queryParams: { code } });
    } catch (err) {
      const e = ApiError.from(err);
      this.codeError.set(e.fields['code'] ?? (e.status === 404 ? $localize`No event uses this code. Check it with your Game Master.` : e.message));
    } finally {
      this.searching.set(false);
    }
  }

  protected async startScan(): Promise<void> {
    if (!this.isBrowser) return;
    this.stopScan();
    this.scanError.set(null);
    this.scanHint.set(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.scanState.set('unsupported');
      return;
    }
    const session = ++this.scanSession;
    this.scanState.set('starting');
    this.cameraVisible.set(true);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      if (session !== this.scanSession) return;
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        this.video().nativeElement,
        (result) => {
          if (result) this.onScan(result.getText());
        },
      );
      if (session !== this.scanSession) {
        controls.stop();
        return;
      }
      this.controls = controls;
      this.scanState.set('scanning');
    } catch (err) {
      if (session !== this.scanSession) return;
      this.cameraVisible.set(false);
      const name = err instanceof DOMException || err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.scanState.set('denied');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
        this.scanState.set('no-camera');
      } else if (name === 'NotReadableError') {
        this.scanState.set('error');
        this.scanError.set($localize`The camera is in use by another app. Close it and try again.`);
      } else {
        this.scanState.set('error');
        this.scanError.set($localize`The camera could not start. Type the code instead.`);
      }
    }
  }

  protected stopScan(): void {
    this.scanSession++;
    try {
      this.controls?.stop();
    } catch {
      /* already stopped */
    }
    this.controls = null;
    this.cameraVisible.set(false);
    if (this.scanState() === 'scanning' || this.scanState() === 'starting') this.scanState.set('off');
  }

  private onScan(text: string): void {
    if (this.searching()) return;
    const code = codeFromQr(text);
    if (!code) {
      this.scanHint.set($localize`This QR code is not an AirsoftHub invitation.`);
      return;
    }
    this.scanHint.set(null);
    this.stopScan();
    if (typeof navigator.vibrate === 'function') navigator.vibrate(60);
    this.form.controls.code.setValue(code);
    void this.lookup(code);
  }
}
