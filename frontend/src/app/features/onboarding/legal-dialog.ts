import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ConfigService } from '../../core/api/config.service';
import { LegalDoc } from './legal-text';

/**
 * Full Terms / Privacy text in a native modal <dialog> (focus trap, Escape to close).
 * Full screen on phones, centred panel on wider screens. Call `open(doc)`.
 */
@Component({
  selector: 'zeus-legal-dialog',
  imports: [NgIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog {
      margin: 0;
      width: 100%;
      max-width: 100%;
      height: 100dvh;
      max-height: 100dvh;
      padding: 0;
    }
    @media (min-width: 640px) {
      dialog {
        margin: auto;
        max-width: 42rem;
        height: min(85dvh, 52rem);
        border-radius: var(--radius);
      }
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.6);
    }
  `,
  template: `
    <dialog #dlg class="border border-border bg-popover text-popover-foreground shadow-2xl" aria-labelledby="legal-title" (close)="doc.set(null)">
      @if (doc(); as d) {
        <div class="flex h-full flex-col">
          <header class="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-6" style="padding-top: calc(0.75rem + var(--safe-top))">
            <div>
              <p class="label-caps">Version <span class="num">{{ version() }}</span></p>
              <h2 id="legal-title" class="text-xl uppercase">{{ d.title }}</h2>
            </div>
            <button type="button" class="tap -mr-2 grid place-items-center rounded-sm hover:bg-muted" aria-label="Close" (click)="close()">
              <ng-icon name="lucideX" size="20" aria-hidden="true" />
            </button>
          </header>
          <div class="flex-1 overflow-y-auto px-4 py-4 sm:px-6" tabindex="0" aria-label="Document text">
            <section class="panel bg-muted/50 p-4" aria-labelledby="legal-summary">
              <h3 id="legal-summary" class="label-caps">In short</h3>
              <ul class="mt-2 flex flex-col gap-2 text-sm">
                @for (s of d.summary; track $index) {
                  <li class="flex gap-2"><span aria-hidden="true" class="text-primary">▸</span><span>{{ s }}</span></li>
                }
              </ul>
            </section>
            @for (sec of d.sections; track sec.heading) {
              <section class="mt-5">
                <h3 class="text-base uppercase">{{ sec.heading }}</h3>
                @for (p of sec.paragraphs; track $index) {
                  <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{{ p }}</p>
                }
              </section>
            }
          </div>
          <footer class="border-t border-border px-4 py-3 sm:px-6" style="padding-bottom: calc(0.75rem + var(--safe-bottom))">
            <button hlmBtn type="button" class="h-11 w-full sm:w-auto" (click)="close()">Close</button>
          </footer>
        </div>
      }
    </dialog>
  `,
})
export class LegalDialog {
  private readonly config = inject(ConfigService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly doc = signal<LegalDoc | null>(null);
  protected readonly version = computed(() => {
    const d = this.doc();
    if (!d) return '';
    return d.id === 'terms' ? this.config.config().termsVersion : this.config.config().privacyVersion;
  });

  open(doc: LegalDoc): void {
    this.doc.set(doc);
    const el = this.dlg().nativeElement;
    if (!el.open) el.showModal();
  }

  close(): void {
    this.dlg().nativeElement.close();
  }
}
