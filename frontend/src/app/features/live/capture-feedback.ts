import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { formatNumber } from '../../core/util/format';
import { CaptureAttempt, captureErrorMessage } from './capture-attempt';

/**
 * Pending / success / failure panel for a capture attempt. The wrapper is a live region,
 * so screen readers hear "Checking…", then the server's answer.
 */
@Component({
  selector: 'zeus-capture-feedback',
  imports: [NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div aria-live="assertive" aria-atomic="true">
      @switch (attempt().state()) {
        @case ('pending') {
          <div class="panel flex items-center gap-3 border-warning/60 p-4" role="status">
            <ng-icon name="lucideLoader2" size="22" class="shrink-0 animate-spin text-warning" aria-hidden="true" />
            <div>
              <p class="font-bold" i18n>Checking with the server…</p>
              <p class="text-sm text-muted-foreground" i18n>Keep this screen open. Nothing is captured until the server confirms.</p>
            </div>
          </div>
        }
        @case ('success') {
          @if (attempt().result(); as r) {
            @if (r.captured) {
              <div class="rounded-md border-2 border-primary bg-primary/12 p-5 text-center">
                <p class="label-caps !text-primary" i18n>◆ Confirmed by the server</p>
                <p class="mt-1 text-2xl font-bold uppercase" style="font-stretch: 85%" i18n>Objective captured</p>
                @if (objectiveName()) {
                  <p class="mt-0.5 font-semibold">{{ objectiveName() }}</p>
                }
                <div class="mt-4 flex items-center justify-center gap-6">
                  <div>
                    <p class="num text-4xl font-bold text-primary">+{{ fmt(r.points) }}</p>
                    <p class="label-caps" i18n>points</p>
                  </div>
                  <div>
                    <p class="num text-4xl font-bold text-warning">+{{ fmt(r.currency) }}</p>
                    <p class="label-caps" i18n>credits</p>
                  </div>
                </div>
                <ng-content select="[success-actions]" />
              </div>
            } @else {
              <div class="panel border-warning/60 p-4">
                <p class="font-bold" i18n>◐ Code accepted — not captured yet</p>
                <p class="mt-1 text-sm text-muted-foreground" i18n>
                  The server accepted your attempt but the objective is not yours yet. Check the objective's status and conditions.
                </p>
                <ng-content select="[success-actions]" />
              </div>
            }
          }
        }
        @case ('error') {
          @if (attempt().error(); as err) {
            <div class="rounded-md border-2 border-destructive bg-destructive/10 p-4" role="alert">
              <p class="flex items-center gap-2 font-bold text-destructive">
                <ng-icon [name]="err.isNetwork ? 'lucideWifiOff' : 'lucideCircleAlert'" size="20" aria-hidden="true" />
                {{ err.isNetwork ? txt.notConfirmed : txt.notCaptured }}
              </p>
              <p class="mt-1 text-foreground">{{ message() }}</p>
              @if (attempt().retryable()) {
                <button hlmBtn type="button" class="mt-3 h-12 w-full" (click)="retry.emit()">
                  <ng-icon name="lucideRefreshCw" size="18" aria-hidden="true" /> <ng-container i18n>Try again</ng-container>
                </button>
              }
            </div>
          }
        }
      }
    </div>
  `,
})
export class CaptureFeedback {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    notConfirmed: $localize`Not confirmed`,
    notCaptured: $localize`Not captured`,
  };

  readonly attempt = input.required<CaptureAttempt>();
  readonly objectiveName = input<string | null>(null);
  readonly retry = output<void>();

  protected readonly fmt = formatNumber;
  protected readonly message = computed(() => {
    const err = this.attempt().error();
    return err ? captureErrorMessage(err) : '';
  });
}
