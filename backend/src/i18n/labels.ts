import type { Translate } from './index.js';

/** Names of stored enum values inside messages ("from draft to live"). Pass `tr` or a Msg's translator. */

export function statusLabel(tr: Translate, status: string): string {
  const labels: Record<string, string> = {
    draft: tr`draft`,
    published: tr`published`,
    registration_open: tr`registration open`,
    lobby: tr`lobby`,
    live: tr`live`,
    paused: tr`paused`,
    completed: tr`completed`,
    cancelled: tr`cancelled`,
  };
  return labels[status] ?? status;
}

export function captureMethodLabel(tr: Translate, method: string): string {
  const labels: Record<string, string> = { code: tr`code`, qr: tr`QR`, geofence: tr`zone hold`, gm: tr`GM` };
  return labels[method] ?? method;
}

export function objectiveActionLabel(tr: Translate, action: string): string {
  const labels: Record<string, string> = {
    activate: tr`activated`,
    disable: tr`disabled`,
    contest: tr`marked contested`,
    uncontest: tr`contest cleared`,
    clear_owner: tr`owner cleared`,
    set_owner: tr`owner set`,
    reset: tr`reset`,
  };
  return labels[action] ?? action;
}
