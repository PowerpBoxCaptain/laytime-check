// Sheet check: someone else's laytime figure, checked against the engine.
//
// The engine does not produce "the" answer. Given the agreed terms, the SOF stoppages and the points where the
// documents allow more than one reading, it computes every reading. This file then asks of a submitted figure:
//   1. which readings reproduce it (to the cent, or within a stated tolerance);
//   2. if the submitter named their readings, whether that cell agrees, and by how much it differs if not;
//   3. how far each disputed point can move the money (the swing), so a reviewer knows where to look.
// Every figure it returns comes with the ledger behind it: each stretch of time, counted or excluded, with its
// SOF line and clause. Where the record is silent the cell is NULL and the check says so; it never fills a gap.
// Whether a reading is right is for people to decide. This only computes.

import { runCase, traceCell, type CaseFile, type CaseCell } from './case.js';
import { checkTrace, formatTrace } from './trace.js';

export type Kind = 'demurrage' | 'despatch';

export interface Sheet {
  amount: number;                      // as the sheet states it, positive
  kind: Kind;
  readings?: Record<string, string>;   // point id → reading id, if the submitter says which reading the sheet takes
  tolerance?: number;                  // in currency; default 0.01 (a cent)
  label?: string;                      // e.g. "owners' laytime statement, 12 Apr"
}

export type Verdict =
  | 'agrees'                     // the named readings reproduce the sheet
  | 'reproduced'                 // no readings named; the sheet is reproduced, and matches show which readings it took
  | 'agrees-under-other-readings' // readings were named and do not reproduce the sheet, but other readings do
  | 'differs'                    // no cell reproduces the sheet
  | 'null';                      // the record cannot give a figure (e.g. no quantity, no rate)

export interface CellView {
  readings: Record<string, string>;
  key: string;
  amount: number | null;  // signed: + demurrage, − despatch
  kind: Kind | 'neither' | 'null';
  usedHours: number | null;
  allowedHours: number | null;
  nulls: string[];
}

export interface SheetCheck {
  caseId: string;
  verdict: Verdict;
  sheet: { signed: number; amount: number; kind: Kind; label?: string };
  named: (CellView & { difference: number | null; agrees: boolean; ledger: string[]; traceProblems: string[] }) | null;
  matches: (CellView & { ledger: string[]; traceProblems: string[] })[];
  nearest: (CellView & { difference: number }) | null;
  range: { min: number; max: number } | null;
  swing: { point: string; title: string; min: number; max: number; size: number }[];
  cells: CellView[];
  nulls: string[];
  quotes: CaseFile['quotes'];
  publicationStatus: CaseFile['publicationStatus'] | 'unstated';
  note: string;
}

const view = (c: CaseCell): CellView => ({
  readings: c.readings, key: c.key, amount: c.total,
  kind: c.total == null ? 'null' : c.total > 0 ? 'demurrage' : c.total < 0 ? 'despatch' : 'neither',
  usedHours: c.usedHours, allowedHours: c.allowedHours, nulls: c.nulls,
});

export function checkSheet(c: CaseFile, sheet: Sheet, at?: (d: Date) => string): SheetCheck {
  if (!(sheet.amount >= 0)) throw new Error('sheet.amount must be a non-negative number (state demurrage or despatch in kind)');
  const tol = sheet.tolerance ?? 0.01;
  const signed = sheet.kind === 'demurrage' ? sheet.amount : -sheet.amount;
  const run = runCase(c);
  const ledgerOf = (readings: Record<string, string>) => {
    const proof = traceCell(c, readings);
    return proof ? { ledger: formatTrace(proof, at), traceProblems: checkTrace(proof) } : { ledger: [], traceProblems: ['no commencement: no ledger'] };
  };

  const hits = run.cells.filter((x) => x.total != null && Math.abs(x.total - signed) <= tol);
  const matches = hits.map((x) => ({ ...view(x), ...ledgerOf(x.readings) }));

  let named: SheetCheck['named'] = null;
  if (sheet.readings) {
    const missing = c.points.filter((p) => !p.readings.some((r) => r.id === sheet.readings![p.id])).map((p) => p.id);
    if (missing.length) throw new Error(`sheet.readings names no valid reading for: ${missing.join(', ')}`);
    const cell = run.cells.find((x) => c.points.every((p) => x.readings[p.id] === sheet.readings![p.id]))!;
    const difference = cell.total == null ? null : cell.total - signed;
    named = { ...view(cell), difference, agrees: difference != null && Math.abs(difference) <= tol, ...ledgerOf(cell.readings) };
  }

  const priced = run.cells.filter((x) => x.total != null);
  const near = priced.length ? priced.reduce((a, b) => (Math.abs(b.total! - signed) < Math.abs(a.total! - signed) ? b : a)) : null;

  const allNull = priced.length === 0;
  const verdict: Verdict = allNull ? 'null'
    : named?.agrees ? 'agrees'
    : hits.length ? (sheet.readings ? 'agrees-under-other-readings' : 'reproduced')
    : 'differs';

  const titles = Object.fromEntries(c.points.map((p) => [p.id, p.title]));
  const note = {
    agrees: 'The sheet is reproduced by the readings it names. Other readings the documents allow are in the swing.',
    reproduced: 'The sheet is reproduced by the readings listed in matches. That tells you which reading the sheet took on each point.',
    'agrees-under-other-readings': 'The sheet is reproduced, but by readings other than the ones named: see matches and the named cell\'s difference.',
    differs: 'No reading the case allows reproduces the sheet. Either the sheet takes a reading not in the case, or one of them has a fact wrong: start from the nearest cell and its ledger.',
    null: 'The record cannot give a figure: see nulls. Nothing is filled in.',
  }[verdict];

  return {
    caseId: c.id, verdict,
    sheet: { signed, amount: sheet.amount, kind: sheet.kind, ...(sheet.label ? { label: sheet.label } : {}) },
    named, matches,
    nearest: near ? { ...view(near), difference: near.total! - signed } : null,
    range: run.range,
    swing: run.swing.map((s) => ({ ...s, title: titles[s.point] ?? s.point })),
    cells: run.cells.map(view),
    nulls: [...new Set(run.cells.flatMap((x) => x.nulls))],
    quotes: c.quotes, publicationStatus: run.publicationStatus, note,
  };
}

/** A case file from JSON (as an MCP client or a form sends it): ISO date strings become Dates. */
export function caseFromJson(input: unknown): CaseFile {
  const DATE_KEYS = new Set(['commencedAt', 'completedAt', 'start', 'end', 'date']);
  const revive = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string' && DATE_KEYS.has(key)) {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new Error(`${key}: not a date: ${v}`);
      return d;
    }
    if (Array.isArray(v)) return v.map((x) => revive(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x, k)]));
    return v;
  };
  const c = revive(input) as CaseFile;
  if (!c || typeof c !== 'object' || !c.terms) throw new Error('case: needs at least id, title, terms, quotes, base, points');
  c.quotes ??= []; c.base ??= []; c.points ??= [];
  if (!(c.terms.completedAt instanceof Date)) throw new Error('case.terms.completedAt is required (ISO date)');
  return c;
}
