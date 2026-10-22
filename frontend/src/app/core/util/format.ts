import { isNativeApp, shareFile } from '../native/native-app';
import {
  CaptureBlockReason,
  EventStatus,
  Feature,
  GameMode,
  LedgerType,
  ObjectiveStatus,
  ObjectiveType,
  PerkType,
  PlayerRole,
  PoiType,
  Precision,
  PurchaseStatus,
  ZoneKind,
} from '../api/models';
import { activeLocale } from '../i18n/language';

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  sunday: $localize`Sunday game`,
  milsim: $localize`Milsim`,
  scenario: $localize`Scenario event`,
  championship: $localize`Championship`,
  plr: $localize`PLR`,
  pcr: $localize`PCR`,
  custom: $localize`:game mode|:Custom`,
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: $localize`Draft`,
  published: $localize`:event status|:Published`,
  registration_open: $localize`Registration open`,
  lobby: $localize`Lobby`,
  live: $localize`:event status|:Live`,
  paused: $localize`:event status|:Paused`,
  completed: $localize`:event status|:Completed`,
  cancelled: $localize`:event status|:Cancelled`,
};

export const PLAYER_ROLE_LABELS: Record<PlayerRole, string> = {
  rifleman: $localize`Rifleman`,
  medic: $localize`Medic`,
  support_gunner: $localize`Support gunner`,
  sniper: $localize`Sniper`,
  scout: $localize`Scout`,
  squad_leader: $localize`Squad leader`,
  radio_operator: $localize`Radio operator`,
  custom: $localize`Custom role`,
};

/** Short tags used on map markers and dense lists. */
export const PLAYER_ROLE_TAGS: Record<PlayerRole, string> = {
  rifleman: 'RF',
  medic: 'MD',
  support_gunner: 'SG',
  sniper: 'SN',
  scout: 'SC',
  squad_leader: 'SL',
  radio_operator: 'RO',
  custom: '··',
};

export const OBJECTIVE_STATUS_LABELS: Record<ObjectiveStatus, string> = {
  inactive: $localize`Not yet available`,
  active: $localize`Available`,
  locked: $localize`:objective status|:Locked`,
  contested: $localize`:objective status|:Contested`,
  captured: $localize`:objective status|:Captured`,
  disabled: $localize`:objective status|:Disabled`,
  completed: $localize`:objective status|:Completed`,
};

/** Shape glyphs so status never depends on colour alone. */
export const OBJECTIVE_STATUS_GLYPHS: Record<ObjectiveStatus, string> = {
  inactive: '◌',
  active: '●',
  locked: '■',
  contested: '▲',
  captured: '◆',
  disabled: '✕',
  completed: '✓',
};

export const OBJECTIVE_TYPE_LABELS: Record<ObjectiveType, string> = {
  domination: $localize`Domination`,
  ctf: $localize`Capture the flag`,
  vip: $localize`VIP`,
  search_destroy: $localize`Search and destroy`,
  bomb_defusal: $localize`Bomb defusal`,
  attack_defense: $localize`Attack and defend`,
  recon: $localize`:objective type|:Recon`,
  intel: $localize`Intel gathering`,
  custom: $localize`:objective type|:Custom`,
};

export const BLOCK_REASON_LABELS: Record<CaptureBlockReason, string> = {
  not_live: $localize`The game is not running`,
  no_team: $localize`You are not assigned to a team`,
  disabled: $localize`Disabled by the Game Master`,
  completed: $localize`No captures left`,
  locked: $localize`Capture the prerequisite objectives first`,
  inactive: $localize`Outside its availability window`,
  contested: $localize`Contested — clear the zone first`,
  already_owned: $localize`Your team already holds it`,
  team_not_allowed: $localize`Your team cannot capture this objective`,
  cooldown: $localize`Cooling down after the last capture`,
  jammed: $localize`Jammed for your team`,
  shielded: $localize`Shielded by another team`,
  geofence_required: $localize`Hold the zone first, then enter the code`,
};

export const POI_TYPE_LABELS: Record<PoiType, string> = {
  ammo: $localize`Ammunition point`,
  medic: $localize`Medic station`,
  respawn: $localize`Respawn point`,
  safe_zone: $localize`Safe zone`,
  team_base: $localize`Team base`,
  vehicle: $localize`Vehicle`,
  supply: $localize`Supply cache`,
  extraction: $localize`Extraction point`,
  restricted: $localize`Restricted area`,
  custom: $localize`Custom point`,
};

export const ZONE_KIND_LABELS: Record<ZoneKind, string> = {
  playable: $localize`Playable area`,
  restricted: $localize`Restricted area`,
  safe: $localize`Safe zone`,
  spawn: $localize`Spawn point`,
  respawn: $localize`Respawn area`,
  base: $localize`Team base`,
  extraction: $localize`Extraction zone`,
  route: $localize`Route`,
  line: $localize`Defensive line`,
  sector: $localize`Sector`,
  label: $localize`Label`,
};

export const PERK_TYPE_LABELS: Record<PerkType, string> = {
  uav: $localize`UAV`,
  jammer: $localize`Objective jammer`,
  theft: $localize`Currency theft`,
  shield: $localize`Objective shield`,
  double_points: $localize`Double points`,
  recon: $localize`Recon scan`,
  instant_respawn: $localize`Instant respawn`,
  supply_drop: $localize`Supply drop`,
  comms_jammer: $localize`Comms jammer`,
  custom: $localize`Custom perk`,
};

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending_approval: $localize`Waiting for GM approval`,
  ready: $localize`Ready to activate`,
  active: $localize`:perk purchase status|:Active`,
  completed: $localize`:perk purchase status|:Done`,
  expired: $localize`:perk purchase status|:Expired`,
  rejected: $localize`:perk purchase status|:Rejected`,
  cancelled: $localize`:perk purchase status|:Cancelled`,
};

export const PRECISION_LABELS: Record<Precision, string> = {
  exact: $localize`:location precision|:Exact`,
  approximate: $localize`:location precision|:Approximate`,
  delayed: $localize`:location precision|:Delayed`,
  area: $localize`Area only`,
};

export const FEATURE_LABELS: Record<Feature, string> = {
  discover_events: $localize`Discover events`,
  create_events: $localize`Create events`,
  create_clubs: $localize`Create clubs`,
  support: $localize`Help & feedback`,
  manage_news: $localize`News editor`,
};

export const FEATURE_HINTS: Record<Feature, string> = {
  discover_events: $localize`Browse public events. Without it, players join only with a code or an invitation.`,
  create_events: $localize`Create, duplicate and copy events from templates. Events they already run stay theirs.`,
  create_clubs: $localize`Start a new club. Joining an existing club is always allowed.`,
  support: $localize`Write to the platform team from Profile → Help & feedback.`,
  manage_news: $localize`Write, schedule and delete the News shown on everyone's home page.`,
};

export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
  starting_balance: $localize`Starting balance`,
  capture: $localize`:ledger entry|:Capture`,
  capture_bonus: $localize`First capture bonus`,
  recurring: $localize`Holding objective`,
  defense_bonus: $localize`Defense bonus`,
  completion_bonus: $localize`Completion bonus`,
  gm_adjustment: $localize`GM adjustment`,
  penalty: $localize`Penalty`,
  perk_purchase: $localize`Perk purchase`,
  perk_refund: $localize`Perk refund`,
  theft_in: $localize`Stolen from enemy`,
  theft_out: $localize`Stolen by enemy`,
  capture_revoked: $localize`Capture revoked`,
};

/** 1h 05m · 4m 09s · 12s */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h} h`;
  if (m > 0) return s ? `${m}m ${String(s).padStart(2, '0')}s` : `${m} min`;
  return `${s}s`;
}

/** HH:MM:SS or MM:SS clock */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDistance(m: number | null | undefined): string {
  if (m === null || m === undefined || !isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${formatDecimal(m / 1000, m < 10_000 ? 2 : 1)} km`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${formatDecimal(bytes / (1024 * 1024), bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** "1 player", "5 players", "5 of 8 players". */
export function formatPlayerCount(count: number, capacity?: number | null): string {
  if (capacity) return $localize`${count}:count: of ${capacity}:capacity: players`;
  return count === 1 ? $localize`1 player` : $localize`${count}:count: players`;
}

/** "A, B and C" in the UI language. */
export function formatList(items: string[]): string {
  return new Intl.ListFormat(activeLocale(), { type: 'conjunction' }).format(items);
}

/** Fixed decimals with the UI language's separator (1.25 / 1,25). */
export function formatDecimal(n: number, digits: number): string {
  return new Intl.NumberFormat(activeLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(n);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(activeLocale()).format(n);
}

export function formatSigned(n: number): string {
  return (n > 0 ? '+' : n < 0 ? '−' : '') + formatNumber(Math.abs(n));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(activeLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(activeLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "3 min ago", "in 2 h" */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(activeLocale(), { numeric: 'auto', style: 'short' });
  if (abs < 45_000) return diff < 0 ? $localize`just now` : $localize`in a moment`;
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

/** <input type="datetime-local"> value from ISO and back (local time). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function initials(nickname: string | null | undefined): string {
  if (!nickname) return '?';
  const clean = nickname.replace(/[^A-Za-z0-9]/g, '');
  return (clean.slice(0, 2) || nickname.slice(0, 2)).toUpperCase();
}

/** Save a Blob as a file download (in the native app: the share sheet, to save or open it). */
export function downloadBlob(blob: Blob, filename: string): void {
  if (isNativeApp()) {
    // rejects when the player closes the share sheet
    void shareFile(blob, filename).catch(() => undefined);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
