import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { ApiService } from '../../core/api/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { SupportStatus, SupportTicketDetail } from '../../core/api/models';
import { ToastService } from '../../core/ui/toast.service';
import { formatDate, formatDateTime } from '../../core/util/format';
import { ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { StatusChip } from '../../shared/status-chip';
import { supportCategoryChip, supportStatusChip } from './support-ui';

/** One support conversation: messages, reply box, close/reopen. Route: /support/:ticketId */
@Component({
  selector: 'ah-support-thread-screen',
  imports: [ReactiveFormsModule, NgIcon, HlmButton, HlmLabel, HlmTextarea, PageHeader, LoadingSkeleton, ErrorState, StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <ah-page-header [eyebrow]="staff() ? txt.admin : txt.helpFeedback" title="Conversation" [back]="staff() ? '/admin/tickets' : '/support'" [backLabel]="staff() ? txt.allTickets : txt.allMessages" i18n-title />

      @if (loading()) {
        <ah-loading-skeleton [rows]="5" />
      } @else if (!ticket()) {
        <ah-error-state [error]="error()" (retry)="load()" />
      } @else {
        @let t = ticket()!;
        <h2 class="mb-2 text-xl font-bold break-words">{{ t.subject }}</h2>
        <div class="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <ah-status-chip [spec]="categoryChip()" />
          <ah-status-chip [spec]="statusChip()" />
          @if (staff() && t.userNickname) {
            <span i18n>· from <b class="text-foreground">{{ t.userNickname }}</b></span>
          }
          <span class="num">· {{ date(t.createdAt) }}</span>
        </div>

        @if (staff() && hasContext()) {
          <details class="panel mb-4 p-3 text-sm">
            <summary class="cursor-pointer font-semibold" i18n>Device details</summary>
            <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              @if (t.context.page) {
                <dt class="text-muted-foreground" i18n>Page</dt><dd class="num break-all">{{ t.context.page }}</dd>
              }
              @if (t.context.screen) {
                <dt class="text-muted-foreground" i18n>Screen</dt><dd class="num">{{ t.context.screen }}</dd>
              }
              @if (t.context.userAgent) {
                <dt class="text-muted-foreground" i18n>Browser</dt><dd class="num break-all">{{ t.context.userAgent }}</dd>
              }
            </dl>
          </details>
        }

        <ol class="flex flex-col gap-3" aria-label="Messages" i18n-aria-label>
          @for (m of t.messages; track m.id) {
            <li class="flex flex-col gap-1" [class.items-end]="mine(m.fromAdmin)" [class.items-start]="!mine(m.fromAdmin)">
              <div class="max-w-[85%] rounded-md border px-3 py-2"
                [class]="m.fromAdmin ? 'border-primary/40 bg-primary/10' : 'border-border bg-card'">
                <p class="whitespace-pre-line break-words leading-relaxed">{{ m.body }}</p>
              </div>
              <p class="flex items-center gap-1 px-1 text-xs text-muted-foreground">
                @if (m.fromAdmin) {
                  <ng-icon name="lucideLifeBuoy" size="12" class="text-primary" aria-hidden="true" />
                  <span class="font-semibold text-primary" i18n>AirsoftHub team</span>
                } @else {
                  <span class="font-semibold">{{ mine(false) ? txt.you : m.authorNickname || txt.player }}</span>
                }
                <span aria-hidden="true">·</span>
                <time [attr.datetime]="m.createdAt">{{ dateTime(m.createdAt) }}</time>
              </p>
            </li>
          }
        </ol>

        @if (!staff() && !auth.can('support')) {
          <p class="panel mt-6 p-3 text-sm text-muted-foreground" i18n>Messages to the team are turned off for your account.</p>
        } @else if (t.status === 'closed') {
          <div class="panel mt-6 flex flex-wrap items-center justify-between gap-3 p-3">
            <p class="text-sm text-muted-foreground" i18n>This conversation is closed.</p>
            <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="busy()" (click)="setStatus('open')" i18n>Reopen</button>
          </div>
        } @else {
          <!-- Plain (submit), not (ngSubmit): there is no [formGroup]/NgForm on this form to emit it. -->
          <form class="mt-6 flex flex-col gap-2" (submit)="$event.preventDefault(); send()" novalidate>
            <label hlmLabel for="sup-reply">{{ staff() ? txt.answer : txt.addAMessage }}</label>
            <textarea hlmTextarea id="sup-reply" [formControl]="reply" rows="4" maxlength="5000"
              [placeholder]="staff() ? txt.thePlayerGetsA : txt.moreDetailsAFollow"></textarea>
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button hlmBtn variant="ghost" type="button" class="h-11 text-muted-foreground" [disabled]="busy()" (click)="setStatus('closed')">
                <ng-icon name="lucideCheck" size="16" aria-hidden="true" /> {{ staff() ? txt.close : txt.solvedCloseIt }}
              </button>
              <button hlmBtn type="submit" class="h-12 sm:h-10" [disabled]="busy() || reply.invalid">
                <ng-icon name="lucideSend" size="16" aria-hidden="true" /> {{ busy() ? txt.sending : txt.send }}
              </button>
            </div>
          </form>
        }
      }
    </div>
  `,
})
export class SupportThreadScreen {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    you: $localize`You`,
    player: $localize`Player`,
    answer: $localize`Answer`,
    addAMessage: $localize`Add a message`,
    close: $localize`Close`,
    solvedCloseIt: $localize`Solved, close it`,
    sending: $localize`Sending…`,
    send: $localize`Send`,
    admin: $localize`Admin`,
    helpFeedback: $localize`Help & feedback`,
    allTickets: $localize`All tickets`,
    allMessages: $localize`All messages`,
    thePlayerGetsA: $localize`The player gets a notification with your answer.`,
    moreDetailsAFollow: $localize`More details, a follow-up, a thank you…`,
  };

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  readonly ticketId = input.required<string>();

  protected readonly ticket = signal<SupportTicketDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<unknown>(null);
  protected readonly reply = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(5000)] });

  protected readonly staff = computed(() => !!this.ticket()?.asStaff);
  protected readonly categoryChip = computed(() => supportCategoryChip(this.ticket()!.category));
  protected readonly statusChip = computed(() => supportStatusChip(this.ticket()!.status, this.staff()));
  protected readonly hasContext = computed(() => Object.values(this.ticket()?.context ?? {}).some(Boolean));
  protected readonly date = formatDate;
  protected readonly dateTime = formatDateTime;

  constructor() {
    effect(() => {
      this.ticketId();
      untracked(() => void this.load());
    });
  }

  /** Messages written by the viewer's side go on the right. */
  protected mine(fromAdmin: boolean): boolean {
    return fromAdmin === this.staff();
  }

  protected async load(): Promise<void> {
    this.loading.set(!this.ticket());
    this.error.set(null);
    try {
      this.ticket.set(await this.api.supportTicket(this.ticketId()));
    } catch (e) {
      this.ticket.set(null);
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  protected async send(): Promise<void> {
    if (this.reply.invalid) return;
    this.busy.set(true);
    try {
      this.ticket.set(await this.api.replySupportTicket(this.ticketId(), this.reply.value.trim()));
      this.reply.reset();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async setStatus(status: SupportStatus): Promise<void> {
    this.busy.set(true);
    try {
      this.ticket.set(await this.api.setSupportStatus(this.ticketId(), status));
      this.toast.success(status === 'closed' ? $localize`Conversation closed` : $localize`Conversation reopened`);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
