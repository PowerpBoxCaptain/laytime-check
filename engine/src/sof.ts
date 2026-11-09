// Statement of Facts entries → laytime stoppages for laytime-statement.ts.
//
// @rule:CHRT-008 — no number from an underdetermined record
//
// Only entries a person marked `excluded` become stoppages: whether rain, a breakdown
// or a hold stops laytime depends on the charter party, and that call is theirs.
// An excluded entry is bounded by, in order:
//   1. a matching *_stop event after it (rain_start → rain_stop), or
//   2. its own duration (timeUsed hours, when > 0).
// Neither → the stoppage is unbounded, and the statement refuses (NULL) rather than guess.

import type { Stoppage, UsedPeriod } from './statement.js';

export interface SofEntryLike {
  id: string;
  eventType: string;
  eventTime: Date;
  timeUsed: number;
  excluded: boolean;
  excludeReason: string | null;
  remarks?: string | null;
  deletedAt?: Date | null;
}

export interface SofStoppages {
  stoppages: Stoppage[];
  unbounded: { sourceRef: string }[];
}

const HOUR_MS = 60 * 60 * 1000;

export function stoppagesFromSof(entries: SofEntryLike[]): SofStoppages {
  const live = entries
    .filter((e) => !e.deletedAt)
    .sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
  const stoppages: Stoppage[] = [];
  const unbounded: { sourceRef: string }[] = [];

  for (const e of live) {
    if (!e.excluded || e.eventType.endsWith('_stop')) continue; // a *_stop only closes a stoppage
    const sourceRef = `SOF ${e.eventType} ${e.eventTime.toISOString().slice(0, 16)}Z (${e.id})`;
    const reason = e.excludeReason || e.eventType.replace(/_start$/, '');

    let end: Date | null = null;
    if (e.eventType.endsWith('_start')) {
      const stopType = e.eventType.replace(/_start$/, '_stop');
      const stop = live.find((x) => x.eventType === stopType && x.eventTime.getTime() > e.eventTime.getTime());
      if (stop) end = stop.eventTime;
    }
    if (!end && e.timeUsed > 0) end = new Date(e.eventTime.getTime() + e.timeUsed * HOUR_MS);

    if (end) stoppages.push({ start: e.eventTime, end, reason, sourceRef });
    else unbounded.push({ sourceRef });
  }
  return { stoppages, unbounded };
}

// ─── SHEX "unless used": work done on an excepted day (added 27 Oct 2026) ────
// A person records it as a pair: worked_start → worked_stop (or worked_start with timeUsed hours).
// The record can also say plainly that nothing was worked on excepted days: one entry
// 'no_excepted_day_work'. With neither, the statement refuses (NULL): absence in the SOF is not proof
// that nothing was worked.

export interface SofUsedPeriods {
  usedPeriods: UsedPeriod[] | undefined; // undefined = the SOF does not say
  unbounded: { sourceRef: string }[];
}

export function usedPeriodsFromSof(entries: SofEntryLike[]): SofUsedPeriods {
  const live = entries
    .filter((e) => !e.deletedAt)
    .sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
  const starts = live.filter((e) => e.eventType === 'worked_start');
  const saysNone = live.some((e) => e.eventType === 'no_excepted_day_work');
  if (!starts.length) return { usedPeriods: saysNone ? [] : undefined, unbounded: [] };

  const usedPeriods: UsedPeriod[] = [];
  const unbounded: { sourceRef: string }[] = [];
  for (const s of starts) {
    const sourceRef = `SOF worked_start ${s.eventTime.toISOString().slice(0, 16)}Z (${s.id})`;
    const stop = live.find((x) => x.eventType === 'worked_stop' && x.eventTime.getTime() > s.eventTime.getTime());
    const end = stop ? stop.eventTime : s.timeUsed > 0 ? new Date(s.eventTime.getTime() + s.timeUsed * HOUR_MS) : null;
    if (end) usedPeriods.push({ start: s.eventTime, end, sourceRef });
    else unbounded.push({ sourceRef });
  }
  return { usedPeriods, unbounded };
}
