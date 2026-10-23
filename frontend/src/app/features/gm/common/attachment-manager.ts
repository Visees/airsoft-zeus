import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../../core/api/api.service';
import { ConfigService } from '../../../core/api/config.service';
import { EventAttachment } from '../../../core/api/models';
import { ConfirmService } from '../../../core/ui/confirm.service';
import { ToastService } from '../../../core/ui/toast.service';
import { formatBytes } from '../../../core/util/format';
import { ATTACHMENT_ACCEPT, ATTACHMENT_EXTENSIONS, MAX_ATTACHMENTS, attachmentIcon, attachmentKind } from '../../../shared/attachments';

interface QueuedFile {
  key: number;
  file: File;
  /** 0–1 while uploading, null while waiting */
  progress: number | null;
}

let nextKey = 0;

/**
 * Game Master side of the event attachments: upload, list, delete.
 * Without an event id (wizard, before the draft exists) files are kept here until
 * the parent calls `uploadPending(eventId)`.
 */
@Component({
  selector: 'ah-attachment-manager',
  imports: [NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel flex flex-col gap-3 p-4" aria-labelledby="att-h">
      <div>
        <h3 id="att-h" class="label-caps" i18n>Attachments · <span class="num">{{ items().length + queue().length }}</span></h3>
        <p class="mt-1 text-sm text-muted-foreground" i18n>
          Game book, briefing, maps or forms. Registered players can download them from the event page.
        </p>
      </div>

      @if (items().length || queue().length) {
        <ul class="flex flex-col divide-y divide-border rounded-sm border border-border">
          @for (a of items(); track a.id) {
            <li class="flex items-center gap-3 p-2 pl-3">
              <ng-icon [name]="icon(a.mimeType)" size="18" class="shrink-0 text-primary" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold" [title]="a.fileName">{{ a.fileName }}</span>
                <span class="block text-xs text-muted-foreground">{{ kind(a.mimeType) }} · <span class="num">{{ size(a.sizeBytes) }}</span></span>
              </span>
              @if (!readonly()) {
                <button hlmBtn variant="ghost" size="sm" class="h-11 text-destructive" type="button" [disabled]="deleting() === a.id" (click)="remove(a)" ariaLabel="Delete {{ a.fileName }}" i18n-ariaLabel>
                  <ng-icon name="lucideTrash2" size="16" aria-hidden="true" />
                </button>
              }
            </li>
          }
          @for (q of queue(); track q.key) {
            <li class="flex items-center gap-3 p-2 pl-3">
              <ng-icon name="lucidePaperclip" size="18" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold" [title]="q.file.name">{{ q.file.name }}</span>
                @if (q.progress !== null) {
                  <span class="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" ariaLabel="Uploading {{ q.file.name }}" i18n-ariaLabel aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="pct(q.progress)">
                    <span class="block h-full bg-primary transition-[width]" [style.width.%]="pct(q.progress)"></span>
                  </span>
                } @else {
                  <span class="block text-xs text-muted-foreground"><span class="num">{{ size(q.file.size) }}</span> · {{ eventId() ? txt.waiting : txt.uploadedWhenTheDraft }}</span>
                }
              </span>
              @if (!eventId()) {
                <button hlmBtn variant="ghost" size="sm" class="h-11" type="button" (click)="unqueue(q)" ariaLabel="Remove {{ q.file.name }}" i18n-ariaLabel>
                  <ng-icon name="lucideX" size="16" aria-hidden="true" />
                </button>
              }
            </li>
          }
        </ul>
      }

      @if (!readonly()) {
        <div class="flex flex-wrap items-center gap-2">
          <label
            class="tap inline-flex h-11 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium has-focus-visible:ring-2 has-focus-visible:ring-ring"
            [class]="full() || uploading() ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-muted'"
          >
            <ng-icon name="lucideUpload" size="16" aria-hidden="true" />
            {{ uploading() ? txt.uploading : txt.addFiles }}
            <input type="file" multiple class="sr-only" [accept]="accept" [disabled]="full() || uploading()" (change)="onPick($event)" />
          </label>
          <p class="text-xs text-muted-foreground" i18n>PDF, images, Word, Excel, PowerPoint or OpenDocument · up to {{ size(maxBytes()) }} each · max {{ max }} files</p>
        </div>
      }
    </section>
  `,
})
export class AttachmentManager {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    waiting: $localize`Waiting…`,
    uploadedWhenTheDraft: $localize`Uploaded when the draft is created`,
    uploading: $localize`Uploading…`,
    addFiles: $localize`Add files`,
  };

  private readonly api = inject(ApiService);
  private readonly config = inject(ConfigService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  /** null: the event does not exist yet; files wait for `uploadPending`. */
  readonly eventId = input<string | null>(null);
  readonly attachments = input<EventAttachment[]>([]);
  readonly readonly = input(false, { transform: booleanAttribute });
  readonly changed = output<void>();

  protected readonly items = linkedSignal(() => this.attachments());
  protected readonly queue = signal<QueuedFile[]>([]);
  protected readonly uploading = signal(false);
  protected readonly deleting = signal<string | null>(null);
  protected readonly maxBytes = computed(() => this.config.config().maxAttachmentBytes);
  protected readonly full = computed(() => this.items().length + this.queue().length >= MAX_ATTACHMENTS);

  protected readonly accept = ATTACHMENT_ACCEPT;
  protected readonly max = MAX_ATTACHMENTS;
  protected readonly icon = attachmentIcon;
  protected readonly kind = attachmentKind;
  protected readonly size = formatBytes;
  protected pct(p: number): number {
    return Math.round(p * 100);
  }

  constructor() {
    void this.config.load();
  }

  protected onPick(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const files = Array.from(el.files ?? []);
    el.value = '';
    const room = MAX_ATTACHMENTS - this.items().length - this.queue().length;
    const ok: File[] = [];
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ATTACHMENT_EXTENSIONS.includes(ext)) this.toast.error($localize`${f.name}:name:: file type not supported`, $localize`Use PDF, images or Office documents.`);
      else if (f.size > this.maxBytes()) this.toast.error($localize`${f.name}:name: is too large`, $localize`The limit is ${formatBytes(this.maxBytes())}:maxBytes: per file.`);
      else if (ok.length >= room) {
        this.toast.error($localize`An event can have at most ${MAX_ATTACHMENTS}:MAX_ATTACHMENTS: attachments.`);
        break;
      } else ok.push(f);
    }
    if (!ok.length) return;
    this.queue.update((q) => [...q, ...ok.map((file) => ({ key: nextKey++, file, progress: null }))]);
    const id = this.eventId();
    if (id) void this.uploadPending(id);
  }

  protected unqueue(q: QueuedFile): void {
    this.queue.update((list) => list.filter((x) => x.key !== q.key));
  }

  /** Uploads the waiting files one by one. Returns how many failed (each one is reported in a toast). */
  async uploadPending(eventId: string): Promise<number> {
    if (this.uploading()) return 0;
    this.uploading.set(true);
    let failed = 0;
    try {
      for (const q of [...this.queue()]) {
        const set = (progress: number) => this.queue.update((list) => list.map((x) => (x.key === q.key ? { ...x, progress } : x)));
        set(0);
        try {
          const a = await this.api.uploadAttachment(eventId, q.file, set);
          this.items.update((list) => [...list, a]);
        } catch (err) {
          failed++;
          this.toast.error(err, q.file.name);
        }
        this.unqueue(q);
      }
    } finally {
      this.uploading.set(false);
    }
    this.changed.emit();
    return failed;
  }

  protected async remove(a: EventAttachment): Promise<void> {
    const id = this.eventId();
    if (!id) return;
    const ok = await this.confirm.ask({
      title: $localize`Delete ${a.fileName}:fileName:?`,
      consequences: [$localize`Players can no longer download it.`, $localize`Copies they already downloaded stay on their phones.`],
      destructive: true,
      confirmLabel: $localize`Delete file`,
    });
    if (!ok) return;
    this.deleting.set(a.id);
    try {
      await this.api.deleteAttachment(id, a.id);
      this.items.update((list) => list.filter((x) => x.id !== a.id));
      this.changed.emit();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.deleting.set(null);
    }
  }
}
