import { Objective, Poi, PoiType, Team, VisiblePosition } from '../api/models';
import { OBJECTIVE_STATUS_GLYPHS, OBJECTIVE_STATUS_LABELS, PLAYER_ROLE_TAGS, initials } from '../util/format';

/**
 * DOM builders for map markers, shared by the Google renderer (AdvancedMarkerElement content)
 * and the schematic renderer (positioned absolutely over the SVG).
 * Every marker carries a text glyph or label so status never depends on colour alone.
 */

export const POI_TAGS: Record<PoiType, string> = {
  ammo: 'AM',
  medic: '+',
  respawn: 'RS',
  safe_zone: 'SZ',
  team_base: 'HQ',
  vehicle: 'VH',
  supply: 'SP',
  extraction: 'EX',
  restricted: '⛔',
  custom: '•',
};

function el(tag: string, style: Partial<CSSStyleDeclaration>, text?: string): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  if (text !== undefined) e.textContent = text;
  return e;
}

function textOn(hex: string): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return '#fff';
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#111' : '#fff';
}

const LABEL_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  top: 'calc(100% + 3px)',
  left: '50%',
  transform: 'translateX(-50%)',
  pointerEvents: 'none',
  padding: '0 4px',
  borderRadius: '3px',
  background: 'var(--hud)',
  color: 'var(--foreground)',
  font: '600 11px/16px var(--font-sans)',
  whiteSpace: 'nowrap',
  maxWidth: '120px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  border: '1px solid var(--border)',
};

function wrap(children: HTMLElement[], title: string): HTMLElement {
  // The icon alone defines the box, so translateY(50%) centres the icon on the coordinate
  // (AdvancedMarkerElement anchors content at its bottom centre). Labels hang below.
  const w = el('div', { position: 'relative', display: 'grid', placeItems: 'center', cursor: 'pointer', transform: 'translateY(50%)' });
  w.title = title;
  w.setAttribute('role', 'button');
  w.setAttribute('aria-label', title);
  // Invisible 44px tap area centred on the icon (icons are 24–34px, hard to hit with gloves).
  // Absolute, so it does not change the box; clicks on it reach the marker's own listener.
  w.appendChild(el('span', { position: 'absolute', left: '50%', top: '50%', width: '44px', height: '44px', transform: 'translate(-50%, -50%)', borderRadius: '50%' }));
  children.forEach((c) => w.appendChild(c));
  return w;
}

export function objectiveMarker(o: Objective, owner: Team | null, selected: boolean, showLabel = true): HTMLElement {
  const fill = owner?.color ?? 'var(--card)';
  const box = el(
    'div',
    {
      width: '34px',
      height: '34px',
      display: 'grid',
      placeItems: 'center',
      transform: 'rotate(45deg)',
      borderRadius: '4px',
      border: `3px solid ${o.status === 'contested' ? 'var(--destructive)' : o.color}`,
      background: fill,
      boxShadow: selected ? '0 0 0 3px var(--nav)' : '0 2px 6px rgba(0,0,0,.45)',
      opacity: o.status === 'disabled' || o.status === 'completed' ? '0.55' : '1',
    },
    undefined,
  );
  const glyph = el(
    'span',
    {
      transform: 'rotate(-45deg)',
      font: '700 14px/1 var(--font-mono)',
      color: owner ? textOn(owner.color) : o.color,
    },
    o.jammedUntil ? '⌁' : OBJECTIVE_STATUS_GLYPHS[o.status],
  );
  box.appendChild(glyph);
  const parts = [box];
  if (showLabel) parts.push(el('div', { ...LABEL_STYLE, top: 'calc(100% + 8px)' }, o.name));
  return wrap(parts, owner ? $localize`Objective ${o.name}:name:, ${OBJECTIVE_STATUS_LABELS[o.status]}:status:, held by ${owner.name}:owner:` : $localize`Objective ${o.name}:name:, ${OBJECTIVE_STATUS_LABELS[o.status]}:status:`);
}

export function poiMarker(p: Poi, selected: boolean, showLabel = true): HTMLElement {
  const dot = el(
    'div',
    {
      width: '28px',
      height: '28px',
      display: 'grid',
      placeItems: 'center',
      borderRadius: '50%',
      border: `2px solid ${p.color}`,
      background: 'var(--card)',
      color: p.color,
      font: '700 11px/1 var(--font-mono)',
      boxShadow: selected ? '0 0 0 3px var(--nav)' : '0 1px 4px rgba(0,0,0,.4)',
    },
    POI_TAGS[p.type],
  );
  const parts = [dot];
  if (showLabel) parts.push(el('div', LABEL_STYLE, p.name));
  return wrap(parts, `${p.name}`);
}

export function playerMarker(pos: VisiblePosition, team: Team | null, opts: { selected?: boolean; showLabel?: boolean } = {}): HTMLElement {
  const color = team?.color ?? '#888';
  const hostile = pos.kind === 'enemy' || pos.kind === 'intel';
  const stale = pos.status !== 'online';
  const tag = pos.playerRole ? PLAYER_ROLE_TAGS[pos.playerRole] : initials(pos.nickname);
  const dot = el(
    'div',
    {
      width: pos.kind === 'intel' ? '24px' : '28px',
      height: pos.kind === 'intel' ? '24px' : '28px',
      display: 'grid',
      placeItems: 'center',
      borderRadius: pos.kind === 'intel' ? '3px' : '50%',
      transform: pos.kind === 'intel' ? 'rotate(45deg)' : 'none',
      background: color,
      color: textOn(color),
      font: '700 10px/1 var(--font-mono)',
      border: hostile ? '3px solid var(--destructive)' : '2px solid var(--background)',
      outline: hostile ? 'none' : '1px solid rgba(0,0,0,.35)',
      opacity: stale ? '0.5' : '1',
      borderStyle: stale ? 'dashed' : 'solid',
      boxShadow: opts.selected ? '0 0 0 3px var(--nav)' : '0 1px 4px rgba(0,0,0,.45)',
    },
  );
  const inner = el('span', { transform: pos.kind === 'intel' ? 'rotate(-45deg)' : 'none' }, pos.kind === 'intel' ? '?' : tag);
  dot.appendChild(inner);
  const parts = [dot];
  if (opts.showLabel !== false && pos.nickname) {
    parts.push(el('div', { ...LABEL_STYLE, color: hostile ? 'var(--destructive)' : 'var(--foreground)' }, (stale ? '◐ ' : '') + pos.nickname));
  }
  const who = pos.nickname ?? (hostile ? $localize`Enemy` : $localize`Teammate`);
  return wrap(parts, `${hostile ? 'Enemy ' : ''}${who}${team ? ', ' + team.name : ''}${stale ? ', last known position' : ''}`);
}

export function selfMarker(heading: number | null): HTMLElement {
  const w = el('div', { position: 'relative', width: '22px', height: '22px', transform: 'translateY(50%)' });
  if (heading !== null && isFinite(heading)) {
    const cone = el('div', {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '0',
      height: '0',
      borderLeft: '9px solid transparent',
      borderRight: '9px solid transparent',
      borderBottom: '20px solid color-mix(in srgb, var(--nav) 45%, transparent)',
      transform: `translate(-50%, -100%) rotate(${heading}deg)`,
      transformOrigin: '50% 100%',
    });
    w.appendChild(cone);
  }
  const dot = el('div', {
    position: 'absolute',
    inset: '0',
    borderRadius: '50%',
    background: 'var(--nav)',
    border: '3px solid #fff',
    boxShadow: '0 0 0 2px var(--nav), 0 2px 6px rgba(0,0,0,.5)',
  });
  w.appendChild(dot);
  w.title = $localize`Your position`;
  w.setAttribute('aria-label', 'Your position');
  return w;
}

export function zoneLabel(text: string, color: string): HTMLElement {
  return el(
    'div',
    {
      ...LABEL_STYLE,
      color,
      font: '700 11px/16px var(--font-sans)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      position: 'static',
      transform: 'translateY(50%)',
    },
    text,
  );
}
