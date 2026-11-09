import { describe, it, expect } from 'vitest';
import { calculateLaytimeStatement, type Stoppage } from '../src/statement.js';
import { checkTrace, formatTrace } from '../src/trace.js';
import { runCase, type CaseFile } from '../src/case.js';

const t = (s: string) => new Date(`2026-06-${s}:00Z`);

// A declared statement that exercises every kind of segment: an overlap (generator failure with rain inside it),
// a pro-rata crane stoppage, a weather exception refused once on demurrage, and an excepted day worked (UU).
const STOPS: Stoppage[] = [
  { start: t('02T14:00'), end: t('02T18:00'), reason: 'generator failure', sourceRef: 'SOF Tue 14:00-18:00', clause: 'cl. 12', appliesOnDemurrage: true },
  { start: t('02T15:00'), end: t('02T17:00'), reason: 'rain, hatches closed', sourceRef: 'SOF Tue 15:00-17:00', clause: 'cl. 14' },
  { start: t('03T08:00'), end: t('03T14:00'), reason: 'one crane down, 3 of 4', sourceRef: 'SOF Wed 08:00-14:00', clause: 'cl. 27', countFraction: 0.75 },
  { start: t('05T10:00'), end: t('05T13:00'), reason: 'rain, hatches closed', sourceRef: 'SOF Fri 10:00-13:00', clause: 'cl. 14' },
];
const base = { commencedAt: t('01T08:00'), completedAt: t('06T12:00'), allowedHours: 72, exceptionRule: 'shinc', stoppages: STOPS,
  demurrageRate: 12000, despatchRate: 6000, commencementRef: 'cl. 5: NOR 20:00 + 12 h' };

describe('laytime trace — per-figure ledger', () => {
  const p = calculateLaytimeStatement({ ...base, trace: true });

  it('adds up to the statement, minute for minute', () => {
    expect(checkTrace(p)).toEqual([]);
  });

  it('is additive: with trace off the result is identical and carries no trace', () => {
    const q = calculateLaytimeStatement(base);
    expect(q.trace).toBeUndefined();
    expect([q.usedHours, q.excludedHours, q.amountDue, q.demurrageCommencedAt?.toISOString()])
      .toEqual([p.usedHours, p.excludedHours, p.amountDue, p.demurrageCommencedAt?.toISOString()]);
  });

  it('records the overlap: rain inside the generator failure is named, and not deducted twice', () => {
    const seg = p.trace!.segments.find((s) => s.from.getTime() === t('02T15:00').getTime())!;
    expect(seg.governing?.reason).toContain('generator failure');
    expect(seg.overridden.map((o) => o.clause)).toEqual(['cl. 14']);
    expect(seg.excludedMinutes).toBe(120);
  });

  it('records a pro-rata stoppage as part counting', () => {
    const seg = p.trace!.segments.find((s) => s.governing?.clause === 'cl. 27')!;
    expect([seg.minutes, seg.countedMinutes, seg.excludedMinutes]).toEqual([360, 270, 90]);
  });

  it('records a weather exception refused because the ship was already on demurrage', () => {
    expect(p.demurrageCommencedAt!.getTime()).toBeLessThan(t('05T10:00').getTime());
    const seg = p.trace!.segments.find((s) => s.refusedOnDemurrage.some((o) => o.sourceRef === 'SOF Fri 10:00-13:00'))!;
    expect([seg.onDemurrage, seg.excludedMinutes]).toEqual([true, 0]);
  });

  it('states the money formula and the rounding rule, and keeps the amount unrounded', () => {
    expect(p.trace!.money.basis).toBe('demurrage');
    expect(p.trace!.money.unrounded).toBe(p.amountDue);
    expect(p.trace!.money.rounding).toMatch(/does not round/);
    expect(p.trace!.commencement.ref).toBe('cl. 5: NOR 20:00 + 12 h');
  });

  it('marks an excepted day that counted because it was worked (UU)', () => {
    const u = calculateLaytimeStatement({ commencedAt: t('05T08:00'), completedAt: t('09T08:00'), allowedHours: 200, exceptionRule: 'uu',
      usedPeriods: [{ start: t('07T06:00'), end: t('07T18:00'), sourceRef: 'SOF Sun 06:00-18:00' }], demurrageRate: null, despatchRate: null, trace: true });
    expect(checkTrace(u)).toEqual([]);
    const seg = u.trace!.segments.find((s) => s.workedExceptedDay)!;
    expect([seg.workedExceptedDay, seg.countedMinutes]).toEqual(['SOF Sun 06:00-18:00', 720]);
  });

  it('writes a ledger that names clauses and SOF lines', () => {
    const lines = formatTrace(p).join('\n');
    expect(lines).toContain('[cl. 12 · SOF Tue 14:00-18:00]');
    expect(lines).toContain('overlap: Stoppage — rain, hatches closed [cl. 14 · SOF Tue 15:00-17:00]');
    expect(lines).toContain('on demurrage: Stoppage — rain, hatches closed [cl. 14 · SOF Fri 10:00-13:00]');
  });

  it('prints the amount unrounded but without float noise', () => {
    const q = calculateLaytimeStatement({ ...base, demurrageRate: 14000, trace: true });
    const line = formatTrace(q).find((l) => l.startsWith('Demurrage:'))!;
    expect(line).toMatch(/= \d+(\.\d{1,6})? USD \(unrounded\)$/);
    expect(line).not.toMatch(/\.\d{7,}/);
  });
});

describe('laytime case — examiner finding and publication status', () => {
  const C: CaseFile = {
    id: 'trace-demo', title: 'declared',
    terms: { quantityMt: 30000, ratePerDayMt: 10000, exceptionRule: 'shinc', commencedAt: t('01T08:00'), completedAt: t('06T12:00'), demurrageRate: 12000, despatchRate: 6000 },
    quotes: [], base: STOPS.slice(0, 2),
    points: [{ id: 'crane', title: 'crane', facts: '', readings: [
      { id: 'counts', label: 'counts', why: '', side: 'owners' },
      { id: 'excluded', label: 'excluded', why: '', side: 'charterers', stoppages: [STOPS[2]] } ] }],
    publicationStatus: 'declared',
  };

  it('without a finding, says so and still computes every cell', () => {
    const r = runCase(C);
    expect([r.finding, r.cells.length, r.publicationStatus]).toEqual([null, 2, 'declared']);
  });

  it('a finding selects its cell and carries a trace that adds up to it', () => {
    const r = runCase({ ...C, examinerFinding: { readings: { crane: 'excluded' }, by: 'examiner', on: '2026-11-02' } });
    expect(r.finding!.cell.readings).toEqual({ crane: 'excluded' });
    const sumCounted = r.finding!.trace!.segments.reduce((a, s) => a + s.countedMinutes, 0) / 60;
    expect(sumCounted).toBeCloseTo(r.finding!.cell.usedHours!, 9);
  });

  it('a finding that names no valid reading is refused', () => {
    expect(() => runCase({ ...C, examinerFinding: { readings: { crane: 'maybe' }, by: 'x', on: '2026-11-02' } })).toThrow(/no valid reading/);
  });

  it('an unstated publication status is reported as unstated, never assumed public', () => {
    expect(runCase({ ...C, publicationStatus: undefined }).publicationStatus).toBe('unstated');
  });
});
