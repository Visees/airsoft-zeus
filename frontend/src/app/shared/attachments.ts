import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../core/api/api.service';
import { EventAttachment } from '../core/api/models';
import { ToastService } from '../core/ui/toast.service';
import { downloadBlob, formatBytes } from '../core/util/format';

/** File types the server accepts for event attachments (it checks the real content too). */
export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,.odt,.ods,.odp';
export const ATTACHMENT_EXTENSIONS = ATTACHMENT_ACCEPT.split(',').map((e) => e.slice(1));
export const MAX_ATTACHMENTS = 20;

export function attachmentIcon(mime: string): string {
  if (mime.startsWith('image/')) return 'lucideFileImage';
  if (mime.includes('spreadsheet')) return 'lucideFileSpreadsheet';
  return 'lucideFileText';
}

export function attachmentKind(mime: string): string {
  if (mime === 'application/pdf') return $localize`PDF`;
  if (mime.startsWith('image/')) return $localize`Image`;
  if (mime.includes('spreadsheet')) return $localize`Spreadsheet`;
  if (mime.includes('presentation')) return $localize`Presentation`;
  return $localize`Document`;
}

/** Event documents with download buttons, for the people taking part. */
@Component({
  selector: 'zeus-attachment-list',
  imports: [NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="panel divide-y divide-border">
      @for (a of attachments(); track a.id) {
        <li class="flex items-center gap-3 p-3">
          <ng-icon [name]="icon(a.mimeType)" size="20" class="shrink-0 text-primary" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold" [title]="a.fileName">{{ a.fileName }}</span>
            <span class="block text-xs text-muted-foreground">{{ kind(a.mimeType) }} · <span class="num">{{ size(a.sizeBytes) }}</span></span>
          </span>
          <button hlmBtn variant="outline" class="tap shrink-0" type="button" [disabled]="downloading() === a.id" (click)="download(a)" ariaLabel="Download {{ a.fileName }}" i18n-ariaLabel>
            <ng-icon [name]="downloading() === a.id ? 'lucideLoader2' : 'lucideDownload'" size="16" [class.animate-spin]="downloading() === a.id" aria-hidden="true" />
            <span class="hidden sm:inline">{{ downloading() === a.id ? txt.downloading : txt.download }}</span>
          </button>
        </li>
      }
    </ul>
  `,
})
export class AttachmentList {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    downloading: $localize`Downloading…`,
    download: $localize`Download`,
  };

  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly eventId = input.required<string>();
  readonly attachments = input.required<EventAttachment[]>();

  protected readonly downloading = signal<string | null>(null);
  protected readonly icon = attachmentIcon;
  protected readonly kind = attachmentKind;
  protected readonly size = formatBytes;

  protected async download(a: EventAttachment): Promise<void> {
    this.downloading.set(a.id);
    try {
      downloadBlob(await this.api.downloadAttachment(this.eventId(), a.id), a.fileName);
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.downloading.set(null);
    }
  }
}
