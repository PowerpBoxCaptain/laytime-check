// Laytime case builder: one disputed voyage as data → every combination of readings → a laytime statement each.
//
// @rule:CHRT-006 — every figure carries its derivation (from laytime-statement.ts)
// @rule:CHRT-008 — no number from an underdetermined record: a missing quantity gives a break-even, not a result;
//                  a missing demurrage rate gives hours, not money.
//
// A case is: agreed terms (quoted), undisputed stoppages, and swing points. Each swing point has readings; a reading
// may set when laytime starts and/or add stoppages. The builder runs the statement engine for the full product of
// readings and reports, per swing point, how far it moves the result with the others held at their first reading.
// Whether a reading is right is a question for people; the builder only computes each one.

import { calculateLaytimeStatement, type Stoppage, type UsedPeriod, type LaytimeOutcome, type LaytimeProof, type WeeklyWindow } from './statement.js';
import type { PortHoliday } from './rules.js';

export type Side = 'owners' | 'charterers' | 'middle' | 'conditional';

export interface Quote { field: string; text: string; source: string } // source: "recap cl.11", "rider 45", "SOF p5"

export interface Reading {
  id: string;
  label: string;
  why: string;
  side: Side;
  commencedAt?: Date;     // this reading decides when laytime starts
  stoppages?: Stoppage[]; // added to the base stoppages under this reading
  // Terms this reading overrides (e.g. a rider's SHEX against the printed form's SHINC, or a different rate). Merged
  // over the case's terms in point order, so a later point's reading wins where two override the same term.
  terms?: Partial<CaseTerms>;
}

export interface SwingPoint { id: string; title: string; facts: string; readings: Reading[] }

/** An amount claimed outside laytime (e.g. detention), payable only under a given combination of readings. */
export interface AddOn { id: string; label: string; hours: number; when: Record<string, string> }

export interface EvidenceItem { item: string; settles: string[]; status: 'held' | 'asked' | 'missing' }
export interface SourceDoc { name: string; sha256?: string; coverage: 'read in full' | 'read in part' | 'searched' | 'not read'; note?: string }

export interface CaseTerms {
    quantityMt: number | null;       // null → no result, break-even quantity instead (CHRT-008)
    ratePerDayMt?: number;           // with quantityMt → allowed hours
    allowedHours?: number;           // or given directly
    exceptionRule: string;           // shinc | shex | fhex | eiu | uu
    portTimeZone?: string;
    commencedAt?: Date;              // default start, unless a reading sets it
    completedAt: Date;
    demurrageRate: number | null;    // per day; null → hours only
    despatchRate: number | null;
    despatchBasis?: 'laytime_saved' | 'all_time_saved';
    onceOnDemurrage?: boolean;
    currency?: string;
    rateNote?: string;               // e.g. "maximum only; actual to be declared"
    commencementRef?: string;        // how the default start was arrived at, e.g. "NOR 09:20 + noon rule (GENCON cl. 6)"
    holidays?: PortHoliday[];        // the port's holidays, for SHEX / FHEX / EIU / UU
    exceptedWeekly?: WeeklyWindow[]; // own weekly excepted windows, e.g. Sat 12:00 to Mon 08:00 (SSHEX is a rule of its own)
    usedPeriods?: UsedPeriod[];      // UU only: time worked on excepted days (absent → NULL under UU)
}

export interface CaseFile {
  id: string;
  title: string;
  terms: CaseTerms;
  quotes: Quote[];
  base: Stoppage[];
  points: SwingPoint[];
  addOns?: AddOn[];
  evidence?: EvidenceItem[];
  sources?: SourceDoc[];
  // Whose reading decides, if anyone has decided: a person's finding, one reading per swing point. The builder still
  // computes every cell; this only marks which cell the finding selects. Absent = no finding yet (the honest default).
  examinerFinding?: { readings: Record<string, string>; by: string; on: string; note?: string };
  // Where this case may be shown. 'private' = the client's own documents; 'redacted-ok' = cleared in writing for
  // anonymised teaching; 'declared' = a voyage invented for teaching; 'public' = cleared for publication.
  publicationStatus?: 'private' | 'internal' | 'redacted-ok' | 'declared' | 'public';
}

export interface CaseCell {
  key: string;                       // reading ids joined by "."
  readings: Record<string, string>;  // point id → reading id
  result: LaytimeOutcome | 'NULL';
  usedHours: number | null;
  allowedHours: number | null;
  overHours: number | null;          // used − allowed: + demurrage, − despatch
  demurrageFrom: Date | null;
  laytimeAmount: number | null;
  addOns: { id: string; hours: number; amount: number | null }[];
  total: number | null;              // demurrage (+) or despatch (−) plus add-ons
  breakEvenMt: number | null;        // when the quantity is unknown
  nulls: string[];
}

export interface CaseRun {
  caseId: string;
  cells: CaseCell[];
  range: { min: number; max: number } | null;
  swing: { point: string; min: number; max: number; size: number }[]; // others held at their first reading
  publicationStatus: CaseFile['publicationStatus'] | 'unstated';
  // The cell the examiner's finding selects, with its full trace; null when there is no finding.
  finding: { by: string; on: string; note?: string; cell: CaseCell; trace: LaytimeProof['trace'] } | null;
}

const UNKNOWN_ALLOWED = 1e7; // hours; long enough that laytime never runs out, so used hours are measured whole

/** The case's terms with each chosen reading's overrides merged over them, in point order. */
function termsFor(c: CaseFile, combo: Reading[]): CaseTerms {
  return Object.assign({}, c.terms, ...combo.map((r) => r.terms ?? {}));
}
const allowedOf = (t: CaseTerms): number | null =>
  t.quantityMt != null && t.ratePerDayMt ? (t.quantityMt / t.ratePerDayMt) * 24 : t.allowedHours ?? null;

function product(points: SwingPoint[]): Reading[][] {
  return points.reduce<Reading[][]>((acc, p) => acc.flatMap((combo) => p.readings.map((r) => [...combo, r])), [[]]);
}

export function runCase(c: CaseFile): CaseRun {
  const cells: CaseCell[] = [];

  for (const combo of product(c.points)) {
    const t = termsFor(c, combo);
    const known = allowedOf(t);
    const readings: Record<string, string> = {};
    c.points.forEach((p, i) => { readings[p.id] = combo[i].id; });
    const key = combo.map((r) => r.id).join('.');
    const start = [...combo].reverse().find((r) => r.commencedAt)?.commencedAt ?? t.commencedAt;
    const nulls: string[] = [];
    if (!start) nulls.push('laytime commencement: no reading or term sets it');

    const proof = start ? calculateLaytimeStatement({
      commencedAt: start, completedAt: t.completedAt, allowedHours: known ?? UNKNOWN_ALLOWED,
      exceptionRule: t.exceptionRule, portTimeZone: t.portTimeZone, holidays: t.holidays, usedPeriods: t.usedPeriods, exceptedWeekly: t.exceptedWeekly,
      stoppages: [...c.base, ...combo.flatMap((r) => r.stoppages ?? [])],
      onceOnDemurrage: t.onceOnDemurrage ?? true, despatchBasis: t.despatchBasis ?? 'laytime_saved',
      demurrageRate: t.demurrageRate, despatchRate: t.despatchRate, currency: t.currency,
    }) : null;
    if (proof?.result === 'NULL') nulls.push(...proof.nulls.map((n) => `${n.missingField} (${n.sourceRef})`));

    const used = proof && proof.result !== 'NULL' ? proof.usedHours : null;
    const over = used != null && known != null ? used - known : null;
    if (known == null && used != null) nulls.push('B/L quantity not in the record: result withheld, break-even given');

    // Money only from a rate the record gives (CHRT-008): a missing demurrage rate leaves demurrage NULL, a missing
    // despatch rate leaves despatch NULL; never a rate of zero. Despatch on all time saved is the statement's own figure.
    let laytimeAmount: number | null = null;
    if (over != null && over >= 0 && t.demurrageRate != null) laytimeAmount = (over / 24) * t.demurrageRate;
    if (over != null && over < 0 && t.despatchRate != null) {
      laytimeAmount = t.despatchBasis === 'all_time_saved' && proof && proof.result !== 'NULL' && proof.amountDue != null ? -proof.amountDue : (over / 24) * t.despatchRate;
    }

    const addOns = (c.addOns ?? [])
      .filter((a) => Object.entries(a.when).every(([pid, rid]) => readings[pid] === rid))
      .map((a) => ({ id: a.id, hours: a.hours, amount: t.demurrageRate != null ? (a.hours / 24) * t.demurrageRate : null }));
    const total = laytimeAmount != null && addOns.every((a) => a.amount != null)
      ? laytimeAmount + addOns.reduce((s, a) => s + (a.amount as number), 0) : null;

    cells.push({
      key, readings,
      result: nulls.length || !proof ? 'NULL' : proof.result,
      usedHours: used, allowedHours: known, overHours: over,
      demurrageFrom: known != null ? proof?.demurrageCommencedAt ?? null : null,
      laytimeAmount, addOns, total,
      breakEvenMt: known == null && used != null && t.ratePerDayMt ? (used / 24) * t.ratePerDayMt : null,
      nulls,
    });
  }

  const totals = cells.map((x) => x.total).filter((x): x is number => x != null);
  const range = totals.length ? { min: Math.min(...totals), max: Math.max(...totals) } : null;
  const swing = c.points.map((p) => {
    const vals = p.readings.map((r) => cells.find((x) =>
      c.points.every((q) => x.readings[q.id] === (q.id === p.id ? r.id : q.readings[0].id)))?.total)
      .filter((v): v is number => v != null);
    return vals.length ? { point: p.id, min: Math.min(...vals), max: Math.max(...vals), size: Math.max(...vals) - Math.min(...vals) }
      : { point: p.id, min: NaN, max: NaN, size: NaN };
  });
  // The examiner's cell, re-run with the trace on so every figure in it can be audited line by line.
  let finding: CaseRun['finding'] = null;
  const f = c.examinerFinding;
  if (f) {
    const missing = c.points.filter((p) => !p.readings.some((r) => r.id === f.readings[p.id])).map((p) => p.id);
    if (missing.length) throw new Error(`examiner finding names no valid reading for: ${missing.join(', ')}`);
    const cell = cells.find((x) => c.points.every((p) => x.readings[p.id] === f.readings[p.id]))!;
    finding = { by: f.by, on: f.on, ...(f.note ? { note: f.note } : {}), cell, trace: traceCell(c, f.readings)?.trace };
  }
  return { caseId: c.id, cells, range, swing, publicationStatus: c.publicationStatus ?? 'unstated', finding };
}

/** One cell of the case (one reading per point), re-run with the trace on. Null when no reading or term sets commencement.
 *  Used for the examiner's finding, and by teaching pages that print the ledger of a chosen cell without making it a finding. */
export function traceCell(c: CaseFile, readings: Record<string, string>): LaytimeProof | null {
  const combo = c.points.map((p) => {
    const r = p.readings.find((x) => x.id === readings[p.id]);
    if (!r) throw new Error(`no valid reading for: ${p.id}`);
    return r;
  });
  const t = termsFor(c, combo);
  const known = allowedOf(t);
  const start = [...combo].reverse().find((r) => r.commencedAt)?.commencedAt ?? t.commencedAt;
  return start ? calculateLaytimeStatement({
    commencedAt: start, completedAt: t.completedAt, allowedHours: known ?? UNKNOWN_ALLOWED,
    exceptionRule: t.exceptionRule, portTimeZone: t.portTimeZone, holidays: t.holidays, usedPeriods: t.usedPeriods, exceptedWeekly: t.exceptedWeekly,
    stoppages: [...c.base, ...combo.flatMap((r) => r.stoppages ?? [])],
    onceOnDemurrage: t.onceOnDemurrage ?? true, despatchBasis: t.despatchBasis ?? 'laytime_saved',
    demurrageRate: t.demurrageRate, despatchRate: t.despatchRate, currency: t.currency, trace: true,
    commencementRef: [...combo].reverse().find((r) => r.commencedAt)?.label ?? t.commencementRef ?? 'agreed terms',
  }) : null;
}
