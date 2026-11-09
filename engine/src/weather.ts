// Weather interruptions → laytime stoppages, by the charter party's weather wording.
//
// BIMCO Laytime Definitions 2013 (verified in the legal bank, LB-006):
//   def. 15 WEATHER WORKING DAY: "...there shall be excluded from the Laytime a period calculated by reference to the
//            ratio which the duration of the interruption bears to the time which would have or could have been worked
//            but for the interruption."                                                     → method 'ratio'
//   def. 16 WEATHER WORKING DAY OF 24 CONSECUTIVE HOURS (and def. 18 WEATHER PERMITTING): "...the period during which
//            the weather interrupted or would have interrupted work."                       → method 'actual'
//   def. 17 WEATHER WORKING DAY OF 24 HOURS: "a period of 24 hours made up of one or more Working Days ... the actual period
//            of such interruption."                → method 'actual' for the weather, PLUS workingTimeStoppages(): the laytime
//            day is 24 hours of working time, so hours outside the port's working hours do not count as laytime (they do on demurrage).
//
// 'ratio' needs the port's ordinary working hours. For each calendar day, the share of those hours lost to weather
// is the share of that whole laytime day excluded: the day becomes one partial stoppage (countFraction = 1 − lost/working).
// A day whose working hours are all lost is a full stop. Weather outside working hours excludes nothing.
// Days are UTC days, i.e. times written as port local (the convention of laytime-statement.ts without portTimeZone).
// Exceptions are laytime-only: once on demurrage, always on demurrage (appliesOnDemurrage false).

import type { Stoppage } from './statement.js';

export type WeatherMethod = 'ratio' | 'actual';
export interface WeatherInterruption { start: Date; end: Date; sourceRef?: string; reason?: string }
/** Ordinary working hours of the port, each day, as [start, end] in "HH:MM" (end "24:00" allowed). */
export type WorkingHours = [string, string][];

const HOUR = 3.6e6;
const mins = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function overlapMs(a0: number, a1: number, b0: number, b1: number) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }

/**
 * BIMCO def. 17 (weather working day of 24 hours): laytime is counted in working hours only. Returns one laytime-only stoppage
 * for every stretch between `start` and `end` that falls outside the port's working hours, so the engine counts working time
 * while laytime runs and every hour once the ship is on demurrage. Combine with weatherStoppages(..., 'actual') for the weather.
 */
export function workingTimeStoppages(start: Date, end: Date, workingHours: WorkingHours): Stoppage[] {
  if (!workingHours?.length) throw new Error('def. 17 needs the port working hours');
  for (const [a, b] of workingHours) if (!(mins(b) > mins(a))) throw new Error(`working period ${a}-${b} does not end after it starts`);
  const out: Stoppage[] = [];
  const work = [...workingHours].map(([a, b]) => [mins(a), mins(b)] as const).sort((x, y) => x[0] - y[0]);
  for (let d = dayStart(start); d < end.getTime(); d += 24 * HOUR) {
    let cursor = d; // walk the day: gaps between working periods are off-time
    for (const [a, b] of [...work, [24 * 60, 24 * 60] as const]) {
      const gapFrom = Math.max(cursor, start.getTime()), gapTo = Math.min(d + a * 60000, end.getTime());
      if (gapTo > gapFrom) {
        const last = out[out.length - 1];
        if (last && last.end.getTime() === gapFrom) last.end = new Date(gapTo); // one stretch across midnight
        else out.push({ start: new Date(gapFrom), end: new Date(gapTo), reason: 'outside working hours (def. 17: laytime counted in working time)', appliesOnDemurrage: false });
      }
      cursor = Math.max(cursor, d + b * 60000);
    }
  }
  return out;
}

export function weatherStoppages(interruptions: WeatherInterruption[], method: WeatherMethod, workingHours?: WorkingHours): Stoppage[] {
  if (method === 'actual') {
    return interruptions.map((w) => ({ start: w.start, end: w.end, reason: w.reason ?? 'weather', sourceRef: w.sourceRef, appliesOnDemurrage: false }));
  }
  if (!workingHours?.length) throw new Error('weather ratio method needs the port working hours (BIMCO def. 15)');
  for (const [a, b] of workingHours) if (!(mins(b) > mins(a))) throw new Error(`working period ${a}-${b} does not end after it starts`);
  const workingMsPerDay = workingHours.reduce((s, [a, b]) => s + (mins(b) - mins(a)) * 60000, 0);

  // Lost working time per day, from every interruption that touches it.
  const lost = new Map<number, { ms: number; refs: string[] }>();
  for (const w of interruptions) {
    for (let d = dayStart(w.start); d < w.end.getTime(); d += 24 * HOUR) {
      let ms = 0;
      for (const [a, b] of workingHours) ms += overlapMs(w.start.getTime(), w.end.getTime(), d + mins(a) * 60000, d + mins(b) * 60000);
      if (ms <= 0) continue;
      const e = lost.get(d) ?? { ms: 0, refs: [] };
      e.ms = Math.min(workingMsPerDay, e.ms + ms);
      if (w.sourceRef) e.refs.push(w.sourceRef);
      lost.set(d, e);
    }
  }

  return [...lost.entries()].sort((x, y) => x[0] - y[0]).map(([d, e]) => {
    const share = e.ms / workingMsPerDay;             // share of the working day lost
    const counts = 1 - share;                         // share of the laytime day that still counts
    return {
      start: new Date(d), end: new Date(d + 24 * HOUR),
      reason: `weather, ratio: ${+(e.ms / HOUR).toFixed(2)} of ${+(workingMsPerDay / HOUR).toFixed(2)} working hours lost`,
      sourceRef: e.refs.join('; ') || undefined,
      ...(counts > 0 ? { countFraction: counts } : {}),
      appliesOnDemurrage: false,
    };
  });
}
