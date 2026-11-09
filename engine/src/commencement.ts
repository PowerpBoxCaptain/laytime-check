// Laytime commencement by charter terms: office hours for tendering NOR, and the before-noon / after-noon
// rule ("if NOR is given up to and including 12:00, laytime commences at 13:00 the same day; if after
// 12:00, at 06:00 the next working day"), or NOR plus notice hours. On the port's own clock.
//
// @rule:CHRT-006 — every step of the derivation is named
// @rule:CHRT-008 — no number from an underdetermined record (malformed terms or an unknown zone → NULL)
//
// laytime-rules.ts calculateCommencementTime() (NOR + notice hours) is left untouched for its callers.
// Whether the NOR itself was valid (vessel arrived, ready, notice given in time) is NOT decided here:
// that is a question of fact and law for a person ().

import type { PortHoliday } from './rules.js';
import { minuteOfWeek, inWeekly, type DerivationStep, type NullReason, type WeeklyWindow } from './statement.js';

export interface OfficeHours {
  days: number[]; // 0 = Sunday ... 6 = Saturday, port local
  start: string; // "HH:MM", port local
  end: string; // "HH:MM", port local
}

export type CommencementRule =
  | { kind: 'notice_hours'; hours: number }
  | { kind: 'noon_split'; noon: string; sameDayAt: string; nextWorkingDayAt: string };

export interface CommencementTerms {
  norTendered: Date;
  exceptionRule: string; // shinc | shex | sshex | fhex | eiu | uu: decides what a working day is
  exceptedWeekly?: WeeklyWindow[]; // own weekly excepted windows: a day whose start time falls in one is not a working day
  rule: CommencementRule;
  officeHours?: OfficeHours; // absent → NOR counts when given
  holidays?: PortHoliday[];
  portTimeZone?: string; // IANA; absent → UTC clock
}

export interface CommencementProof {
  commencedAt: Date | null;
  deemedNorAt: Date | null;
  derivation: DerivationStep[];
  nulls: NullReason[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const iso = (d: Date): string => d.toISOString().slice(0, 16) + 'Z';
const hhmm = (s: string): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** The port's wall clock: day (YYYY-MM-DD), weekday, minute of day. */
type Wall = { ymd: string; dow: number; min: number };

function clock(timeZone?: string) {
  const fmt = timeZone
    ? new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;
  const wall = (d: Date): Wall => {
    if (!fmt) return { ymd: d.toISOString().slice(0, 10), dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    return { ymd: `${p.year}-${p.month}-${p.day}`, dow: DOW[p.weekday], min: Number(p.hour) * 60 + Number(p.minute) };
  };
  /** The instant at which the port clock reads `ymd` `min`; null if that time does not exist (clocks forward). */
  const at = (ymd: string, min: number): Date | null => {
    const guess = Date.parse(`${ymd}T00:00:00Z`) + min * 60000;
    if (!fmt) return new Date(guess);
    for (const probe of [guess - DAY_MS / 2, guess, guess + DAY_MS / 2]) {
      const w = wall(new Date(probe));
      const offset = Date.parse(`${w.ymd}T00:00:00Z`) + w.min * 60000 - Math.floor(probe / 60000) * 60000;
      const cand = new Date(guess - offset);
      const c = wall(cand);
      if (c.ymd === ymd && c.min === min) return cand;
    }
    return null;
  };
  const nextYmd = (ymd: string): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  const dowOf = (ymd: string): number => new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return { wall, at, nextYmd, dowOf };
}

const validTimeZone = (tz: string): boolean => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

export function commencementByTerms(t: CommencementTerms): CommencementProof {
  const nulls: NullReason[] = [];
  const derivation: DerivationStep[] = [];
  let step = 1;
  const refuse = (sourceRef: string, missingField: string, consequence: string) =>
    nulls.push({ sourceRef, missingField, rule: 'CHRT-008', consequence });

  if (t.portTimeZone !== undefined && !validTimeZone(t.portTimeZone)) refuse(`port time zone "${t.portTimeZone}"`, 'valid port time zone (IANA)', "The port's clock cannot be fixed — no commencement asserted.");
  const oh = t.officeHours;
  const ohStart = oh ? hhmm(oh.start) : null, ohEnd = oh ? hhmm(oh.end) : null;
  if (oh && (ohStart === null || ohEnd === null || ohStart >= ohEnd || !oh.days.length || oh.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) {
    refuse('office hours term', 'valid office hours (days 0-6, HH:MM start before end)', 'Cannot tell when NOR counts as given — no commencement asserted.');
  }
  const r = t.rule;
  if (r.kind === 'noon_split' && [r.noon, r.sameDayAt, r.nextWorkingDayAt].some((s) => hhmm(s) === null)) refuse('commencement rule', 'valid noon / commencement times (HH:MM)', 'No commencement asserted.');
  if (r.kind === 'notice_hours' && !(r.hours >= 0)) refuse('commencement rule', 'valid notice hours', 'No commencement asserted.');
  const rule = t.exceptionRule.toLowerCase().trim();
  for (const w of t.exceptedWeekly ?? []) if (minuteOfWeek(w?.from) == null || minuteOfWeek(w?.to) == null) refuse(`excepted weekly window "${w?.from}" to "${w?.to}"`, 'valid weekly window ("Sat 12:00" to "Mon 08:00")', 'Cannot tell which days are working days — no commencement asserted.');
  if (!['shinc', 'shex', 'sshex', 'fhex', 'eiu', 'uu'].includes(rule)) refuse(`exception rule "${t.exceptionRule}"`, 'valid exception rule', 'Cannot tell which days are working days — no commencement asserted.');
  if (nulls.length) return { commencedAt: null, deemedNorAt: null, derivation: [{ step: 1, rule: 'CHRT-008', detail: `Refused — ${nulls.length} term(s) unusable. No commencement asserted.` }], nulls };

  const c = clock(t.portTimeZone);
  const holidaySet = new Set((t.holidays ?? []).filter((h) => h.affectsLaytime).map((h) => h.date.toISOString().slice(0, 10)));
  const zone = t.portTimeZone ?? 'UTC';
  const label = (ymd: string) => `${WEEKDAYS[c.dowOf(ymd)]} ${ymd}`;

  derivation.push({ step: step++, rule: 'CHRT-006', detail: `NOR tendered ${iso(t.norTendered)} (port clock ${zone}). Validity of the NOR (arrival, readiness) NOT checked here — a person decides.` });

  // 1. Office hours: a NOR outside them counts from the start of the next office hours (holidays are not office days).
  let deemed = t.norTendered;
  if (oh && ohStart !== null && ohEnd !== null) {
    const isOffice = (ymd: string) => oh.days.includes(c.dowOf(ymd)) && !holidaySet.has(ymd);
    const w = c.wall(t.norTendered);
    const inside = isOffice(w.ymd) && w.min >= ohStart && w.min < ohEnd;
    if (!inside) {
      let ymd = isOffice(w.ymd) && w.min < ohStart ? w.ymd : c.nextYmd(w.ymd);
      for (let i = 0; i < 370 && !isOffice(ymd); i++) ymd = c.nextYmd(ymd);
      const next = c.at(ymd, ohStart);
      if (!next) {
        refuse(`office hours start ${oh.start} on ${ymd}`, 'a time that exists on the port clock', 'Clocks change at that hour — no commencement asserted.');
        return { commencedAt: null, deemedNorAt: null, derivation, nulls };
      }
      deemed = next;
      derivation.push({ step: step++, rule: 'CHRT-006', detail: `Outside office hours (${oh.start}–${oh.end}): NOR deemed given at the start of the next office hours, ${iso(deemed)} (${label(ymd)}).` });
    } else {
      derivation.push({ step: step++, rule: 'CHRT-006', detail: `Within office hours (${oh.start}–${oh.end}): NOR counts as given.` });
    }
  }

  // 2. Commencement rule.
  let commencedAt: Date | null;
  if (r.kind === 'notice_hours') {
    commencedAt = new Date(deemed.getTime() + r.hours * HOUR_MS);
    derivation.push({ step: step++, rule: 'CHRT-006', detail: `Notice time ${r.hours} h after NOR: laytime commences ${iso(commencedAt)}.` });
  } else {
    const w = c.wall(deemed);
    const noon = hhmm(r.noon)!;
    if (w.min <= noon) {
      commencedAt = c.at(w.ymd, hhmm(r.sameDayAt)!);
      derivation.push({ step: step++, rule: 'CHRT-006', detail: `NOR up to and including ${r.noon}: laytime commences ${r.sameDayAt} the same day, ${commencedAt ? iso(commencedAt) : '—'}.` });
    } else {
      // A day is not a working day if the rule excepts it, or if the commencement time falls in an excepted window.
      const windows: [number, number][] = [...(t.exceptedWeekly ?? []).map((w) => [minuteOfWeek(w.from)!, minuteOfWeek(w.to)!] as [number, number]),
        ...(rule === 'sshex' ? [[6 * 1440, 1440] as [number, number]] : [])];
      const at = hhmm(r.nextWorkingDayAt)!;
      const excepted = (ymd: string) => {
        const dow = c.dowOf(ymd), hol = holidaySet.has(ymd);
        const byRule = rule === 'fhex' ? dow === 5 || hol : rule === 'shinc' ? false : rule === 'sshex' ? hol : dow === 0 || hol;
        return byRule || inWeekly(dow * 1440 + at, windows);
      };
      let ymd = c.nextYmd(w.ymd);
      for (let i = 0; i < 370 && excepted(ymd); i++) ymd = c.nextYmd(ymd);
      commencedAt = c.at(ymd, hhmm(r.nextWorkingDayAt)!);
      derivation.push({ step: step++, rule: 'CHRT-006', detail: `NOR after ${r.noon}: laytime commences ${r.nextWorkingDayAt} the next working day (${rule.toUpperCase()}), ${label(ymd)}, ${commencedAt ? iso(commencedAt) : '—'}.` });
    }
    if (!commencedAt) {
      refuse('commencement time', 'a time that exists on the port clock', 'Clocks change at that hour — no commencement asserted.');
      return { commencedAt: null, deemedNorAt: deemed, derivation, nulls };
    }
  }
  return { commencedAt, deemedNorAt: deemed, derivation, nulls };
}
