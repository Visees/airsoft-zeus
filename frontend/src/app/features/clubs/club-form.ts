import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { ApiError } from '../../core/api/api-error';
import { ApiService } from '../../core/api/api.service';
import { ConfigService } from '../../core/api/config.service';
import { Club } from '../../core/api/models';
import { applyServerErrors, fieldError, focusFirstInvalid } from '../auth/form-utils';
import { COMMON_COUNTRIES, countryOptions } from '../profile/countries';

const OTHER = '__other';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const URL_PATTERN = /^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]{2,}$/i;

/** Create / edit a club. Emits the saved club. */
@Component({
  selector: 'zeus-club-form',
  imports: [ReactiveFormsModule, NgIcon, HlmButton, HlmInput, HlmLabel, HlmTextarea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="flex flex-col gap-4">
      @if (formError()) {
        <p class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">{{ formError() }}</p>
      }

      <div class="flex flex-wrap items-center gap-4">
        <div class="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted">
          @if (logoPreview() ?? form.controls.logoUrl.value; as src) {
            <img [src]="src" alt="Club logo" class="size-full object-cover" />
          } @else {
            <ng-icon name="lucideShield" size="28" class="text-muted-foreground" aria-hidden="true" />
          }
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <span class="label-caps">Logo</span>
          <div class="flex flex-wrap gap-2">
            <button hlmBtn variant="outline" type="button" class="h-11" [disabled]="uploading()" (click)="file.click()">
              @if (uploading()) {
                <ng-icon name="lucideLoader2" size="16" class="animate-spin" aria-hidden="true" /> Uploading…
              } @else {
                <ng-icon name="lucideUpload" size="16" aria-hidden="true" /> {{ form.controls.logoUrl.value ? 'Change logo' : 'Upload logo' }}
              }
            </button>
          </div>
          <input #file type="file" class="sr-only" accept="image/jpeg,image/png,image/webp" tabindex="-1" aria-hidden="true" (change)="onFile($event)" />
          <p class="text-xs" [class.text-destructive]="logoError()" [class.text-muted-foreground]="!logoError()" aria-live="polite">
            {{ logoError() ?? 'Square JPG, PNG or WebP, up to ' + maxLabel() + '.' }}
          </p>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label hlmLabel for="cf-name">Club name</label>
        <input hlmInput id="cf-name" class="h-11" formControlName="name" maxlength="100" autocomplete="organization"
          [attr.aria-invalid]="!!err('name')" [attr.aria-describedby]="err('name') ? 'cf-name-err' : null" />
        @if (err('name'); as e) { <p id="cf-name-err" class="field-error">{{ e }}</p> }
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="cf-country">Country</label>
          <select id="cf-country" formControlName="country" class="h-11 w-full rounded-md border border-input bg-transparent px-2.5 dark:bg-input/30">
            <option value="">Not set</option>
            @for (c of countries; track c.code) {
              <option [value]="c.code">{{ c.name }}</option>
            }
            <option [value]="other">Other…</option>
          </select>
        </div>
        @if (form.controls.country.value === other) {
          <div class="flex flex-col gap-1.5">
            <label hlmLabel for="cf-country-other">Country name</label>
            <input hlmInput id="cf-country-other" class="h-11" formControlName="countryOther" maxlength="60" />
          </div>
        }
        <div class="flex flex-col gap-1.5">
          <label hlmLabel for="cf-city">City or area</label>
          <input hlmInput id="cf-city" class="h-11" formControlName="city" maxlength="80" autocomplete="address-level2" [attr.aria-invalid]="!!err('city')" />
          @if (err('city'); as e) { <p class="field-error">{{ e }}</p> }
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label hlmLabel for="cf-web">Website <span class="font-normal text-muted-foreground">(optional)</span></label>
        <input hlmInput id="cf-web" type="url" class="h-11" formControlName="website" inputmode="url" autocapitalize="off" placeholder="https://example.com"
          [attr.aria-invalid]="!!err('website')" [attr.aria-describedby]="err('website') ? 'cf-web-err' : null" />
        @if (err('website'); as e) { <p id="cf-web-err" class="field-error">{{ e }}</p> }
      </div>

      <div class="flex flex-col gap-1.5">
        <label hlmLabel for="cf-desc">About the club</label>
        <textarea hlmTextarea id="cf-desc" formControlName="description" rows="4" maxlength="2000"
          placeholder="Where you play, how often, and whether you take new players" aria-describedby="cf-desc-count"></textarea>
        <p id="cf-desc-count" class="text-right text-xs text-muted-foreground"><span class="num">{{ descLength() }}</span>/2000</p>
      </div>

      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button hlmBtn type="button" variant="ghost" class="h-11" (click)="cancel.emit()">Cancel</button>
        <button hlmBtn type="submit" class="h-11 min-w-32" [disabled]="saving() || uploading()">
          {{ saving() ? 'Saving…' : club() ? 'Save club' : 'Create club' }}
        </button>
      </div>
    </form>
  `,
})
export class ClubForm implements OnInit {
  private readonly api = inject(ApiService);
  private readonly config = inject(ConfigService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** null = create */
  readonly club = input<Club | null>(null);
  readonly saved = output<Club>();
  readonly cancel = output<void>();

  protected readonly other = OTHER;
  protected readonly countries = countryOptions();
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2), Validators.maxLength(100)] }),
    country: new FormControl('', { nonNullable: true }),
    countryOther: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    website: new FormControl('', { nonNullable: true, validators: [Validators.pattern(URL_PATTERN), Validators.maxLength(300)] }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(2000)] }),
    logoUrl: new FormControl<string | null>(null),
  });
  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly logoError = signal<string | null>(null);
  protected readonly logoPreview = signal<string | null>(null);
  private readonly descTick = signal(0);
  protected readonly descLength = computed(() => {
    this.descTick();
    return this.form.controls.description.value.length;
  });
  protected readonly maxLabel = computed(() => `${Math.round(this.config.config().maxUploadBytes / (1024 * 1024))} MB`);

  constructor() {
    this.form.controls.description.valueChanges.subscribe(() => this.descTick.update((n) => n + 1));
    inject(DestroyRef).onDestroy(() => {
      const p = this.logoPreview();
      if (p) URL.revokeObjectURL(p);
    });
  }

  ngOnInit(): void {
    const c = this.club();
    if (!c) return;
    const known = !!c.country && (COMMON_COUNTRIES as readonly string[]).includes(c.country.toUpperCase());
    this.form.reset({
      name: c.name,
      country: !c.country ? '' : known ? c.country.toUpperCase() : OTHER,
      countryOther: c.country && !known ? c.country : '',
      city: c.city ?? '',
      website: c.website ?? '',
      description: c.description ?? '',
      logoUrl: c.logoUrl,
    });
  }

  protected err(name: 'name' | 'city' | 'website'): string | null {
    return fieldError(this.form.controls[name], {
      pattern: 'Enter a web address like https://example.com.',
      minlength: 'Use at least 2 characters.',
      required: 'Give the club a name.',
    });
  }

  protected async onFile(ev: Event): Promise<void> {
    const el = ev.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    this.logoError.set(null);
    if (!IMAGE_TYPES.includes(file.type)) return this.logoError.set('Use a JPG, PNG or WebP image.');
    if (file.size > this.config.config().maxUploadBytes) {
      return this.logoError.set(`This image is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${this.maxLabel()}.`);
    }
    const old = this.logoPreview();
    if (old) URL.revokeObjectURL(old);
    this.logoPreview.set(URL.createObjectURL(file));
    this.uploading.set(true);
    try {
      const { url } = await this.api.upload(file, 'club_logo');
      this.form.controls.logoUrl.setValue(url);
      this.form.markAsDirty();
    } catch (e) {
      this.logoError.set(ApiError.from(e).message);
      const p = this.logoPreview();
      if (p) URL.revokeObjectURL(p);
      this.logoPreview.set(null);
    } finally {
      this.uploading.set(false);
    }
  }

  protected async submit(): Promise<void> {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      queueMicrotask(() => focusFirstInvalid(this.host.nativeElement));
      return;
    }
    const v = this.form.getRawValue();
    const site = v.website.trim();
    const body: Partial<Club> = {
      name: v.name.trim(),
      country: v.country === OTHER ? v.countryOther.trim() || null : v.country || null,
      city: v.city.trim() || null,
      website: site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : null,
      description: v.description.trim() || null,
      logoUrl: v.logoUrl,
    };
    this.saving.set(true);
    try {
      const c = this.club();
      const result = c ? await this.api.updateClub(c.id, body) : await this.api.createClub(body);
      this.form.markAsPristine();
      this.saved.emit(result);
    } catch (e) {
      const err = ApiError.from(e);
      const unmatched = applyServerErrors(this.form, err);
      this.formError.set(Object.keys(err.fields).length ? (unmatched[0] ?? 'Check the highlighted fields.') : err.message);
      queueMicrotask(() => focusFirstInvalid(this.host.nativeElement));
    } finally {
      this.saving.set(false);
    }
  }
}
