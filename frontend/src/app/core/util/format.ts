import {
  CaptureBlockReason,
  EventStatus,
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

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  sunday: 'Sunday game',
  milsim: 'Milsim',
  scenario: 'Scenario event',
  championship: 'Championship',
  plr: 'PLR',
  pcr: 'PCR',
  custom: 'Custom',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  registration_open: 'Registration open',
  lobby: 'Lobby',
  live: 'Live',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PLAYER_ROLE_LABELS: Record<PlayerRole, string> = {
  rifleman: 'Rifleman',
  medic: 'Medic',
  support_gunner: 'Support gunner',
  sniper: 'Sniper',
  scout: 'Scout',
  squad_leader: 'Squad leader',
  radio_operator: 'Radio operator',
  custom: 'Custom role',
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
  inactive: 'Not yet available',
  active: 'Available',
  locked: 'Locked',
  contested: 'Contested',
  captured: 'Captured',
  disabled: 'Disabled',
  completed: 'Completed',
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
  domination: 'Domination',
  ctf: 'Capture the flag',
  vip: 'VIP',
  search_destroy: 'Search and destroy',
  bomb_defusal: 'Bomb defusal',
  attack_defense: 'Attack and defend',
  recon: 'Recon',
  intel: 'Intel gathering',
  custom: 'Custom',
};

export const BLOCK_REASON_LABELS: Record<CaptureBlockReason, string> = {
  not_live: 'The game is not running',
  no_team: 'You are not assigned to a team',
  disabled: 'Disabled by the Game Master',
  completed: 'No captures left',
  locked: 'Capture the prerequisite objectives first',
  inactive: 'Outside its availability window',
  contested: 'Contested — clear the zone first',
  already_owned: 'Your team already holds it',
  team_not_allowed: 'Your team cannot capture this objective',
  cooldown: 'Cooling down after the last capture',
  jammed: 'Jammed for your team',
  shielded: 'Shielded by another team',
  geofence_required: 'Hold the zone first, then enter the code',
};

export const POI_TYPE_LABELS: Record<PoiType, string> = {
  ammo: 'Ammunition point',
  medic: 'Medic station',
  respawn: 'Respawn point',
  safe_zone: 'Safe zone',
  team_base: 'Team base',
  vehicle: 'Vehicle',
  supply: 'Supply cache',
  extraction: 'Extraction point',
  restricted: 'Restricted area',
  custom: 'Custom point',
};

export const ZONE_KIND_LABELS: Record<ZoneKind, string> = {
  playable: 'Playable area',
  restricted: 'Restricted area',
  safe: 'Safe zone',
  spawn: 'Spawn point',
  respawn: 'Respawn area',
  base: 'Team base',
  extraction: 'Extraction zone',
  route: 'Route',
  line: 'Defensive line',
  sector: 'Sector',
  label: 'Label',
};

export const PERK_TYPE_LABELS: Record<PerkType, string> = {
  uav: 'UAV',
  jammer: 'Objective jammer',
  theft: 'Currency theft',
  shield: 'Objective shield',
  double_points: 'Double points',
  recon: 'Recon scan',
  instant_respawn: 'Instant respawn',
  supply_drop: 'Supply drop',
  comms_jammer: 'Comms jammer',
  custom: 'Custom perk',
};

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending_approval: 'Waiting for GM approval',
  ready: 'Ready to activate',
  active: 'Active',
  completed: 'Done',
  expired: 'Expired',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const PRECISION_LABELS: Record<Precision, string> = {
  exact: 'Exact',
  approximate: 'Approximate',
  delayed: 'Delayed',
  area: 'Area only',
};

export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
  starting_balance: 'Starting balance',
  capture: 'Capture',
  capture_bonus: 'First capture bonus',
  recurring: 'Holding objective',
  defense_bonus: 'Defense bonus',
  completion_bonus: 'Completion bonus',
  gm_adjustment: 'GM adjustment',
  penalty: 'Penalty',
  perk_purchase: 'Perk purchase',
  perk_refund: 'Perk refund',
  theft_in: 'Stolen from enemy',
  theft_out: 'Stolen by enemy',
  capture_revoked: 'Capture revoked',
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
  return `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(undefined).format(n);
}

export function formatSigned(n: number): string {
  return (n > 0 ? '+' : n < 0 ? '−' : '') + formatNumber(Math.abs(n));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "3 min ago", "in 2 h" */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
  if (abs < 45_000) return diff < 0 ? 'just now' : 'in a moment';
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

/** Save a Blob as a file download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
