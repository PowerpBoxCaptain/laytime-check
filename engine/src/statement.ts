// Demurrage-aware laytime statement.
//
// @rule:CHRT-007 — once on demurrage, always on demurrage
// @rule:CHRT-008 — no number from an underdetermined record (provable refusal)
//
// UNLIKE calculateExcludedHours() in laytime-rules.ts, this is a single
// demurrage-AWARE pass: it knows allowedHours, so it can stop applying
// exception-day exclusions the instant laytime is exhausted. laytime-rules.ts is
// intentionally left untouched — its existing callers (invoice, claim-letter,
// voyage-estimate) must keep their current behaviour.
//

import {
  calculateLaytimeResult,
  type PortHoliday,
  type ExclusionDetail,
} from './rules.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export type LaytimeOutcome =
  | 'on_demurrage'
  | 'on_despatch'
  | 'within_laytime'
  | 'NULL';

export interface DerivationStep {
  step: number;
  rule: string; // CHRT-006 | CHRT-007 | INF-CHRT-001 ...
  detail: string;
  sourceRef?: string;
}

export interface NullReason {
  sourceRef: string;
  missingField: string;
  rule: 'CHRT-008';
  consequence: string;
}

/**
 * Flags describing facts that are ABSENT from the record. Each, when present,
 * means the determining fact is missing — the specialist must refuse (CHRT-008)
 * rather than substitute a default.
 */
export interface DeterminacyFlags {
  commencementUnderdetermined?: { sourceRef: string; missingField: string };
  unboundedStoppages?: { sourceRef: string }[];
  usedDataMissingForUU?: boolean; // UU rule but no per-period used/idle log
}

/**
 * A bounded interruption from the Statement of Facts (rain on a weather-working-day
 * charter, breakdown of ship's gear, shifting, strike) that the charter party
 * excepts from laytime. Times are port local, like the rest of the input.
 */
export interface Stoppage {
  start: Date;
  end: Date;
  reason: string; // e.g. "rain", "ship's crane breakdown"
  sourceRef?: string; // e.g. "SOF line 14"
  // Once on demurrage, laytime exceptions stop applying (CHRT-007). Set true only
  // where the charter party also stops demurrage for this cause (commonly a
  // breakdown of the ship's own gear, or shifting at owners' expense).
  appliesOnDemurrage?: boolean;
  // Partial stoppage: the share of this period that STILL counts as laytime, in [0, 1).
  // Absent → 0, the clock stops fully (the original behaviour). Crane pro-rata clauses
  // ("laytime to be prorated according to the number of working cranes") set
  // workingCranes / totalCranes, e.g. 3 of 4 cranes working → 0.75. Where stoppages
  // overlap, the one that stops the most time (lowest fraction) governs that minute.
  countFraction?: number;
  // The charter-party clause this stoppage rests on, e.g. "rider cl. 31" (trace only; does not change the count).
  clause?: string;
}

/**
 * Under SHEX "unless used" (UU), a period actually worked on an excepted day
 * (Sunday or holiday): those minutes count as laytime. From the SOF.
 */
export interface UsedPeriod {
  start: Date;
  end: Date;
  sourceRef?: string; // e.g. "SOF Sun 08 Mar overtime"
}

export interface LaytimeStatementInput {
  commencedAt: Date;
  completedAt: Date;
  allowedHours: number;
  exceptionRule: string; // shinc | shex | fhex | eiu | uu
  holidays?: PortHoliday[];
  stoppages?: Stoppage[];
  // UU only. Absent → NULL (the record does not say what was used); [] → nothing was worked.
  usedPeriods?: UsedPeriod[];
  // IANA zone of the port (Port.timezone), e.g. 'Asia/Kolkata'. Set → times are true instants and
  // Sundays, Fridays and holidays are the port's own days. Absent → UTC days, as before.
  portTimeZone?: string;
  // Excepted weekly windows on the port clock, e.g. [{ from: 'Sat 12:00', to: 'Mon 08:00' }]: time inside them does not
  // count, on top of the day rule (laytime only: like excepted days, they stop applying once on demurrage).
  exceptedWeekly?: WeeklyWindow[];
  // Despatch on 'laytime_saved' (default: the unused laytime hours) or 'all_time_saved' (the time from
  // completion until laytime would have expired, excepted days included).
  despatchBasis?: 'laytime_saved' | 'all_time_saved';
  onceOnDemurrage?: boolean; // default true (standard charter party)
  demurrageRate: number | null;
  despatchRate: number | null;
  currency?: string;
  determinacy?: DeterminacyFlags;
  // Per-figure trace (additive; off by default, so every existing result is unchanged): segment by segment, what
  // counted, what was excluded and under which clause and SOF line, which stoppage governed an overlap, which
  // exceptions were refused because the ship was on demurrage, and how the money figure was formed.
  trace?: boolean;
  commencementRef?: string; // why laytime starts when it does, e.g. "rider cl. 20: NOR 09:20 + 12 h"
}

/** One stretch of time in which nothing about the count changed. Minutes are exact (fractions at the edges). */
export interface TraceSegment {
  from: Date;
  to: Date;
  minutes: number;
  countedMinutes: number;
  excludedMinutes: number;
  onDemurrage: boolean;
  governing: { reason: string; sourceRef?: string; clause?: string; countFraction: number } | null;
  overridden: { reason: string; sourceRef?: string; clause?: string }[]; // overlapping exceptions that lost to the governing one
  refusedOnDemurrage: { reason: string; sourceRef?: string; clause?: string }[]; // exceptions that stopped applying (CHRT-007)
  workedExceptedDay?: string; // UU: an excepted-day minute that counted because it was worked
}

export interface LaytimeTrace {
  commencement: { at: Date; ref: string | null };
  completion: Date;
  segments: TraceSegment[];
  demurrageFrom: Date | null;
  totals: { grossMinutes: number; countedMinutes: number; excludedMinutes: number; allowedMinutes: number; overMinutes: number };
  money: { basis: 'demurrage' | 'despatch' | 'none'; ratePerDay: number | null; hours: number; formula: string; unrounded: number | null;
           rounding: string };
}

export interface LaytimeProof {
  result: LaytimeOutcome;
  amountDue: number | null;
  currency: string;
  allowedHours: number;
  usedHours: number;
  grossHours: number;
  excludedHours: number;
  commencedAt: Date;
  demurrageCommencedAt: Date | null;
  derivation: DerivationStep[];
  exclusions: ExclusionDetail[];
  nulls: NullReason[];
  trace?: LaytimeTrace;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const iso = (d: Date): string => d.toISOString().slice(0, 16) + 'Z';

/** The port's calendar day at an instant: weekday (0 = Sunday), YYYY-MM-DD and minute of the day. */
type PortDay = { dow: number; ymd: string; min: number };

/** A weekly excepted window on the port clock, "Sat 12:00" to "Mon 08:00" (it may wrap past Sunday midnight). */
export interface WeeklyWindow { from: string; to: string }
const WEEK_MIN = 7 * 24 * 60;
/** "Sat 12:00" → minute of the week (Sunday 00:00 = 0); null if malformed. */
export function minuteOfWeek(s: string): number | null {
  const m = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) ([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? '').trim());
  return m ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(m[1]) * 1440 + Number(m[2]) * 60 + Number(m[3]) : null;
}
/** SSHEX: Saturdays and Sundays excepted, as a weekly window. */
export const SSHEX_WINDOW: WeeklyWindow = { from: 'Sat 00:00', to: 'Mon 00:00' };
export const inWeekly = (wk: number, windows: [number, number][]): boolean => windows.some(([a, b]) => (a < b ? wk >= a && wk < b : wk >= a || wk < b));
type PortCalendar = (d: Date) => PortDay;

const QUARTER_HOUR_MS = 15 * 60 * 1000;
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * No zone: UTC days (the older convention, times entered as port local written as Z).
 * IANA zone: the port's own calendar, daylight saving included. Every zone offset is a
 * multiple of 15 minutes, so the local day can only change on a quarter hour: cache per quarter.
 */
function portCalendar(timeZone?: string): PortCalendar {
  if (!timeZone) return (d) => ({ dow: d.getUTCDay(), ymd: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() });
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const cache = new Map<number, PortDay>();
  return (d) => {
    const q = Math.floor(d.getTime() / QUARTER_HOUR_MS);
    let day = cache.get(q); // the port day and its minute at the start of this quarter hour
    if (!day) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(q * QUARTER_HOUR_MS)).map((x) => [x.type, x.value]));
      day = { dow: DOW[p.weekday], ymd: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
      cache.set(q, day);
    }
    return { ...day, min: day.min + Math.floor((d.getTime() - q * QUARTER_HOUR_MS) / ONE_MINUTE_MS) };
  };
}

const validTimeZone = (tz: string): boolean => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

/** Whether a single minute-slot is an exception day under the rule, on the port's calendar, and why. */
function hourExclusion(
  hourStart: Date,
  rule: string,
  holidays: PortHoliday[],
  cal: PortCalendar,
  weekly: [number, number][] = [],
): { excluded: boolean; reason: string } {
  const { dow, ymd, min } = cal(hourStart);
  // A holiday is a date-only value (stored at UTC midnight): its calendar date is the port's date.
  const onHoliday = holidays.some((h) => h.affectsLaytime && h.date.toISOString().slice(0, 10) === ymd);
  const onSunday = dow === 0;
  const onFriday = dow === 5;

  let excluded: boolean;
  switch (rule) {
    case 'shinc':
      excluded = false;
      break;
    case 'shex':
    case 'eiu':
    case 'uu':
      excluded = onSunday || onHoliday;
      break;
    case 'fhex':
      excluded = onFriday || onHoliday;
      break;
    case 'sshex':
      excluded = onHoliday; // Saturday and Sunday come from the SSHEX weekly window below
      break;
    default:
      throw new Error(`Unknown exception rule "${rule}". Expected: shinc, shex, sshex, fhex, eiu, uu`);
  }
  const windows = rule === 'sshex' ? [...weekly, [6 * 1440, 1440] as [number, number]] : weekly;
  const inWindow = inWeekly(dow * 1440 + min, windows);
  if (inWindow && !excluded) return { excluded: true, reason: rule === 'sshex' && (dow === 6 || dow === 0) ? 'SSHEX — Saturday & Sunday' : 'Excepted weekly window' };

  const parts: string[] = [];
  if (rule === 'fhex') {
    if (onFriday) parts.push('Friday');
    if (onHoliday) parts.push('Holiday');
  } else {
    if (onSunday) parts.push('Sunday');
    if (onHoliday) parts.push('Holiday');
  }
  return { excluded, reason: `${rule.toUpperCase()} — ${parts.join(' & ')}` };
}

interface Block {
  start: Date;
  reason: string;
  mins: number;
  sourceRef?: string;
}

// ─── CHRT-008: determinacy gate ──────────────────────────────────────────────

function collectNulls(input: LaytimeStatementInput): NullReason[] {
  const nulls: NullReason[] = [];
  const d = input.determinacy ?? {};

  if (d.commencementUnderdetermined) {
    nulls.push({
      sourceRef: d.commencementUnderdetermined.sourceRef,
      missingField: d.commencementUnderdetermined.missingField,
      rule: 'CHRT-008',
      consequence: 'Laytime commencement cannot be fixed — no figure asserted.',
    });
  }

  for (const s of d.unboundedStoppages ?? []) {
    nulls.push({
      sourceRef: s.sourceRef,
      missingField: 'stoppage end time',
      rule: 'CHRT-008',
      consequence: 'Stoppage is unbounded — period neither counted nor excluded until provided.',
    });
  }

  // @rule:CHRT-YK-001 / INF-CHRT-002 — UU without a used/idle log is indeterminate;
  // refuse rather than "conservatively exclude" (the laytime-rules.ts default).
  // Absent usedPeriods counts as missing: the caller need not remember the flag.
  if (input.exceptionRule.toLowerCase().trim() === 'uu' && (d.usedDataMissingForUU || input.usedPeriods === undefined)) {
    nulls.push({
      sourceRef: 'exception rule UU',
      missingField: 'per-period used/idle log',
      rule: 'CHRT-008',
      consequence: 'UU cannot be evaluated without used/idle data — no figure asserted.',
    });
  }

  for (const s of input.stoppages ?? []) {
    if (!(s.end.getTime() > s.start.getTime())) {
      nulls.push({
        sourceRef: s.sourceRef ?? `stoppage "${s.reason}"`,
        missingField: 'valid stoppage start/end',
        rule: 'CHRT-008',
        consequence: 'Stoppage does not end after it starts — record is contradictory.',
      });
    }
    if (s.countFraction !== undefined && !(Number.isFinite(s.countFraction) && s.countFraction >= 0 && s.countFraction < 1)) {
      nulls.push({
        sourceRef: s.sourceRef ?? `stoppage "${s.reason}"`,
        missingField: 'valid pro-rata count fraction in [0, 1)',
        rule: 'CHRT-008',
        consequence: 'The share of the stoppage that counts cannot be fixed — no figure asserted.',
      });
    }
  }

  for (const u of input.usedPeriods ?? []) {
    if (!(u.end.getTime() > u.start.getTime())) {
      nulls.push({
        sourceRef: u.sourceRef ?? 'worked period on an excepted day',
        missingField: 'valid worked-period start/end',
        rule: 'CHRT-008',
        consequence: 'Worked period does not end after it starts — record is contradictory.',
      });
    }
  }

  for (const w of input.exceptedWeekly ?? []) {
    if (minuteOfWeek(w?.from) == null || minuteOfWeek(w?.to) == null) {
      nulls.push({ sourceRef: `excepted weekly window "${w?.from}" to "${w?.to}"`, missingField: 'valid weekly window ("Sat 12:00" to "Mon 08:00")', rule: 'CHRT-008',
        consequence: 'Cannot tell which hours are excepted — no figure asserted.' });
    }
  }

  if (input.despatchBasis !== undefined && !['laytime_saved', 'all_time_saved'].includes(input.despatchBasis)) {
    nulls.push({
      sourceRef: `despatch basis "${input.despatchBasis}"`,
      missingField: 'valid despatch basis (laytime_saved | all_time_saved)',
      rule: 'CHRT-008',
      consequence: 'Despatch cannot be measured — no figure asserted.',
    });
  }

  if (input.portTimeZone !== undefined && !validTimeZone(input.portTimeZone)) {
    nulls.push({
      sourceRef: `port time zone "${input.portTimeZone}"`,
      missingField: 'valid port time zone (IANA)',
      rule: 'CHRT-008',
      consequence: "The port's days cannot be fixed — no figure asserted.",
    });
  }

  // Structural contradictions.
  if (!(input.completedAt.getTime() > input.commencedAt.getTime())) {
    nulls.push({
      sourceRef: 'commencedAt / completedAt',
      missingField: 'valid time ordering',
      rule: 'CHRT-008',
      consequence: 'Completion is not after commencement — record is contradictory.',
    });
  }

  return nulls;
}

function nullProof(input: LaytimeStatementInput, nulls: NullReason[]): LaytimeProof {
  return {
    result: 'NULL',
    amountDue: null,
    currency: input.currency ?? 'USD',
    allowedHours: input.allowedHours,
    usedHours: NaN,
    grossHours: NaN,
    excludedHours: NaN,
    commencedAt: input.commencedAt,
    demurrageCommencedAt: null,
    derivation: [
      {
        step: 1,
        rule: 'CHRT-008',
        detail: `Refused — ${nulls.length} determining fact(s) absent. No figure asserted.`,
      },
    ],
    exclusions: [],
    nulls,
  };
}

// ─── Main: demurrage-aware laytime statement ─────────────────────────────────

export function calculateLaytimeStatement(input: LaytimeStatementInput): LaytimeProof {
  // CHRT-008 first: refuse before computing if the record is underdetermined.
  const nulls = collectNulls(input);
  if (nulls.length > 0) {
    return nullProof(input, nulls);
  }

  const {
    commencedAt,
    completedAt,
    allowedHours,
    demurrageRate,
    despatchRate,
  } = input;
  const rule = input.exceptionRule.toLowerCase().trim();
  const holidays = input.holidays ?? [];
  const weekly = (input.exceptedWeekly ?? []).map((w) => [minuteOfWeek(w.from)!, minuteOfWeek(w.to)!] as [number, number]);
  const cal = portCalendar(input.portTimeZone);
  const dayLabel = (d: Date): string => { const { dow, ymd } = cal(d); return `${WEEKDAYS[dow]} ${ymd}`; };
  const onceOnDemurrage = input.onceOnDemurrage ?? true;

  const startMs = commencedAt.getTime();
  const endMs = completedAt.getTime();
  const grossHours = (endMs - startMs) / ONE_HOUR_MS;

  // Counted in minutes so SOF stoppages (rarely on the hour) are exact.
  const allowedMin = allowedHours * 60;
  const stoppages = input.stoppages ?? [];
  const usedPeriods = input.usedPeriods ?? [];
  const workedMin = new Map<UsedPeriod, number>(); // UU: excepted-day minutes counted because worked
  let usedMin = 0; // counted (non-excluded) minutes toward the allowance
  let excludedMin = 0;
  let demurrageCommencedAt: Date | null = null;
  const exclusions: ExclusionDetail[] = [];
  const derivation: DerivationStep[] = [];
  let step = 1;

  derivation.push({
    step: step++,
    rule: 'CHRT-006',
    detail: `Laytime commenced ${iso(commencedAt)}; allowed ${allowedHours} h; rule ${rule.toUpperCase()}; days on ${input.portTimeZone ?? 'UTC'} calendar.`,
  });

  let curExcl: Block | null = null;
  let curSupp: Block | null = null;

  // Trace: consecutive minutes with the same state are one segment.
  const segments: TraceSegment[] = [];
  let seg: (TraceSegment & { key: string }) | null = null;
  const pick = (c: { reason: string; sourceRef?: string; clause?: string }) => ({ reason: c.reason, ...(c.sourceRef ? { sourceRef: c.sourceRef } : {}), ...(c.clause ? { clause: c.clause } : {}) });

  const flushExcl = (end: Date) => {
    if (curExcl) {
      exclusions.push({ startTime: curExcl.start, endTime: end, reason: curExcl.reason, hours: curExcl.mins / 60 });
      curExcl = null;
    }
  };
  const flushSupp = () => {
    if (curSupp) {
      // @rule:CHRT-007 / INF-CHRT-001 — name the suppressed exception period.
      derivation.push({
        step: step++,
        rule: 'CHRT-007',
        detail: `${curSupp.reason} (${dayLabel(curSupp.start)}) NOT excluded — on demurrage since ${iso(demurrageCommencedAt!)} — ${curSupp.mins / 60} h counted.`,
        ...(curSupp.sourceRef ? { sourceRef: curSupp.sourceRef } : {}),
      });
      curSupp = null;
    }
  };

  // Minute slots on the grid from commencement. The slot in which laytime runs out is split at that instant, so the
  // rest of the minute is counted as demurrage, exactly (a pro-rata minute runs out later than a whole one).
  const EPS = 1e-9;
  for (let ms = startMs; ms < endMs - 1e-6;) {
    const slotStart = new Date(ms);
    const gridEnd = startMs + (Math.floor((ms - startMs) / ONE_MINUTE_MS + EPS) + 1) * ONE_MINUTE_MS;
    let sliceEnd = Math.min(gridEnd, endMs);
    let frac = (sliceEnd - ms) / ONE_MINUTE_MS;

    const onDemurrage = usedMin >= allowedMin - EPS;
    if (onDemurrage && !demurrageCommencedAt) {
      demurrageCommencedAt = slotStart;
      derivation.push({
        step: step++,
        rule: 'CHRT-007',
        detail: `Laytime exhausted — on demurrage from ${iso(slotStart)}. Exception days no longer interrupt counting.`,
      });
    }

    // What could stop the clock in this minute: the day rule, then any SOF stoppage.
    // counts = share of the minute that still counts as laytime (0 = full stop; pro-rata stoppages > 0).
    const candidates: { reason: string; onDem: boolean; counts: number; sourceRef?: string; clause?: string }[] = [];
    const day = hourExclusion(slotStart, rule, holidays, cal, weekly);
    // UU: an excepted-day minute that was worked counts (on demurrage it counts anyway, CHRT-007).
    const worked = day.excluded && rule === 'uu' && !(onDemurrage && onceOnDemurrage)
      ? usedPeriods.find((u) => u.start.getTime() <= ms && ms < u.end.getTime())
      : undefined;
    if (!worked && day.excluded) candidates.push({ reason: day.reason, onDem: false, counts: 0 });
    for (const stop of stoppages) {
      if (!(stop.start.getTime() <= ms && ms < stop.end.getTime())) continue;
      const counts = stop.countFraction ?? 0;
      const label = counts > 0 ? `Stoppage — ${stop.reason} (pro rata: ${+(counts * 100).toFixed(2)}% counts)` : `Stoppage — ${stop.reason}`;
      candidates.push({ reason: label, onDem: !!stop.appliesOnDemurrage, counts, sourceRef: stop.sourceRef, clause: stop.clause });
    }

    // Of the exceptions that still apply, the one that stops the most time governs this minute.
    const applying = candidates
      .filter((c) => !onDemurrage || !onceOnDemurrage || c.onDem)
      .reduce<(typeof candidates)[number] | undefined>((best, c) => (!best || c.counts < best.counts ? c : best), undefined);
    const suppressed = !applying && candidates.length > 0 ? candidates[0] : null;

    if (!onDemurrage) {
      const rate = applying ? applying.counts : 1; // laytime minutes counted per real minute in this slot
      if (rate > 0 && usedMin + frac * rate > allowedMin + EPS) { frac = (allowedMin - usedMin) / rate; sliceEnd = ms + frac * ONE_MINUTE_MS; }
    }
    if (worked) workedMin.set(worked, (workedMin.get(worked) ?? 0) + frac);

    if (input.trace) {
      const stillApply = candidates.filter((c) => !onDemurrage || !onceOnDemurrage || c.onDem);
      const overridden = stillApply.filter((c) => c !== applying).map(pick);
      const refused = candidates.filter((c) => !stillApply.includes(c)).map(pick);
      const counted = applying ? frac * applying.counts : frac;
      const key = JSON.stringify([onDemurrage, applying ? [applying.reason, applying.sourceRef, applying.counts] : null, overridden, refused, worked ? worked.sourceRef ?? 'worked' : null]);
      if (seg && seg.key === key && Math.abs(seg.to.getTime() - ms) < 1) {
        seg.to = new Date(ms + frac * ONE_MINUTE_MS); seg.minutes += frac; seg.countedMinutes += counted; seg.excludedMinutes += frac - counted;
      } else {
        if (seg) { const { key: _k, ...done } = seg; segments.push(done); }
        seg = { key, from: slotStart, to: new Date(ms + frac * ONE_MINUTE_MS), minutes: frac, countedMinutes: counted, excludedMinutes: frac - counted, onDemurrage,
          governing: applying ? { ...pick(applying), countFraction: applying.counts } : null, overridden, refusedOnDemurrage: refused,
          ...(worked ? { workedExceptedDay: worked.sourceRef ?? 'worked on an excepted day' } : {}) };
      }
    }

    if (applying) {
      flushSupp();
      const stopped = frac * (1 - applying.counts);
      if (curExcl && curExcl.reason === applying.reason) curExcl.mins += stopped;
      else {
        flushExcl(slotStart);
        curExcl = { start: slotStart, reason: applying.reason, mins: stopped, sourceRef: applying.sourceRef };
      }
      excludedMin += stopped;
      usedMin += frac - stopped;
    } else if (suppressed) {
      flushExcl(slotStart);
      if (curSupp && curSupp.reason === suppressed.reason) curSupp.mins += frac;
      else {
        flushSupp();
        curSupp = { start: slotStart, reason: suppressed.reason, mins: frac, sourceRef: suppressed.sourceRef };
      }
      usedMin += frac; // counts despite being an exception
    } else {
      flushExcl(slotStart);
      flushSupp();
      usedMin += frac;
    }
    ms = sliceEnd;
  }
  flushExcl(completedAt);
  flushSupp();
  if (seg) { const { key: _k, ...done } = seg as TraceSegment & { key: string }; segments.push(done); }

  for (const [u, mins] of workedMin) {
    derivation.push({
      step: step++,
      rule: 'INF-CHRT-002',
      detail: `UU — ${mins / 60} h worked on an excepted day (${dayLabel(u.start)}) counted as laytime.`,
      ...(u.sourceRef ? { sourceRef: u.sourceRef } : {}),
    });
  }

  const excludedHours = excludedMin / 60;

  // Final money via the shared, unchanged result function (single source of truth).
  const base = calculateLaytimeResult({
    allowedHours,
    grossHours,
    excludedHours,
    demurrageRate,
    despatchRate,
  });
  const { usedHours, result } = base;
  let amountDue = base.amountDue;

  // All time saved: run the clock on from completion until the unused laytime would have run out,
  // on the same day rule and calendar; every minute in between is saved, excepted days included.
  if (result === 'on_despatch' && input.despatchBasis === 'all_time_saved' && despatchRate != null) {
    let left = allowedMin - usedMin;
    let ms = endMs;
    const limit = endMs + 366 * 24 * ONE_HOUR_MS;
    while (left > 0 && ms < limit) {
      if (!hourExclusion(new Date(ms), rule, holidays, cal, weekly).excluded) left -= Math.min(1, left);
      ms += ONE_MINUTE_MS;
    }
    const savedHours = (ms - endMs) / ONE_HOUR_MS;
    amountDue = (savedHours / 24) * despatchRate;
    derivation.push({
      step: step++,
      rule: 'CHRT-006',
      detail: `All time saved: the ${allowedHours - usedHours} h of laytime left would have run out at ${iso(new Date(ms))}; ${savedHours} h saved from completion, excepted days included.`,
    });
  }

  derivation.push({
    step: step++,
    rule: 'CHRT-006',
    detail: `Used ${usedHours} h vs allowed ${allowedHours} h → ${result}${
      amountDue ? ` ${input.currency ?? 'USD'} ${amountDue.toLocaleString('en-US')}` : ''
    }.`,
  });

  const overMin = usedMin - allowedMin;
  const basis: 'demurrage' | 'despatch' | 'none' = result === 'on_demurrage' ? 'demurrage' : result === 'on_despatch' ? 'despatch' : 'none';
  const rate = basis === 'demurrage' ? demurrageRate : basis === 'despatch' ? despatchRate : null;
  const trace: LaytimeTrace | undefined = input.trace ? {
    commencement: { at: commencedAt, ref: input.commencementRef ?? null },
    completion: completedAt,
    segments,
    demurrageFrom: demurrageCommencedAt,
    totals: { grossMinutes: (endMs - startMs) / ONE_MINUTE_MS, countedMinutes: usedMin, excludedMinutes: excludedMin, allowedMinutes: allowedMin, overMinutes: overMin },
    money: {
      basis, ratePerDay: rate ?? null, hours: Math.abs(overMin) / 60,
      formula: basis === 'none' ? 'used equals allowed: nothing due'
        : input.despatchBasis === 'all_time_saved' && basis === 'despatch' ? `all time saved (see derivation) ÷ 24 × ${rate} per day`
        : `${+(Math.abs(overMin) / 60).toFixed(6)} h ÷ 24 × ${rate} per day`, // printed without float noise; hours carries the exact value
      unrounded: amountDue ?? null,
      rounding: 'The engine counts minute by minute and does not round. Present the amount rounded to the whole currency unit only at the end; hours to three decimals.',
    },
  } : undefined;

  return {
    ...(trace ? { trace } : {}),
    result: result as LaytimeOutcome,
    amountDue,
    currency: input.currency ?? 'USD',
    allowedHours,
    usedHours,
    grossHours,
    excludedHours,
    commencedAt,
    demurrageCommencedAt,
    derivation,
    exclusions,
    nulls: [],
  };
}
