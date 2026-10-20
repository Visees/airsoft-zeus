import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { StatusChip } from '../../shared/status-chip';

export type PermState = 'checking' | 'granted' | 'denied' | 'prompt' | 'unsupported';

/** Granted / blocked / not asked chip — glyph + label, never colour alone. */
@Component({
  selector: 'zeus-permission-chip',
  imports: [StatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('granted') {
        <zeus-status-chip label="Allowed" glyph="✓" tone="primary" />
      }
      @case ('denied') {
        <zeus-status-chip label="Blocked" glyph="✕" tone="danger" />
      }
      @case ('unsupported') {
        <zeus-status-chip label="Not supported" glyph="–" tone="neutral" />
      }
      @case ('checking') {
        <zeus-status-chip label="Checking" glyph="◌" tone="neutral" />
      }
      @default {
        <zeus-status-chip label="Not asked yet" glyph="○" tone="neutral" />
      }
    }
  `,
})
export class PermissionChip {
  readonly state = input.required<PermState>();
}

/** How to re-enable a blocked permission in the browser / OS. */
@Component({
  selector: 'zeus-permission-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="rounded-md border border-border bg-muted p-3 text-sm">
      <p class="font-semibold">How to allow {{ what() }} again</p>
      <ul class="mt-2 flex flex-col gap-1.5 text-muted-foreground">
        <li class="flex gap-2"><span aria-hidden="true">▸</span><span><strong class="text-foreground">Android / Chrome:</strong> tap the icon left of the address bar → Permissions → {{ label() }} → Allow. In the installed app: long-press the app icon → App info → Permissions.</span></li>
        <li class="flex gap-2"><span aria-hidden="true">▸</span><span><strong class="text-foreground">iPhone / Safari:</strong> Settings → {{ iosPath() }}.</span></li>
        <li class="flex gap-2"><span aria-hidden="true">▸</span><span><strong class="text-foreground">Desktop:</strong> click the lock icon next to the address → Site settings → {{ label() }} → Allow.</span></li>
      </ul>
      <p class="mt-2 text-muted-foreground">Then reload the app.</p>
    </div>
  `,
})
export class PermissionHelp {
  readonly kind = input.required<'location' | 'notifications'>();
  protected what(): string {
    return this.kind() === 'location' ? 'location' : 'notifications';
  }
  protected label(): string {
    return this.kind() === 'location' ? 'Location' : 'Notifications';
  }
  protected iosPath(): string {
    return this.kind() === 'location'
      ? 'Privacy & Security → Location Services → Safari Websites (or Airsoft Zeus, if installed) → While Using the App'
      : 'Notifications → Airsoft Zeus → Allow Notifications (only for the app added to the Home Screen)';
  }
}
