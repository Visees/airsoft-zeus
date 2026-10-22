import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser';
import { LiveStore } from '../../core/live/live-store';
import { CaptureAttempt } from './capture-attempt';
import { CaptureFeedback } from './capture-feedback';
import { liveLink, vibrate } from './live-util';

type CameraState = 'idle' | 'starting' | 'scanning' | 'decoded' | 'denied' | 'nocamera' | 'unsupported' | 'busy' | 'error';

interface ParsedQr {
  eventId: string;
  objectiveId: string;
  token: string;
  raw: string;
}

/** `zeus:obj:<eventId>:<objectiveId>:<token>` */
export function parseObjectiveQr(text: string): ParsedQr | null {
  const raw = text.trim();
  const m = raw.match(/^zeus:obj:([^:\s]+):([^:\s]+):(\S+)$/);
  return m ? { eventId: m[1], objectiveId: m[2], token: m[3], raw } : null;
}

/** Camera QR scanner for objective captures. */
@Component({
  selector: 'zeus-qr-scanner',
  imports: [RouterLink, NgIcon, HlmButton, CaptureFeedback],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col' },
  styles: `
    .corner {
      position: absolute;
      width: 2.25rem;
      height: 2.25rem;
      border-color: var(--primary);
      border-style: solid;
      border-width: 0;
    }
  `,
  template: `
    <h2 class="sr-only">Scan QR code</h2>
    <!-- Camera -->
    <div class="relative min-h-56 flex-1 overflow-hidden bg-black">
      <video #video class="absolute inset-0 size-full object-cover" playsinline muted aria-hidden="true"></video>

      @if (camState() === 'scanning' || camState() === 'starting') {
        <div class="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
          <div class="relative size-[min(68vw,42vh,20rem)] rounded-md" style="box-shadow: 0 0 0 200vmax rgb(0 0 0 / 0.5)">
            <span class="corner top-0 left-0 rounded-tl-md border-t-4 border-l-4"></span>
            <span class="corner top-0 right-0 rounded-tr-md border-t-4 border-r-4"></span>
            <span class="corner bottom-0 left-0 rounded-bl-md border-b-4 border-l-4"></span>
            <span class="corner right-0 bottom-0 rounded-br-md border-r-4 border-b-4"></span>
          </div>
        </div>
      }

      <!-- Top bar -->
      <div class="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2">
        <a [routerLink]="backLink()" class="hud tap inline-flex items-center gap-1 px-3 text-sm font-semibold" aria-label="Back">
          <ng-icon name="lucideArrowLeft" size="18" aria-hidden="true" /> Back
        </a>
        @if (torchSupported() && camState() === 'scanning') {
          <button
            type="button"
            class="hud tap inline-flex items-center gap-1.5 px-3 text-sm font-semibold"
            [class.text-warning]="torchOn()"
            [attr.aria-pressed]="torchOn()"
            (click)="toggleTorch()"
          >
            <ng-icon name="lucideZap" size="18" aria-hidden="true" /> {{ torchOn() ? 'Light on' : 'Light' }}
          </button>
        }
      </div>

      <!-- Camera states -->
      <div class="absolute inset-0 grid place-items-center p-6 text-center text-white" [class.hidden]="camState() === 'scanning'" role="status">
        @switch (camState()) {
          @case ('starting') {
            <p class="flex items-center gap-2 font-semibold">
              <ng-icon name="lucideLoader2" size="20" class="animate-spin" aria-hidden="true" /> Starting the camera…
            </p>
          }
          @case ('decoded') {
            <p class="flex flex-col items-center gap-2 font-semibold">
              <ng-icon name="lucideScanQrCode" size="40" aria-hidden="true" /> Code read
            </p>
          }
          @case ('denied') {
            <div class="max-w-sm">
              <ng-icon name="lucideCamera" size="36" aria-hidden="true" />
              <p class="mt-2 text-lg font-bold">Camera access is blocked</p>
              <p class="mt-1 text-sm opacity-90">
                Allow the camera for this site: tap the lock or settings icon next to the address bar, set Camera to Allow, then tap “Try again”.
              </p>
            </div>
          }
          @case ('nocamera') {
            <div class="max-w-sm">
              <ng-icon name="lucideCamera" size="36" aria-hidden="true" />
              <p class="mt-2 text-lg font-bold">No camera found</p>
              <p class="mt-1 text-sm opacity-90">This device has no usable camera. Enter the code by hand instead.</p>
            </div>
          }
          @case ('unsupported') {
            <div class="max-w-sm">
              <ng-icon name="lucideCamera" size="36" aria-hidden="true" />
              <p class="mt-2 text-lg font-bold">Camera not available</p>
              <p class="mt-1 text-sm opacity-90">This browser cannot use the camera here. Enter the code by hand instead.</p>
            </div>
          }
          @case ('busy') {
            <div class="max-w-sm">
              <ng-icon name="lucideCamera" size="36" aria-hidden="true" />
              <p class="mt-2 text-lg font-bold">Camera is busy</p>
              <p class="mt-1 text-sm opacity-90">Another app is using the camera. Close it and tap “Try again”.</p>
            </div>
          }
          @case ('error') {
            <div class="max-w-sm">
              <ng-icon name="lucideCircleAlert" size="36" aria-hidden="true" />
              <p class="mt-2 text-lg font-bold">The camera could not start</p>
              <p class="mt-1 text-sm opacity-90">Tap “Try again”, or enter the code by hand.</p>
            </div>
          }
        }
      </div>
    </div>

    <!-- Result / instructions -->
    <div class="flex shrink-0 flex-col gap-3 border-t border-border bg-card p-4">
      @if (target(); as t) {
        <p class="text-sm">
          <span class="label-caps">Capturing</span>
          <span class="ml-1 font-bold uppercase">{{ t }}</span>
        </p>
      }

      @if (scanError()) {
        <div class="rounded-md border-2 border-destructive bg-destructive/10 p-3" role="alert">
          <p class="font-bold text-destructive">✕ Code not accepted</p>
          <p class="text-sm">{{ scanError() }}</p>
        </div>
      } @else if (camState() === 'scanning' && attempt.state() === 'idle') {
        <p class="text-sm font-semibold" role="status">Point the camera at the QR code on the objective. Hold steady about 30 cm away.</p>
      }

      @if (mismatchNote()) {
        <p class="rounded-sm border border-warning/60 bg-warning-surface p-2 text-sm font-semibold" role="status">◐ {{ mismatchNote() }}</p>
      }

      <zeus-capture-feedback [attempt]="attempt" [objectiveName]="scannedName()" (retry)="retryCapture()" />

      <div class="flex flex-col gap-2 sm:flex-row">
        @if (canScanAgain()) {
          <button hlmBtn type="button" class="h-12 flex-1" (click)="scanAgain()">
            <ng-icon name="lucideScanLine" size="18" aria-hidden="true" /> {{ camFailed() ? 'Try again' : 'Scan again' }}
          </button>
        }
        @if (attempt.state() === 'success' && scanned(); as s) {
          <a hlmBtn variant="outline" class="h-12 flex-1" [routerLink]="objectiveLink(s.objectiveId)">Open objective</a>
        } @else {
          <a hlmBtn variant="outline" class="h-12 flex-1" [routerLink]="manualLink()">
            <ng-icon name="lucideKeyRound" size="18" aria-hidden="true" /> Enter the code by hand
          </a>
        }
      </div>
    </div>
  `,
})
export class QrScannerScreen {
  /** ?objective=<id>: the objective the player meant to capture. */
  readonly objective = input<string | undefined>(undefined);

  protected readonly store = inject(LiveStore);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');

  protected readonly attempt = new CaptureAttempt();
  protected readonly camState = signal<CameraState>('idle');
  protected readonly torchSupported = signal(false);
  protected readonly torchOn = signal(false);
  protected readonly scanError = signal<string | null>(null);
  protected readonly scanned = signal<ParsedQr | null>(null);

  private controls: IScannerControls | null = null;
  private handled = false;
  private destroyed = false;

  protected readonly camFailed = computed(() => ['denied', 'busy', 'error'].includes(this.camState()));
  protected readonly canScanAgain = computed(() => {
    const s = this.camState();
    if (this.attempt.state() === 'pending') return false;
    return s === 'decoded' || this.camFailed();
  });

  protected readonly scannedName = computed(() => {
    const s = this.scanned();
    return s ? (this.store.objectiveById().get(s.objectiveId)?.name ?? null) : null;
  });

  protected readonly target = computed(() => {
    const s = this.scanned();
    if (s) return this.scannedName() ?? 'Scanned objective';
    const id = this.objective();
    return id ? (this.store.objectiveById().get(id)?.name ?? null) : null;
  });

  protected readonly mismatchNote = computed(() => {
    const s = this.scanned();
    const wanted = this.objective();
    if (!s || !wanted || s.objectiveId === wanted) return null;
    const wantedName = this.store.objectiveById().get(wanted)?.name ?? 'the objective you opened';
    return `You scanned ${this.scannedName() ?? 'a different objective'}, not ${wantedName}. Capturing the one you scanned.`;
  });

  protected readonly backLink = computed(() => {
    const id = this.objective();
    return id ? liveLink(this.store.eventId(), 'objectives', id) : liveLink(this.store.eventId(), 'objectives');
  });

  protected readonly manualLink = computed(() => {
    const id = this.scanned()?.objectiveId ?? this.objective();
    const o = id ? this.store.objectiveById().get(id) : undefined;
    return o?.methods.includes('code') ? liveLink(this.store.eventId(), 'objectives', o.id) : liveLink(this.store.eventId(), 'objectives');
  });

  constructor() {
    afterNextRender(() => void this.startScanner());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.stopScanner();
    });
  }

  protected objectiveLink(id: string): string[] {
    return liveLink(this.store.eventId(), 'objectives', id);
  }

  private async startScanner(): Promise<void> {
    if (!this.isBrowser || this.destroyed) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.camState.set('unsupported');
      return;
    }
    this.handled = false;
    this.camState.set('starting');
    this.torchOn.set(false);
    try {
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
      const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, this.video().nativeElement, (result, _err, ctl) => {
        if (!result || this.handled) return;
        this.handled = true;
        ctl.stop();
        this.onDecoded(result.getText());
      });
      if (this.destroyed || this.handled) {
        controls.stop();
        return;
      }
      this.controls = controls;
      this.camState.set('scanning');
      try {
        const caps = controls.streamVideoCapabilitiesGet?.((t) => [t]) as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        this.torchSupported.set(!!caps?.torch && !!controls.switchTorch);
      } catch {
        this.torchSupported.set(false);
      }
    } catch (e) {
      const name = (e as { name?: string } | null)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') this.camState.set('denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') this.camState.set('nocamera');
      else if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') this.camState.set('busy');
      else this.camState.set('error');
    }
  }

  private stopScanner(): void {
    try {
      this.controls?.stop();
    } catch {
      /* already stopped */
    }
    this.controls = null;
    this.torchOn.set(false);
  }

  private onDecoded(text: string): void {
    this.controls = null;
    this.camState.set('decoded');
    vibrate(40);
    const parsed = parseObjectiveQr(text);
    if (!parsed) {
      this.scanError.set('This QR code is not an AirsoftHub objective code.');
      return;
    }
    if (parsed.eventId !== this.store.eventId()) {
      this.scanError.set('This code belongs to another event.');
      return;
    }
    this.scanned.set(parsed);
    void this.attempt.submit(parsed.objectiveId, { method: 'qr', qrPayload: parsed.raw });
  }

  protected retryCapture(): void {
    const s = this.scanned();
    if (s) void this.attempt.submit(s.objectiveId, { method: 'qr', qrPayload: s.raw });
  }

  protected scanAgain(): void {
    this.stopScanner();
    this.attempt.reset();
    this.scanError.set(null);
    this.scanned.set(null);
    void this.startScanner();
  }

  protected async toggleTorch(): Promise<void> {
    const next = !this.torchOn();
    try {
      await this.controls?.switchTorch?.(next);
      this.torchOn.set(next);
    } catch {
      this.torchSupported.set(false);
    }
  }
}
