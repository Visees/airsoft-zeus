import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiService } from '../../core/api/api.service';
import { MeUser } from '../../core/api/models';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { PageHeader } from '../../shared/states';
import { SwitchRow } from './switch-row';

const RETENTION_OPTIONS = [
  { days: 7, label: '7 days', hint: 'Shortest. Enough for the Game Master to check a disputed capture after the game.' },
  { days: 30, label: '30 days', hint: 'Recommended. Covers late disputes and incident reviews.' },
  { days: 90, label: '90 days', hint: 'Longest. Useful if you want to review your own routes later via data export.' },
];

@Component({
  selector: 'zeus-privacy-settings-screen',
  imports: [ReactiveFormsModule, RouterLink, NgIcon, HlmButton, PageHeader, SwitchRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-narrow">
      <zeus-page-header title="Privacy" back="/settings" backLabel="Settings" subtitle="Choose what other players and Game Masters can see." />

      <!-- Who sees what -->
      <section class="panel p-4" aria-labelledby="pv-who">
        <h2 id="pv-who" class="label-caps">Who sees what</h2>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <div class="rounded-md border border-border p-3">
            <p class="flex items-center gap-2 font-semibold"><ng-icon name="lucideUsers" size="16" aria-hidden="true" /> Other players</p>
            <ul class="mt-2 flex flex-col gap-1 text-sm">
              <li class="flex gap-2"><span aria-hidden="true" class="text-primary">✓</span>Nickname and avatar</li>
              <li class="flex gap-2"><span aria-hidden="true" class="text-primary">✓</span>Club, role, country, stats — only if turned on below</li>
              <li class="flex gap-2 text-muted-foreground"><span aria-hidden="true">✕</span>Never your name, email, date of birth or emergency contact</li>
            </ul>
          </div>
          <div class="rounded-md border border-border p-3">
            <p class="flex items-center gap-2 font-semibold"><ng-icon name="lucideShield" size="16" aria-hidden="true" /> Game Masters of your events</p>
            <ul class="mt-2 flex flex-col gap-1 text-sm">
              <li class="flex gap-2"><span aria-hidden="true" class="text-primary">✓</span>Everything other players see</li>
              <li class="flex gap-2"><span aria-hidden="true" class="text-primary">✓</span>Your precise location history in their event</li>
              <li class="flex gap-2"><span aria-hidden="true" class="text-primary">✓</span>Emergency contact — only if you share it</li>
              <li class="flex gap-2 text-muted-foreground"><span aria-hidden="true">✕</span>Never your email, name or date of birth</li>
            </ul>
          </div>
        </div>
        <p class="mt-3 text-sm text-muted-foreground">
          During a game, who sees your live position on the map is set by each event's rules (squad, team or an approximate area). The lobby shows them before the start.
        </p>
      </section>

      <form [formGroup]="form" (ngSubmit)="save()" class="mt-4 flex flex-col gap-4" novalidate>
        <!-- Public profile -->
        <section class="panel px-4 pt-3 pb-1" aria-labelledby="pv-profile">
          <h2 id="pv-profile" class="label-caps">Public profile</h2>
          <div class="divide-y divide-border">
            <zeus-switch-row formControlName="showClub" label="Show my club" description="On your profile and in the club's member list." />
            <zeus-switch-row formControlName="showRole" label="Show my player role" description="For example Medic or Squad leader. Game Masters may still see the role you pick for an event." />
            <zeus-switch-row formControlName="showCountry" label="Show my country" />
            <zeus-switch-row formControlName="showStats" label="Show my statistics and badges" description="Games played, captures, points and win rate." />
          </div>
        </section>

        <!-- Emergency contact -->
        <section class="panel px-4 pt-3 pb-1" aria-labelledby="pv-ec">
          <h2 id="pv-ec" class="label-caps">Emergency contact</h2>
          <div class="divide-y divide-border">
            <zeus-switch-row formControlName="emergencyContactEnabled" label="Use my emergency contact"
              description="Keep a contact on file for games. Turn off to keep it stored but unused." />
            <zeus-switch-row formControlName="shareEmergencyWithGm" label="Share with Game Masters of events I join"
              description="Only the Game Masters of events you are registered for see the name, phone and relation, so they can call if you are hurt." />
          </div>
          @if (!hasContact()) {
            <p class="mb-3 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              You have not added an emergency contact yet. <a routerLink="/profile/edit" class="font-semibold text-primary underline-offset-2 hover:underline">Add one in your profile</a>.
            </p>
          } @else if (formValue().shareEmergencyWithGm && !formValue().emergencyContactEnabled) {
            <p class="mb-3 text-sm text-warning">Sharing has no effect while “Use my emergency contact” is off.</p>
          }
        </section>

        <!-- Location retention -->
        <section class="panel p-4" aria-labelledby="pv-ret">
          <h2 id="pv-ret" class="label-caps">Location history</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Your precise positions from each game are visible only to that event's Game Masters and are deleted automatically after this period. Scores and captures stay with the results.
          </p>
          <fieldset class="mt-3">
            <legend class="sr-only">Keep my location history for</legend>
            <div class="flex flex-col gap-2">
              @for (o of retention; track o.days) {
                <label class="flex min-h-14 cursor-pointer items-start gap-3 rounded-md border p-3 has-focus-visible:ring-2 has-focus-visible:ring-ring"
                  [class]="formValue().locationRetentionDays === o.days ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/60'">
                  <input type="radio" formControlName="locationRetentionDays" [value]="o.days" class="mt-1 size-5 shrink-0 accent-primary" />
                  <span>
                    <span class="num block font-semibold">{{ o.label }}</span>
                    <span class="block text-sm text-muted-foreground">{{ o.hint }}</span>
                  </span>
                </label>
              }
              @if (customRetention(); as d) {
                <p class="text-sm text-muted-foreground">Current setting: <span class="num">{{ d }}</span> days. Pick one of the options above to change it.</p>
              }
            </div>
          </fieldset>
        </section>

        <div class="sticky bottom-[calc(4rem+var(--safe-bottom))] z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:bottom-0 sm:mx-0 sm:rounded-md sm:border">
          <span class="text-sm text-muted-foreground" aria-live="polite">{{ dirty() ? 'Unsaved changes' : 'Saved' }}</span>
          <button hlmBtn type="submit" class="h-11 min-w-28" [disabled]="saving() || !dirty()">{{ saving() ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    </div>
  `,
})
export class PrivacySettingsScreen {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly retention = RETENTION_OPTIONS;
  protected readonly form = new FormGroup({
    showClub: new FormControl(true, { nonNullable: true }),
    showRole: new FormControl(true, { nonNullable: true }),
    showCountry: new FormControl(true, { nonNullable: true }),
    showStats: new FormControl(true, { nonNullable: true }),
    emergencyContactEnabled: new FormControl(false, { nonNullable: true }),
    shareEmergencyWithGm: new FormControl(false, { nonNullable: true }),
    locationRetentionDays: new FormControl(30, { nonNullable: true }),
  });
  protected readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  private readonly saved = signal(this.form.getRawValue());
  protected readonly saving = signal(false);

  protected readonly dirty = computed(() => {
    const a = this.formValue();
    const b = this.saved();
    return (Object.keys(b) as (keyof typeof b)[]).some((k) => a[k] !== b[k]);
  });
  protected readonly hasContact = computed(() => !!this.auth.user()?.emergencyContact);
  protected readonly customRetention = computed(() => {
    const d = this.saved().locationRetentionDays;
    return RETENTION_OPTIONS.some((o) => o.days === d) ? null : d;
  });

  constructor() {
    const u = this.auth.user();
    if (u) this.fill(u);
  }

  private fill(u: MeUser): void {
    const v = {
      showClub: u.privacy.showClub,
      showRole: u.privacy.showRole,
      showCountry: u.privacy.showCountry,
      showStats: u.privacy.showStats,
      emergencyContactEnabled: u.emergencyContactEnabled,
      shareEmergencyWithGm: u.privacy.shareEmergencyWithGm,
      locationRetentionDays: u.locationRetentionDays,
    };
    this.form.setValue(v);
    this.saved.set(v);
  }

  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    const sharingChanged = v.shareEmergencyWithGm !== this.saved().shareEmergencyWithGm;
    this.saving.set(true);
    try {
      const user = await this.api.updateMe({
        privacy: { showClub: v.showClub, showRole: v.showRole, showCountry: v.showCountry, showStats: v.showStats, shareEmergencyWithGm: v.shareEmergencyWithGm },
        emergencyContactEnabled: v.emergencyContactEnabled,
        locationRetentionDays: Number(v.locationRetentionDays),
      });
      this.auth.setUser(user);
      this.fill(user);
      if (sharingChanged) {
        void this.api.recordConsent('emergency_share', v.shareEmergencyWithGm).catch(() => undefined);
      }
      this.toast.success('Privacy settings saved');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.saving.set(false);
    }
  }
}
