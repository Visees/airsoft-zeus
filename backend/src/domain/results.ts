import PDFDocument from 'pdfkit';
import { many, one, type Row } from '../db.js';
import { notFound } from '../errors.js';
import { scoring as scoringOf } from './defaults.js';
import * as dto from './serialize.js';
import { eventDate, tr } from '../i18n/index.js';

export interface ResultsOptions {
  /** Public page: no player ids, no GM names, no adjustments' actors. */
  publicView?: boolean;
}

const MODE_LABELS = (): Record<string, string> => ({
  sunday: tr`Sunday game`,
  milsim: tr`Milsim`,
  scenario: tr`Scenario event`,
  championship: tr`Championship`,
  plr: 'PLR',
  pcr: 'PCR',
  custom: tr`Custom`,
});

export async function computeResults(eventId: string, opts: ResultsOptions = {}) {
  const ev = await one('SELECT * FROM events WHERE id = $1', [eventId]);
  if (!ev) throw notFound(tr`Event not found.`);
  const scoring = scoringOf(ev.scoring);
  const teams = await many(
    `SELECT t.*,
       (SELECT count(*)::int FROM objective_captures c WHERE c.team_id = t.id AND c.revoked_at IS NULL) AS captured,
       (SELECT count(*)::int FROM objectives o WHERE o.owner_team_id = t.id) AS held,
       (SELECT count(*)::int FROM perk_purchases p WHERE p.team_id = t.id AND p.status NOT IN ('rejected','cancelled')) AS perks
       FROM teams t WHERE t.event_id = $1`,
    [eventId],
  );
  const key = (t: Row) => (scoring.winCondition === 'objectives' ? t.held * 1e9 + Number(t.points) : Number(t.points));
  teams.sort((a, b) => key(b) - key(a));
  const isDraw = ev.status === 'completed' && teams.length > 1 && key(teams[0]) === key(teams[1]);
  let rank = 0;
  let prevKey: number | null = null;
  const teamResults = teams.map((t, i) => {
    const k = key(t);
    if (k !== prevKey) rank = i + 1;
    prevKey = k;
    return {
      teamId: t.id,
      name: t.name,
      color: t.color,
      icon: t.icon,
      pattern: t.pattern,
      rank,
      points: Number(t.points),
      currency: Number(t.currency),
      objectivesCaptured: t.captured,
      objectivesHeld: t.held,
      perksPurchased: t.perks,
    };
  });
  const players = await many(
    `SELECT m.user_id, u.nickname, u.deleted_at, m.team_id, m.points, m.captures, m.currency_earned
       FROM event_members m JOIN users u ON u.id = m.user_id
      WHERE m.event_id = $1 AND m.status IN ('approved','left','removed') AND m.team_id IS NOT NULL
      ORDER BY m.points DESC, m.captures DESC, u.nickname`,
    [eventId],
  );
  const timeline = await many(`SELECT ${dto.CAPTURE_SELECT} WHERE c.event_id = $1 ORDER BY c.created_at`, [eventId]);
  const perks = await many(`SELECT ${dto.PURCHASE_SELECT} WHERE pp.event_id = $1 AND pp.status NOT IN ('rejected') ORDER BY pp.created_at`, [eventId]);
  const adjustments = opts.publicView
    ? []
    : await many(`SELECT ${dto.LEDGER_SELECT} WHERE l.event_id = $1 AND l.type IN ('gm_adjustment','penalty','capture_revoked') ORDER BY l.created_at`, [eventId]);

  const started = ev.started_at ? new Date(ev.started_at).getTime() : null;
  const ended = ev.ended_at ? new Date(ev.ended_at).getTime() : Date.now();
  const durationMs = started ? Math.max(0, ended - started - Number(ev.paused_total_ms ?? 0)) : 0;
  const anon = (r: Row) => (r.deleted_at ? tr`Deleted player` : r.nickname);

  return {
    eventId: ev.id,
    eventName: ev.name,
    gameMode: ev.game_mode,
    status: ev.status,
    startedAt: dto.iso(ev.started_at),
    endedAt: dto.iso(ev.ended_at),
    durationMs,
    winnerTeamId: ev.winner_team_id,
    isDraw,
    teams: teamResults,
    players: players.map((p) => ({
      userId: opts.publicView ? null : p.user_id,
      nickname: anon(p),
      teamId: p.team_id,
      points: Number(p.points),
      captures: p.captures,
      currencyEarned: Number(p.currency_earned),
    })),
    timeline: timeline.map((c) => {
      const d = dto.capture(c);
      return opts.publicView ? { ...d, userId: null } : d;
    }),
    perks: perks.map((p) => {
      const d = dto.purchase(p);
      return opts.publicView ? { ...d, buyerId: null } : d;
    }),
    adjustments: adjustments.map(dto.ledger),
    resultsToken: opts.publicView ? null : ev.results_token,
  };
}

export type Results = Awaited<ReturnType<typeof computeResults>>;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export async function exportCsv(eventId: string, kind: 'leaderboard' | 'players' | 'captures' | 'ledger' | 'perks'): Promise<string> {
  const r = await computeResults(eventId);
  const teamName = new Map(r.teams.map((t) => [t.teamId, t.name]));
  switch (kind) {
    case 'leaderboard':
      return csv(
        ['rank', 'team', 'points', 'credits_left', 'objectives_captured', 'objectives_held', 'perks_bought', 'winner'],
        r.teams.map((t) => [t.rank, t.name, t.points, t.currency, t.objectivesCaptured, t.objectivesHeld, t.perksPurchased, t.teamId === r.winnerTeamId ? 'yes' : '']),
      );
    case 'players':
      return csv(['nickname', 'team', 'points', 'captures', 'credits_earned'], r.players.map((p) => [p.nickname, teamName.get(p.teamId ?? '') ?? '', p.points, p.captures, p.currencyEarned]));
    case 'captures':
      return csv(
        ['time_utc', 'objective', 'team', 'player', 'method', 'points', 'credits', 'revoked'],
        r.timeline.map((c) => [c.createdAt, c.objectiveName, teamName.get(c.teamId) ?? '', c.nickname ?? '', c.method, c.points, c.currency, c.revoked ? 'yes' : '']),
      );
    case 'perks':
      return csv(
        ['time_utc', 'perk', 'type', 'team', 'buyer', 'price', 'status', 'refunded', 'target_team'],
        r.perks.map((p) => [p.createdAt, p.perkName, p.perkType, teamName.get(p.teamId) ?? '', p.buyerNickname ?? '', p.price, p.status, p.refunded ? 'yes' : '', teamName.get(p.targetTeamId ?? '') ?? '']),
      );
    case 'ledger': {
      const rows = await many(`SELECT ${dto.LEDGER_SELECT} WHERE l.event_id = $1 ORDER BY l.created_at`, [eventId]);
      return csv(
        ['time_utc', 'team', 'kind', 'type', 'requested', 'applied', 'balance_after', 'player', 'objective', 'reason', 'actor'],
        rows.map((l) => [dto.iso(l.created_at), teamName.get(l.team_id) ?? '', l.kind, l.type, l.requested, l.amount, l.balance_after, l.nickname ?? '', l.objective_name ?? '', l.reason, l.actor_nickname ?? 'system']),
      );
    }
  }
}

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? tr`${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

/** One-page-per-section PDF report. */
export async function exportPdf(eventId: string): Promise<Buffer> {
  const r = await computeResults(eventId);
  const ev = await one('SELECT start_at, meeting_address FROM events WHERE id = $1', [eventId]);
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: tr`${r.eventName} — results`, Creator: 'AirsoftHub' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const teamName = new Map(r.teams.map((t) => [t.teamId, t.name]));
  const olive = '#4A5A1F';
  const muted = '#565C51';

  doc.fillColor(olive).fontSize(9).text(tr`AIRSOFTHUB · EVENT REPORT`, { characterSpacing: 1.5 });
  doc.moveDown(0.3).fillColor('#151813').fontSize(22).text(r.eventName.toUpperCase());
  doc
    .fontSize(10)
    .fillColor(muted)
    .text(
      [MODE_LABELS()[r.gameMode] ?? r.gameMode, ev?.start_at ? eventDate(ev.start_at, tr.lang) : null, ev?.meeting_address, tr`Played ${fmtDuration(r.durationMs)}`]
        .filter(Boolean)
        .join('  ·  '),
    );
  doc.moveDown();
  const winner = r.teams.find((t) => t.teamId === r.winnerTeamId);
  doc.fillColor('#151813').fontSize(14).text(r.isDraw ? tr`Result: draw` : winner ? tr`Winner: ${winner.name}` : tr`No winner yet`);
  doc.moveDown();

  const table = (title: string, header: string[], rows: (string | number)[][], widths: number[]) => {
    if (doc.y > 680) doc.addPage();
    doc.fillColor(olive).fontSize(10).text(title.toUpperCase(), { characterSpacing: 1 });
    doc.moveDown(0.3);
    const x0 = doc.page.margins.left;
    const drawRow = (cells: (string | number)[], bold: boolean) => {
      if (doc.y > 760) doc.addPage();
      const y = doc.y;
      let x = x0;
      doc.fontSize(9).fillColor(bold ? '#151813' : '#2b2f28').font(bold ? 'Helvetica-Bold' : 'Helvetica');
      cells.forEach((c, i) => {
        doc.text(String(c), x, y, { width: widths[i] - 6, ellipsis: true, lineBreak: false });
        x += widths[i];
      });
      doc.moveDown(0.9);
      doc.x = x0;
    };
    drawRow(header, true);
    rows.forEach((row) => drawRow(row, false));
    doc.font('Helvetica').moveDown(0.8);
  };

  table(
    tr`Final leaderboard`,
    ['#', tr`Team`, tr`Points`, tr`Credits`, tr`Captured`, tr`Held`, tr`Perks`],
    r.teams.map((t) => [t.rank, t.name, t.points, t.currency, t.objectivesCaptured, t.objectivesHeld, t.perksPurchased]),
    [28, 170, 70, 70, 60, 50, 50],
  );
  table(
    tr`Top players`,
    [tr`Player`, tr`Team`, tr`Points`, tr`Captures`, tr`Credits`],
    r.players.slice(0, 25).map((p) => [p.nickname, teamName.get(p.teamId ?? '') ?? '', p.points, p.captures, p.currencyEarned]),
    [160, 140, 70, 70, 60],
  );
  table(
    tr`Objective timeline`,
    [tr`Time (UTC)`, tr`Objective`, tr`Team`, tr`Player`, tr`Method`],
    r.timeline.map((c) => [c.createdAt.slice(11, 19), c.objectiveName + (c.revoked ? tr` (revoked)` : ''), teamName.get(c.teamId) ?? '', c.nickname ?? '', c.method]),
    [70, 160, 110, 110, 50],
  );
  if (r.perks.length) {
    table(
      tr`Perks`,
      [tr`Time (UTC)`, tr`Perk`, tr`Team`, tr`Price`, tr`Status`],
      r.perks.map((p) => [p.createdAt.slice(11, 19), p.perkName, teamName.get(p.teamId) ?? '', p.price, p.status + (p.refunded ? tr`, refunded` : '')]),
      [70, 160, 120, 60, 90],
    );
  }
  if (r.adjustments.length) {
    table(
      tr`Game Master adjustments`,
      [tr`Time (UTC)`, tr`Team`, tr`Kind`, tr`Amount`, tr`Reason`],
      r.adjustments.map((a) => [a.createdAt.slice(11, 19), teamName.get(a.teamId) ?? '', a.kind, a.amount, a.reason]),
      [70, 110, 60, 60, 200],
    );
  }
  doc.end();
  return done;
}
