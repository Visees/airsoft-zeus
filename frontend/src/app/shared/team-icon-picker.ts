import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, output, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiError } from '../core/api/api-error';
import { ApiService } from '../core/api/api.service';
import { ConfigService } from '../core/api/config.service';
import { formatDecimal } from '../core/util/format';
import { TEAM_ICONS, isUploadedIcon } from './team-badge';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Team or squad icon: one of the built-in icons, or an uploaded logo. Emits the new value (an icon
 * name, the uploaded file's URL, or '' for none) and leaves saving to the parent form.
 */
@Component({
  selector: 'ah-team-icon-picker',
  imports: [NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-1.5' },
  template: `
    <div role="radiogroup" [attr.aria-labelledby]="labelledBy()" class="flex flex-wrap gap-1.5">
      @if (allowNone()) {
        <label class="grid h-11 cursor-pointer place-items-center rounded-sm border px-2.5 text-xs has-focus-visible:ring-2 has-focus-visible:ring-ring" [class]="!value() ? on : off">
          <input type="radio" class="sr-only" [name]="name()" [checked]="!value()" (change)="picked.emit('')" />
          <ng-container i18n>None</ng-container>
        </label>
      }
      @for (i of icons; track i.value) {
        <label class="grid size-11 cursor-pointer place-items-center rounded-sm border has-focus-visible:ring-2 has-focus-visible:ring-ring" [class]="value() === i.value ? on : off">
          <input type="radio" class="sr-only" [name]="name()" [checked]="value() === i.value" (change)="picked.emit(i.value)" [attr.aria-label]="i.label" />
          <ng-icon [name]="i.icon" size="18" aria-hidden="true" />
        </label>
      }
      @if (logo(); as src) {
        <label class="grid size-11 cursor-pointer place-items-center rounded-sm border has-focus-visible:ring-2 has-focus-visible:ring-ring" [class]="value() === src ? on : off">
          <input type="radio" class="sr-only" [name]="name()" [checked]="value() === src" (change)="picked.emit(src)" [attr.aria-label]="txt.uploadedLogo" />
          <img [src]="src" alt="" class="size-8 rounded-[3px] object-cover" />
        </label>
      }
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="uploading()" (click)="file.click()">
        @if (uploading()) {
          <ng-icon name="lucideLoader2" size="16" class="animate-spin" aria-hidden="true" /> <ng-container i18n>Uploading…</ng-container>
        } @else {
          <ng-icon name="lucideUpload" size="16" aria-hidden="true" /> {{ logo() ? txt.changeLogo : txt.uploadLogo }}
        }
      </button>
      <input #file type="file" class="sr-only" accept="image/jpeg,image/png,image/webp" tabindex="-1" aria-hidden="true" (change)="onFile($event)" />
    </div>
    <p class="text-xs" [class.text-destructive]="error()" [class.text-muted-foreground]="!error()" aria-live="polite">
      @if (error(); as err) {
        {{ err }}
      } @else {
        <ng-container i18n>Square JPG, PNG or WebP, up to {{ maxLabel() }}.</ng-container>&ngsp;<ng-container i18n>Simple, high-contrast logos read best on the map.</ng-container>
      }
    </p>
  `,
})
export class TeamIconPicker {
  /** UI text used inside template expressions. */
  protected readonly txt = {
    uploadedLogo: $localize`Uploaded logo`,
    changeLogo: $localize`Change logo`,
    uploadLogo: $localize`Upload logo`,
  };

  private readonly api = inject(ApiService);
  private readonly config = inject(ConfigService);

  /** Icon name, uploaded logo URL, or '' (none). */
  readonly value = input.required<string>();
  /** Radio group name, unique on the page. */
  readonly name = input.required<string>();
  readonly labelledBy = input<string | null>(null);
  /** Squads can have no icon (they show their team's). */
  readonly allowNone = input(false, { transform: booleanAttribute });
  readonly picked = output<string>();

  protected readonly icons = TEAM_ICONS;
  protected readonly on = 'border-primary bg-primary/10 text-primary';
  protected readonly off = 'border-border text-muted-foreground';
  protected readonly uploading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The last logo uploaded here stays selectable after switching to a built-in icon. */
  private readonly uploaded = signal<string | null>(null);
  protected readonly logo = computed(() => (isUploadedIcon(this.value()) ? this.value() : this.uploaded()));
  protected readonly maxLabel = computed(() => `${Math.round(this.config.config().maxUploadBytes / (1024 * 1024))} MB`);

  protected async onFile(ev: Event): Promise<void> {
    const el = ev.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    this.error.set(null);
    if (!IMAGE_TYPES.includes(file.type)) return this.error.set($localize`Use a JPG, PNG or WebP image.`);
    if (file.size > this.config.config().maxUploadBytes) {
      return this.error.set($localize`This image is ${formatDecimal(file.size / (1024 * 1024), 1)}:size: MB. The limit is ${this.maxLabel()}:limit:.`);
    }
    this.uploading.set(true);
    try {
      const { url } = await this.api.upload(file, 'team_icon');
      this.uploaded.set(url);
      this.picked.emit(url);
    } catch (e) {
      this.error.set(ApiError.from(e).message);
    } finally {
      this.uploading.set(false);
    }
  }
}
