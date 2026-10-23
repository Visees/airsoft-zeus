import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { ApiService } from '../../core/api/api.service';
import { ApiError } from '../../core/api/api-error';
import { News, NewsCategory, NewsInput } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ConfirmService } from '../../core/ui/confirm.service';
import { ToastService } from '../../core/ui/toast.service';
import { fromLocalInput, toLocalInput } from '../../core/util/format';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../../shared/states';
import { applyServerErrors, controlError } from '../gm/ops/forms';
import { NEWS_CATEGORY_LABELS, newsState } from './news-ui';

const SELECT_CLASS = 'h-11 w-full rounded-md border border-input bg-transparent px-2 dark:bg-input/30';
type PublishMode = 'draft' | 'now' | 'schedule';

/** News editor (platform admins). Route: /news/:newsId/edit ('new' allowed). */
@Component({
  selector: 'ah-news-editor-screen',
  imports: [ReactiveFormsModule, NgIcon, HlmButton, HlmInput, HlmLabel, HlmTextarea, PageHeader, LoadingSkeleton, ErrorState, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    <div class="page-narrow">
      <ah-page-header eyebrow="News" [title]="isNew() ? txt.writeNews : txt.editNews" [back]="backUrl()" i18n-eyebrow />

      @if (!isEditor()) {
        <ah-empty-state icon="lucideLock" title="News editors only" message="Only the AirsoftHub team and the News editors can write News." i18n-title i18n-message />
      } @else if (loading()) {
        <ah-loading-skeleton [rows]="6" />
      } @else if (loadError()) {
        <ah-error-state [error]="loadError()" (retry)="load()" />
      } @else {
        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-6" novalidate>
          <section class="panel flex flex-col gap-4 p-4" aria-labelledby="h-news-content">
            <h2 id="h-news-content" class="label-caps" i18n>Content</h2>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="n-title"><ng-container i18n>Title</ng-container> <span aria-hidden="true">*</span></label>
              <input hlmInput id="n-title" formControlName="title" class="h-11" maxlength="140" autocomplete="off" />
              @if (e('title', fieldLabels.title); as m) {
                <p class="field-error">{{ m }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="n-cat" i18n>Category</label>
              <select id="n-cat" formControlName="category" [class]="selectClass">
                @for (c of categories; track c) {
                  <option [value]="c">{{ categoryLabels[c] }}</option>
                }
              </select>
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="n-summary" i18n>Summary</label>
              <textarea hlmTextarea id="n-summary" formControlName="summary" rows="2" maxlength="300"></textarea>
              <p class="text-sm text-muted-foreground" i18n>One or two sentences, shown on the home page card.</p>
              @if (e('summary', fieldLabels.summary); as m) {
                <p class="field-error">{{ m }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="n-body" i18n>Text</label>
              <textarea hlmTextarea id="n-body" formControlName="body" rows="10"></textarea>
              <p class="text-sm text-muted-foreground" i18n>Leave an empty line between paragraphs.</p>
              @if (e('body', fieldLabels.text); as m) {
                <p class="field-error">{{ m }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <span hlmLabel id="lbl-news-img" i18n>Image</span>
              @if (value().imageUrl) {
                <img [src]="value().imageUrl" alt="News image" class="aspect-video w-full rounded-md border border-border object-cover" i18n-alt />
                <button hlmBtn type="button" variant="outline" class="h-10" (click)="form.controls.imageUrl.setValue(null)" i18n>Remove image</button>
              } @else {
                <label class="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input text-sm hover:bg-muted">
                  <ng-icon name="lucideImage" size="16" aria-hidden="true" />
                  {{ uploading() ? txt.uploading : txt.uploadImage }}
                  <input type="file" accept="image/*" class="sr-only" aria-labelledby="lbl-news-img" (change)="upload($event)" [disabled]="uploading()" />
                </label>
              }
            </div>
          </section>

          <section class="panel flex flex-col gap-4 p-4" aria-labelledby="h-news-link">
            <h2 id="h-news-link" class="label-caps" i18n>Button</h2>
            <p class="text-sm text-muted-foreground" i18n>Optional: a sponsor's website, a sign-up page, or an app page like <span class="num">/events/discover</span>.</p>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="n-link" i18n>Link</label>
              <input hlmInput id="n-link" formControlName="linkUrl" class="h-11" maxlength="500" placeholder="https://…" autocomplete="off" inputmode="url" />
              @if (e('linkUrl', fieldLabels.link); as m) {
                <p class="field-error">{{ m }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label hlmLabel for="n-link-label" i18n>Button text</label>
              <input hlmInput id="n-link-label" formControlName="linkLabel" class="h-11" maxlength="40" placeholder="Open link" autocomplete="off" i18n-placeholder />
            </div>
          </section>

          <section class="panel flex flex-col gap-4 p-4" aria-labelledby="h-news-pub">
            <h2 id="h-news-pub" class="label-caps" i18n>Publishing</h2>
            <fieldset class="flex flex-col gap-2">
              <legend class="sr-only" i18n>When to publish</legend>
              @for (m of modes; track m.value) {
                <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3" [class.border-primary]="value().mode === m.value">
                  <input type="radio" formControlName="mode" [value]="m.value" class="size-4 accent-primary" />
                  <span class="flex flex-col">
                    <span class="font-semibold">{{ m.label }}</span>
                    <span class="text-sm text-muted-foreground">{{ m.hint }}</span>
                  </span>
                </label>
              }
            </fieldset>
            @if (value().mode === 'schedule') {
              <div class="flex flex-col gap-1.5">
                <label hlmLabel for="n-at" i18n>Publish at</label>
                <input hlmInput id="n-at" type="datetime-local" formControlName="publishAt" class="h-11" />
                @if (e('publishAt', fieldLabels.date); as m) {
                  <p class="field-error">{{ m }}</p>
                }
              </div>
            }
            <label class="flex min-h-11 cursor-pointer items-center gap-3">
              <input type="checkbox" formControlName="pinned" class="size-4 accent-primary" />
              <span class="flex flex-col">
                <span class="font-semibold" i18n>Pin to the top</span>
                <span class="text-sm text-muted-foreground" i18n>Pinned news stays first on the home page.</span>
              </span>
            </label>
          </section>

          <div class="hud sticky bottom-[calc(4.5rem+var(--safe-bottom))] z-10 flex flex-wrap items-center gap-2 p-2 lg:bottom-3">
            <p class="min-w-0 flex-1 px-1 text-sm" role="status" aria-live="polite">{{ statusText() }}</p>
            @if (!isNew()) {
              <button hlmBtn type="button" variant="destructive" class="h-11" (click)="remove()" [disabled]="saving()">
                <ng-icon name="lucideTrash2" size="16" aria-hidden="true" /> <ng-container i18n>Delete</ng-container>
              </button>
            }
            <button hlmBtn type="submit" class="h-11" [disabled]="saving()">{{ saving() ? txt.saving : submitLabel() }}</button>
          </div>
        </form>
      }
    </div>
  `,
})
export class NewsEditorScreen {
  /** Field names shown in validation messages. */
  protected readonly fieldLabels = {
    title: $localize`Title`,
    summary: $localize`Summary`,
    text: $localize`Text`,
    link: $localize`Link`,
    date: $localize`Date`,
  };

  /** UI text used inside template expressions. */
  protected readonly txt = {
    uploading: $localize`Uploading…`,
    uploadImage: $localize`Upload image`,
    saving: $localize`Saving…`,
    writeNews: $localize`Write news`,
    editNews: $localize`Edit news`,
  };

  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly newsId = input.required<string>();

  protected readonly selectClass = SELECT_CLASS;
  protected readonly categories = Object.keys(NEWS_CATEGORY_LABELS) as NewsCategory[];
  protected readonly categoryLabels = NEWS_CATEGORY_LABELS;
  protected readonly modes: { value: PublishMode; label: string; hint: string }[] = [
    { value: 'draft', label: $localize`Draft`, hint: $localize`Only admins can see it.` },
    { value: 'now', label: $localize`Published`, hint: $localize`Everyone sees it on the home page.` },
    { value: 'schedule', label: $localize`Scheduled`, hint: $localize`Appears automatically at the chosen time.` },
  ];

  protected readonly loading = signal(true);
  protected readonly loadError = signal<unknown>(null);
  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly dirty = signal(false);
  protected readonly news = signal<News | null>(null);
  private patching = false;

  /** News editor: platform admins and users with the manage_news feature. */
  protected readonly isEditor = computed(() => this.auth.can('manage_news'));
  protected readonly isNew = computed(() => this.newsId() === 'new');
  protected readonly backUrl = computed(() => (this.isNew() ? '/admin/news' : `/news/${this.newsId()}`));

  protected readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(140)] }),
    category: new FormControl<NewsCategory>('update', { nonNullable: true }),
    summary: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
    body: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(20_000)] }),
    imageUrl: new FormControl<string | null>(null),
    linkUrl: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500), Validators.pattern(/^(\/(?!\/)|https?:\/\/).*/i)] }),
    linkLabel: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    pinned: new FormControl(false, { nonNullable: true }),
    mode: new FormControl<PublishMode>('now', { nonNullable: true }),
    publishAt: new FormControl('', { nonNullable: true }),
  });
  protected readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly submitLabel = computed(() => {
    const m = this.value().mode;
    return m === 'draft' ? $localize`Save draft` : m === 'schedule' ? $localize`Schedule` : this.isNew() || this.news()?.publishedAt === null ? $localize`Publish` : $localize`Save`;
  });
  protected readonly statusText = computed(() =>
    this.saving() ? $localize`Saving…` : this.dirty() ? $localize`Unsaved changes` : this.isNew() ? $localize`New, not saved yet` : $localize`No changes`,
  );

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (!this.patching) this.dirty.set(true);
    });
    effect(() => {
      this.newsId();
      if (!this.isEditor()) return;
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const n = this.isNew() ? null : await this.api.newsItem(this.newsId());
      this.news.set(n);
      this.fill(n);
    } catch (e) {
      this.loadError.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  private fill(n: News | null): void {
    this.patching = true;
    const state = n ? newsState(n) : 'published';
    this.form.reset({
      title: n?.title ?? '',
      category: n?.category ?? 'update',
      summary: n?.summary ?? '',
      body: n?.body ?? '',
      imageUrl: n?.imageUrl ?? null,
      linkUrl: n?.linkUrl ?? '',
      linkLabel: n?.linkLabel ?? '',
      pinned: n?.pinned ?? false,
      mode: state === 'draft' ? 'draft' : state === 'scheduled' ? 'schedule' : 'now',
      publishAt: state === 'scheduled' ? toLocalInput(n!.publishedAt) : '',
    });
    this.patching = false;
    this.dirty.set(false);
  }

  protected e(path: string, label: string): string | null {
    const ctrl = this.form.get(path);
    if (path === 'linkUrl' && ctrl?.errors?.['pattern'] && (ctrl.touched || ctrl.dirty)) return $localize`Use a full https:// address or an app path like /events/discover.`;
    return controlError(ctrl, label);
  }

  protected async upload(ev: Event): Promise<void> {
    const el = ev.target as HTMLInputElement;
    const file = el.files?.[0];
    if (!file) return;
    this.uploading.set(true);
    try {
      const res = await this.api.upload(file, 'news_image');
      this.form.controls.imageUrl.setValue(res.url);
      this.toast.success($localize`Image uploaded`, $localize`Save to keep it.`);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.uploading.set(false);
      el.value = '';
    }
  }

  protected onBeforeUnload(ev: BeforeUnloadEvent): void {
    if (this.dirty()) ev.preventDefault();
  }

  /** Keep the original publication date when re-saving something already published. */
  private publishedAt(mode: PublishMode, at: string): string | null {
    if (mode === 'draft') return null;
    if (mode === 'schedule') return fromLocalInput(at);
    const cur = this.news();
    return cur && cur.publishedAt && newsState(cur) === 'published' ? cur.publishedAt : new Date().toISOString();
  }

  async save(): Promise<void> {
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    if (v.mode === 'schedule') {
      const at = fromLocalInput(v.publishAt);
      if (!at) this.form.controls.publishAt.setErrors({ message: $localize`Choose when to publish.` });
      else if (Date.parse(at) <= Date.now()) this.form.controls.publishAt.setErrors({ message: $localize`Choose a time in the future, or pick "Published".` });
    }
    if (this.form.invalid) return;
    const body: NewsInput = {
      title: v.title.trim(),
      category: v.category,
      summary: v.summary.trim(),
      body: v.body,
      imageUrl: v.imageUrl,
      linkUrl: v.linkUrl.trim() || null,
      linkLabel: v.linkLabel.trim() || null,
      pinned: v.pinned,
      publishedAt: this.publishedAt(v.mode, v.publishAt),
    };
    this.saving.set(true);
    try {
      const saved = this.isNew() ? await this.api.createNews(body) : await this.api.updateNews(this.newsId(), body);
      this.news.set(saved);
      this.dirty.set(false);
      const state = newsState(saved);
      this.toast.success(state === 'draft' ? $localize`Draft saved` : state === 'scheduled' ? $localize`News scheduled` : $localize`News published`);
      await this.router.navigate(['/news', saved.id], { replaceUrl: this.isNew() });
    } catch (e) {
      const err = ApiError.from(e);
      const rest = applyServerErrors(this.form, err, { publishedAt: 'publishAt' });
      this.toast.error(err, rest.join(' ') || undefined);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const n = this.news();
    if (!n) return;
    const ok = await this.confirm.ask({
      title: $localize`Delete "${n.title}:title:"?`,
      consequences: [$localize`It disappears from the home page and the News list.`, $localize`This cannot be undone.`],
      confirmLabel: $localize`Delete`,
      destructive: true,
    });
    if (!ok) return;
    try {
      await this.api.deleteNews(n.id);
      this.dirty.set(false);
      this.toast.success($localize`News deleted`);
      await this.router.navigateByUrl('/admin/news', { replaceUrl: true });
    } catch (e) {
      this.toast.error(e);
    }
  }
}
