import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
// STUB — replaced by the feature implementation.
@Component({
  selector: 'zeus-live-shell',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="page"><h1 class="text-2xl uppercase">Live</h1><router-outlet /></div>`,
})
export class LiveShell {}
